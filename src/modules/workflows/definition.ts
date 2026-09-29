/**
 * Workflow definition (stored in workflows.draft_definition and, frozen, in
 * workflow_versions.definition). Pure data: nodes reference node types from the trusted catalog by
 * key + version; configs are validated per node type; there is no place for code, SQL, URLs or
 * secrets. See docs/workflow-engine.md §2.
 */
import { z } from "zod";

export const DEFINITION_SCHEMA_VERSION = 1;
export const MAX_NODES = 60;
export const MAX_EDGES = 150;

const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid id");

export const workflowNode = z
  .object({
    id,
    type: z.string().regex(/^[A-Z_]{2,40}$/, "Invalid node type"),
    typeVersion: z.number().int().min(1),
    name: z.string().trim().min(1).max(80),
    position: z.object({
      x: z.number().finite().min(-100_000).max(100_000),
      y: z.number().finite().min(-100_000).max(100_000),
    }),
    config: z.record(z.string(), z.unknown()).default({}),
    retry: z
      .object({
        maxAttempts: z.number().int().min(1).max(5),
        backoff: z.enum(["FIXED", "EXPONENTIAL"]).default("EXPONENTIAL"),
        delayMs: z.number().int().min(100).max(60_000).default(2_000),
      })
      .strict()
      .optional(),
    /** Per-node timeout (the engine also applies a default per node type) */
    timeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    /** fail: stop the run · continue: downstream of this node is skipped, other branches go on */
    onError: z.enum(["FAIL", "CONTINUE"]).default("FAIL"),
  })
  .strict();
export type WorkflowNode = z.infer<typeof workflowNode>;

export const workflowEdge = z
  .object({
    id,
    source: id,
    sourcePort: z.string().regex(/^[A-Za-z]{1,40}$/),
    target: id,
    targetPort: z.string().regex(/^[A-Za-z]{1,40}$/),
  })
  .strict();
export type WorkflowEdge = z.infer<typeof workflowEdge>;

export const workflowSettings = z
  .object({
    errorPolicy: z.enum(["FAIL_FAST", "CONTINUE_ON_ERROR"]).default("FAIL_FAST"),
    /** Hard caps for one run (runaway protection); documented defaults */
    maxNodeExecutions: z.number().int().min(1).max(500).default(100),
    timeoutMinutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(120),
    maxApplicationsPerRun: z.number().int().min(0).max(25).default(3),
  })
  .strict();
export type WorkflowSettings = z.infer<typeof workflowSettings>;

export const workflowDefinition = z
  .object({
    schemaVersion: z.literal(DEFINITION_SCHEMA_VERSION),
    trigger: z
      .object({ type: z.literal("MANUAL") })
      .strict()
      .default({ type: "MANUAL" }),
    nodes: z.array(workflowNode).max(MAX_NODES, `At most ${MAX_NODES} nodes`),
    edges: z.array(workflowEdge).max(MAX_EDGES, `At most ${MAX_EDGES} connections`),
    settings: workflowSettings.default(workflowSettings.parse({})),
  })
  .strict();
export type WorkflowDefinition = z.infer<typeof workflowDefinition>;

export function emptyDefinition(): WorkflowDefinition {
  return {
    schemaVersion: DEFINITION_SCHEMA_VERSION,
    trigger: { type: "MANUAL" },
    nodes: [],
    edges: [],
    settings: workflowSettings.parse({}),
  };
}

/** Canonical JSON (sorted keys) → stable hash for a definition. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
