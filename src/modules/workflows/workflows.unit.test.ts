import { describe, expect, it } from "vitest";
import { defaultConfig, NODE_SPECS, nodeSpec, portsCompatible } from "./catalog";
import { canonicalJson, emptyDefinition, type WorkflowDefinition } from "./definition";
import { definitionHash } from "./hash";
import { validateDefinition } from "./validate";

type N = WorkflowDefinition["nodes"][number];
const node = (id: string, type: string, config: Record<string, unknown> = {}): N => ({
  id,
  type,
  typeVersion: nodeSpec(type)?.version ?? 1,
  name: id,
  position: { x: 0, y: 0 },
  config: { ...defaultConfig(type), ...config },
  onError: "FAIL",
});
const edge = (source: string, sourcePort: string, target: string, targetPort: string) => ({
  id: `${source}-${sourcePort}-${target}-${targetPort}`,
  source,
  sourcePort,
  target,
  targetPort,
});
const def = (nodes: N[], edges: ReturnType<typeof edge>[]): WorkflowDefinition => ({
  ...emptyDefinition(),
  nodes,
  edges,
});
const PROFILE = "01a0db28-1998-71bc-b0c5-fa69eb240b59";
const errors = (d: WorkflowDefinition) =>
  validateDefinition(d).issues.filter((i) => i.severity === "ERROR");

const discovery = () =>
  def(
    [
      node("c", "CANDIDATE"),
      node("p", "SEARCH_PROFILE", { searchProfileId: PROFILE }),
      node("s", "JOB_SEARCH"),
      node("f", "FILTER"),
      node("d", "DEDUPLICATE"),
      node("m", "MATCH"),
    ],
    [
      edge("p", "profile", "s", "profile"),
      edge("s", "jobs", "f", "jobs"),
      edge("f", "kept", "d", "jobs"),
      edge("d", "unique", "m", "jobs"),
      edge("c", "candidate", "m", "candidate"),
    ],
  );

describe("node catalog", () => {
  it("every node type is unique, versioned and has a parseable default config (except required references)", () => {
    const types = NODE_SPECS.map((s) => s.type);
    expect(new Set(types).size).toBe(types.length);
    for (const s of NODE_SPECS) {
      expect(s.version).toBeGreaterThanOrEqual(1);
      if (s.type !== "SEARCH_PROFILE" && s.type !== "CONDITION" && s.type !== "IF")
        expect(s.configSchema.safeParse({}).success).toBe(true);
    }
  });

  it("configs reject unknown fields (no smuggled code, SQL or URLs)", () => {
    expect(nodeSpec("FILTER")!.configSchema.safeParse({ script: "process.exit()" }).success).toBe(
      false,
    );
    expect(nodeSpec("LOG")!.configSchema.safeParse({ url: "http://169.254.169.254" }).success).toBe(
      false,
    );
  });

  it("port compatibility: same kind or ANY; errors only into ANY", () => {
    expect(portsCompatible("JOB_LIST", "JOB_LIST")).toBe(true);
    expect(portsCompatible("CANDIDATE", "JOB_LIST")).toBe(false);
    expect(portsCompatible("JOB_LIST", "ANY")).toBe(true);
    expect(portsCompatible("ERROR", "JOB_LIST")).toBe(false);
    expect(portsCompatible("ERROR", "ANY")).toBe(true);
  });
});

describe("graph validation", () => {
  it("accepts the job discovery workflow", () => {
    const r = validateDefinition(discovery());
    expect(r.issues).toEqual([]);
    expect(r.valid).toBe(true);
    expect(r.checks.every((c) => c.passed)).toBe(true);
    expect(r.nodeVersions).toMatchObject({ MATCH: 1, JOB_SEARCH: 1 });
  });

  it("an empty workflow has no start", () => {
    expect(errors(emptyDefinition()).map((i) => i.code)).toContain("NO_START");
  });

  it("rejects a missing required input and missing required configuration", () => {
    const d = def([node("p", "SEARCH_PROFILE"), node("s", "JOB_SEARCH")], []);
    const codes = errors(d).map((i) => i.code);
    expect(codes).toContain("INVALID_CONFIG"); // no search profile chosen
    expect(codes).toContain("MISSING_INPUT"); // Job search has no profile input
  });

  it("rejects incompatible connections (Candidate → a jobs input)", () => {
    const d = def(
      [node("c", "CANDIDATE"), node("f", "FILTER")],
      [edge("c", "candidate", "f", "jobs")],
    );
    expect(errors(d).map((i) => i.code)).toContain("TYPE_MISMATCH");
  });

  it("rejects ports that don't exist, unknown node types and outdated node versions", () => {
    const d = def(
      [
        node("c", "CANDIDATE"),
        node("x", "SHELL_COMMAND"),
        { ...node("m", "MATCH"), typeVersion: 7 },
      ],
      [edge("c", "nope", "m", "candidate")],
    );
    const msgs = errors(d)
      .map((i) => i.message)
      .join(" ");
    expect(msgs).toContain("unknown node type");
    expect(msgs).toContain("MATCH@7");
    expect(msgs).toContain("port that doesn't exist");
  });

  it("rejects loops (DAG only)", () => {
    const d = def(
      [node("c", "CANDIDATE"), node("l1", "LOG"), node("l2", "LOG")],
      [
        edge("c", "candidate", "l1", "input"),
        edge("l1", "output", "l2", "input"),
        edge("l2", "output", "l1", "input"),
      ],
    );
    expect(errors(d).map((i) => i.code)).toContain("CYCLE");
  });

  it("rejects two connections into one input (use Merge instead)", () => {
    const d = def(
      [node("a", "CANDIDATE"), node("b", "CANDIDATE"), node("l", "LOG")],
      [edge("a", "candidate", "l", "input"), edge("b", "candidate", "l", "input")],
    );
    expect(errors(d).map((i) => i.code)).toContain("INVALID_CONNECTION");
  });

  it("an application SUBMIT without a human approval on every path is rejected", () => {
    const base = [
      node("c", "CANDIDATE"),
      node("p", "SEARCH_PROFILE", { searchProfileId: PROFILE }),
      node("s", "JOB_SEARCH"),
      node("t", "TAILOR_RESUME"),
      node("k", "COMMUNICATION_PACKAGE"),
    ];
    const baseEdges = [
      edge("p", "profile", "s", "profile"),
      edge("c", "candidate", "t", "candidate"),
      edge("s", "jobs", "t", "jobs"),
      edge("t", "resumes", "k", "resumes"),
    ];
    const unsafe = def(
      [...base, node("a", "APPLICATION", { action: "SUBMIT" })],
      [...baseEdges, edge("k", "packages", "a", "packages")],
    );
    expect(errors(unsafe).map((i) => i.code)).toContain("APPROVAL_REQUIRED");

    const safe = def(
      [
        ...base,
        node("prep", "APPLICATION", { action: "PREPARE" }),
        node("h", "HUMAN_APPROVAL"),
        node("sub", "APPLICATION", { action: "SUBMIT" }),
      ],
      [
        ...baseEdges,
        edge("k", "packages", "prep", "packages"),
        edge("prep", "applications", "h", "input"),
        edge("h", "approved", "sub", "applications"),
      ],
    );
    expect(errors(safe)).toEqual([]);

    const viaReject = def(
      [
        ...base,
        node("prep", "APPLICATION"),
        node("h", "HUMAN_APPROVAL"),
        node("sub", "APPLICATION", { action: "SUBMIT" }),
      ],
      [
        ...baseEdges,
        edge("k", "packages", "prep", "packages"),
        edge("prep", "applications", "h", "input"),
        edge("h", "rejected", "sub", "applications"),
      ],
    );
    expect(errors(viaReject).map((i) => i.code)).toContain("APPROVAL_REQUIRED");
  });

  it("nodes that can't be retried safely refuse a retry policy", () => {
    const d = def(
      [
        node("c", "CANDIDATE"),
        node("p", "SEARCH_PROFILE", { searchProfileId: PROFILE }),
        node("s", "JOB_SEARCH"),
        node("t", "TAILOR_RESUME"),
        { ...node("w", "WRITE_EMAIL"), retry: { maxAttempts: 3, backoff: "FIXED", delayMs: 1000 } },
      ],
      [
        edge("p", "profile", "s", "profile"),
        edge("c", "candidate", "t", "candidate"),
        edge("s", "jobs", "t", "jobs"),
        edge("t", "resumes", "w", "resumes"),
      ],
    );
    expect(
      errors(d)
        .map((i) => i.message)
        .join(" "),
    ).toContain("can't be retried");
  });

  it("STOP can't have outgoing connections; malformed JSON is reported, not thrown", () => {
    const d = def(
      [node("c", "CANDIDATE"), node("x", "STOP"), node("l", "LOG")],
      [edge("c", "candidate", "x", "input"), edge("x", "input", "l", "input")],
    );
    expect(errors(d).length).toBeGreaterThan(0);
    const bad = validateDefinition({ nodes: "DROP TABLE" });
    expect(bad.valid).toBe(false);
    expect(bad.issues[0]!.code).toBe("INVALID_WORKFLOW");
  });
});

describe("hashing", () => {
  it("is stable under key order and changes with content", () => {
    const a = discovery();
    const b = JSON.parse(canonicalJson(a)) as WorkflowDefinition;
    expect(definitionHash(a)).toBe(definitionHash(b));
    expect(
      definitionHash({ ...a, settings: { ...a.settings, maxApplicationsPerRun: 4 } }),
    ).not.toBe(definitionHash(a));
  });
});
