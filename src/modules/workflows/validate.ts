/**
 * Workflow graph validation (pure). Runs on every draft save, on "Save version", on activation and
 * again by the engine before each run — stored JSON is never trusted.
 */
import { nodeSpec, portsCompatible, sideEffectOf, type NodeSpec } from "./catalog";
import { workflowDefinition, type WorkflowDefinition } from "./definition";

export type IssueCode =
  | "INVALID_WORKFLOW"
  | "NO_START"
  | "INVALID_NODE"
  | "INVALID_CONFIG"
  | "INVALID_CONNECTION"
  | "TYPE_MISMATCH"
  | "MISSING_INPUT"
  | "CYCLE"
  | "UNREACHABLE"
  | "APPROVAL_REQUIRED"
  | "LIMIT";

export interface ValidationIssue {
  severity: "ERROR" | "WARNING";
  code: IssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationCheck {
  key: string;
  label: string;
  passed: boolean;
}

export interface ValidationReport {
  valid: boolean;
  checks: ValidationCheck[];
  issues: ValidationIssue[];
  /** { nodeType: version } used by the definition (for version records) */
  nodeVersions: Record<string, number>;
}

export function validateDefinition(raw: unknown): ValidationReport {
  const issues: ValidationIssue[] = [];
  const parsed = workflowDefinition.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      checks: [{ key: "schema", label: "Definition format", passed: false }],
      issues: parsed.error.issues.slice(0, 20).map((i) => ({
        severity: "ERROR",
        code: "INVALID_WORKFLOW",
        message: `${i.path.join(".") || "definition"}: ${i.message}`,
      })),
      nodeVersions: {},
    };
  }
  const def = parsed.data;
  const add = (i: ValidationIssue) => issues.push(i);
  const nodeVersions: Record<string, number> = {};
  const nodes = new Map<
    string,
    { node: WorkflowDefinition["nodes"][number]; spec: NodeSpec | null }
  >();

  // Nodes: unique ids, known types + versions, valid config.
  for (const node of def.nodes) {
    if (nodes.has(node.id))
      add({
        severity: "ERROR",
        code: "INVALID_NODE",
        message: `Duplicate node id "${node.id}".`,
        nodeId: node.id,
      });
    const spec = nodeSpec(node.type);
    nodes.set(node.id, { node, spec });
    if (!spec) {
      add({
        severity: "ERROR",
        code: "INVALID_NODE",
        message: `"${node.name}" uses an unknown node type (${node.type}).`,
        nodeId: node.id,
      });
      continue;
    }
    if (node.typeVersion !== spec.version)
      add({
        severity: "ERROR",
        code: "INVALID_NODE",
        message: `"${node.name}" uses ${node.type}@${node.typeVersion}; this version of JOBHUNT OS supports ${node.type}@${spec.version}. Update the node.`,
        nodeId: node.id,
      });
    nodeVersions[node.type] = node.typeVersion;
    const cfg = spec.configSchema.safeParse(node.config);
    if (!cfg.success)
      for (const i of cfg.error.issues.slice(0, 3))
        add({
          severity: "ERROR",
          code: "INVALID_CONFIG",
          message: `"${node.name}": ${i.path.length ? `${i.path.join(".")} — ` : ""}${i.message}`,
          nodeId: node.id,
        });
    if (node.retry && spec.retrySafety === "NOT_SAFE_TO_RETRY" && node.retry.maxAttempts > 1)
      add({
        severity: "ERROR",
        code: "INVALID_NODE",
        message: `"${node.name}" can't be retried automatically (it is not safe to repeat).`,
        nodeId: node.id,
      });
  }

  // Edges: real nodes and ports, compatible kinds, one connection per input port, no self loops.
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const inputUse = new Set<string>();
  const edgeIds = new Set<string>();
  for (const e of def.edges) {
    if (edgeIds.has(e.id))
      add({
        severity: "ERROR",
        code: "INVALID_CONNECTION",
        message: `Duplicate connection id "${e.id}".`,
        edgeId: e.id,
      });
    edgeIds.add(e.id);
    const s = nodes.get(e.source);
    const t = nodes.get(e.target);
    if (!s || !t) {
      add({
        severity: "ERROR",
        code: "INVALID_CONNECTION",
        message: "A connection points to a node that doesn't exist.",
        edgeId: e.id,
      });
      continue;
    }
    if (e.source === e.target) {
      add({
        severity: "ERROR",
        code: "CYCLE",
        message: `"${s.node.name}" can't connect to itself.`,
        edgeId: e.id,
      });
      continue;
    }
    if (!s.spec || !t.spec) continue;
    const out = s.spec.outputs.find((p) => p.key === e.sourcePort);
    const inp = t.spec.inputs.find((p) => p.key === e.targetPort);
    if (!out || !inp) {
      add({
        severity: "ERROR",
        code: "INVALID_CONNECTION",
        message: `Connection ${s.node.name} → ${t.node.name} uses a port that doesn't exist.`,
        edgeId: e.id,
      });
      continue;
    }
    if (!portsCompatible(out.kind, inp.kind))
      add({
        severity: "ERROR",
        code: "TYPE_MISMATCH",
        message: `${s.node.name} (${out.label}) can't feed ${t.node.name} (${inp.label}).`,
        edgeId: e.id,
      });
    const key = `${e.target}:${e.targetPort}`;
    if (inputUse.has(key))
      add({
        severity: "ERROR",
        code: "INVALID_CONNECTION",
        message: `"${t.node.name}" input "${inp.label}" has more than one connection — use a Merge node.`,
        edgeId: e.id,
      });
    inputUse.add(key);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e.source]);
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e.target]);
  }

  // Required inputs.
  for (const { node, spec } of nodes.values()) {
    if (!spec) continue;
    for (const p of spec.inputs)
      if (p.required && !inputUse.has(`${node.id}:${p.key}`))
        add({
          severity: "ERROR",
          code: "MISSING_INPUT",
          message: `"${node.name}" is missing required input: ${p.label}.`,
          nodeId: node.id,
        });
    if (
      spec.type === "APPLICATION" &&
      !inputUse.has(`${node.id}:packages`) &&
      !inputUse.has(`${node.id}:applications`)
    )
      add({
        severity: "ERROR",
        code: "MISSING_INPUT",
        message: `"${node.name}" needs communication packages (to prepare) or applications (to submit).`,
        nodeId: node.id,
      });
    if (spec.type === "MERGE" && !inputUse.has(`${node.id}:a`) && !inputUse.has(`${node.id}:b`))
      add({
        severity: "ERROR",
        code: "MISSING_INPUT",
        message: `"${node.name}" has no inputs.`,
        nodeId: node.id,
      });
  }

  // Start: at least one root; roots must not need inputs.
  const roots = def.nodes.filter((n) => !incoming.get(n.id)?.length);
  if (!def.nodes.length || !roots.length)
    add({
      severity: "ERROR",
      code: "NO_START",
      message:
        "The workflow needs a starting node (a node with no incoming connection, e.g. Candidate or Search profile).",
    });

  // Cycles (DAG only — explicit loop nodes are not supported).
  const order = topoOrder(
    def.nodes.map((n) => n.id),
    outgoing,
  );
  const cyclic = order === null;
  if (cyclic)
    add({
      severity: "ERROR",
      code: "CYCLE",
      message: "The workflow contains a loop. Workflows must flow in one direction.",
    });

  // Reachability: every node must be reachable from a root (no orphan islands without a start).
  const reach = new Set<string>();
  const stack = roots.map((r) => r.id);
  while (stack.length) {
    const n = stack.pop()!;
    if (reach.has(n)) continue;
    reach.add(n);
    for (const m of outgoing.get(n) ?? []) stack.push(m);
  }
  for (const n of def.nodes)
    if (!reach.has(n.id))
      add({
        severity: "ERROR",
        code: "UNREACHABLE",
        message: `"${n.name}" can never run (not reachable from a start).`,
        nodeId: n.id,
      });

  // Safety: every node with an external side effect needs a HUMAN_APPROVAL on every path to it.
  if (!cyclic) {
    const approvalSafe = new Map<string, boolean>();
    for (const id of order!) {
      const entry = nodes.get(id)!;
      const parents = incoming.get(id) ?? [];
      const allParentsSafe =
        parents.length > 0 &&
        parents.every((p) => approvalSafe.get(p) || nodes.get(p)?.node.type === "HUMAN_APPROVAL");
      approvalSafe.set(id, allParentsSafe);
      if (
        entry.spec &&
        sideEffectOf(
          entry.spec,
          entry.spec.configSchema.safeParse(entry.node.config).data ?? entry.node.config,
        ) === "EXTERNAL" &&
        !allParentsSafe
      )
        add({
          severity: "ERROR",
          code: "APPROVAL_REQUIRED",
          message: `"${entry.node.name}" submits externally — it needs a Human approval node before it on every path.`,
          nodeId: id,
        });
    }
    // Approvals must be reached through their "approved" port for the submit to count.
    for (const e of def.edges) {
      const s = nodes.get(e.source);
      const t = nodes.get(e.target);
      if (
        s?.node.type === "HUMAN_APPROVAL" &&
        e.sourcePort === "rejected" &&
        t?.spec &&
        sideEffectOf(t.spec, t.node.config) === "EXTERNAL"
      )
        add({
          severity: "ERROR",
          code: "APPROVAL_REQUIRED",
          message: `"${t.node.name}" can't follow the "Rejected" output of an approval.`,
          edgeId: e.id,
        });
    }
  }

  // Limits.
  const submits = def.nodes.filter(
    (n) => n.type === "APPLICATION" && (n.config as { action?: string }).action === "SUBMIT",
  );
  if (submits.length && def.settings.maxApplicationsPerRun === 0)
    add({
      severity: "ERROR",
      code: "LIMIT",
      message: "The workflow submits applications but the per-run application limit is 0.",
    });
  for (const n of def.nodes)
    if (n.type === "STOP" && (outgoing.get(n.id)?.length ?? 0) > 0)
      add({
        severity: "ERROR",
        code: "INVALID_CONNECTION",
        message: `"${n.name}" ends the run — it can't have outgoing connections.`,
        nodeId: n.id,
      });

  const has = (codes: IssueCode[]) =>
    !issues.some((i) => i.severity === "ERROR" && codes.includes(i.code));
  const checks: ValidationCheck[] = [
    { key: "start", label: "Start node exists", passed: has(["NO_START"]) },
    { key: "types", label: "All node types valid", passed: has(["INVALID_NODE"]) },
    { key: "connections", label: "Connections valid", passed: has(["INVALID_CONNECTION"]) },
    { key: "compatible", label: "Inputs compatible", passed: has(["TYPE_MISMATCH"]) },
    { key: "inputs", label: "Required inputs connected", passed: has(["MISSING_INPUT"]) },
    { key: "config", label: "Required configuration complete", passed: has(["INVALID_CONFIG"]) },
    { key: "cycle", label: "No loops", passed: has(["CYCLE"]) },
    { key: "reach", label: "Every node can run", passed: has(["UNREACHABLE"]) },
    {
      key: "approval",
      label: "Approval before any external submission",
      passed: has(["APPROVAL_REQUIRED"]),
    },
    { key: "limits", label: "Run limits set", passed: has(["LIMIT"]) },
  ];
  return { valid: !issues.some((i) => i.severity === "ERROR"), checks, issues, nodeVersions };
}

/** Kahn topological order, or null when the graph has a cycle. */
export function topoOrder(ids: string[], outgoing: Map<string, string[]>): string[] | null {
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const [, targets] of outgoing)
    for (const t of targets) indeg.set(t, (indeg.get(t) ?? 0) + 1);
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const out: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    for (const m of outgoing.get(n) ?? []) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  return out.length === ids.length ? out : null;
}
