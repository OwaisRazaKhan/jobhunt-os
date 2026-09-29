/**
 * Workflow node catalog (Phase 9) — the versioned, pure description of every node type: typed
 * ports, config schema, side-effect class and retry safety. Executors (checkpoints 3–6) are
 * registered separately against these specs; the canvas and the validator only read this file.
 *
 * Port kinds are what flows along an edge. Control/utility nodes accept `ANY` and pass their input
 * through unchanged; the runtime re-validates every payload against the target port's kind.
 */
import { z } from "zod";
import { LENGTHS, TONES } from "@/modules/communications/types";

export const PORT_KINDS = [
  "CANDIDATE",
  "SEARCH_PROFILE",
  "JOB_LIST",
  "RESUME_LIST",
  "COMMUNICATION_LIST",
  "PACKAGE_LIST",
  "APPLICATION_LIST",
  "ERROR",
  "ANY",
] as const;
export type PortKind = (typeof PORT_KINDS)[number];

export const PORT_KIND_LABELS: Record<PortKind, string> = {
  CANDIDATE: "Candidate",
  SEARCH_PROFILE: "Search profile",
  JOB_LIST: "Jobs",
  RESUME_LIST: "Resume versions",
  COMMUNICATION_LIST: "Communications",
  PACKAGE_LIST: "Communication packages",
  APPLICATION_LIST: "Applications",
  ERROR: "Error",
  ANY: "Any",
};

export interface PortSpec {
  key: string;
  label: string;
  kind: PortKind;
  /** Inputs only: must be connected for the node to be valid */
  required?: boolean;
}

export const NODE_GROUPS = [
  "INPUT",
  "DISCOVERY",
  "ANALYSIS",
  "CONTENT",
  "APPLICATION",
  "CONTROL",
  "UTILITY",
] as const;
export type NodeGroup = (typeof NODE_GROUPS)[number];

/** NONE: pure computation · INTERNAL: writes JOBHUNT records · EXTERNAL: acts outside JOBHUNT OS */
export type SideEffect = "NONE" | "INTERNAL" | "EXTERNAL";
export type RetrySafety = "SAFE_TO_RETRY" | "IDEMPOTENT" | "NOT_SAFE_TO_RETRY";

export interface NodeSpec<C extends z.ZodTypeAny = z.ZodTypeAny> {
  type: string;
  version: number;
  label: string;
  description: string;
  group: NodeGroup;
  inputs: PortSpec[];
  outputs: PortSpec[];
  configSchema: C;
  sideEffect: SideEffect | ((config: never) => SideEffect);
  retrySafety: RetrySafety;
  /** Human-readable one-line summary of a config for the node card */
  summarize?: (config: never) => string;
}

// --- Shared config vocabularies ------------------------------------------------------------------

export const REMOTE_OPTIONS = ["REMOTE", "HYBRID", "ONSITE", "UNKNOWN"] as const;
export const MATCH_STATUSES = [
  "STRONG_MATCH",
  "GOOD_MATCH",
  "PARTIAL_MATCH",
  "LOW_MATCH",
  "BLOCKED",
  "INSUFFICIENT_DATA",
] as const;

/**
 * Condition fields: the only data a CONDITION / IF node may look at. Structured rules — never
 * free-form expressions or code.
 */
export const CONDITION_FIELDS = {
  "job.remoteStatus": { label: "Work mode", type: "enum", values: REMOTE_OPTIONS },
  "job.countryCode": { label: "Country (ISO code)", type: "text" },
  "job.employmentType": { label: "Employment type", type: "text" },
  "job.experienceLevel": { label: "Experience level", type: "text" },
  "job.sourceKey": { label: "Source", type: "text" },
  "match.status": { label: "Match status", type: "enum", values: MATCH_STATUSES },
  "items.count": { label: "Number of items", type: "number" },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;
export const CONDITION_OPERATORS = ["eq", "neq", "in", "notIn", "gte", "lte", "exists"] as const;

export const conditionRule = z.object({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  operator: z.enum(CONDITION_OPERATORS),
  value: z
    .union([z.string().max(100), z.number(), z.array(z.string().max(100)).max(20), z.null()])
    .default(null),
});
export type ConditionRule = z.infer<typeof conditionRule>;
const rules = z.object({
  combinator: z.enum(["ALL", "ANY"]).default("ALL"),
  rules: z.array(conditionRule).min(1, "Add at least one rule").max(10),
});

const limit = (max: number, def: number) => z.coerce.number().int().min(1).max(max).default(def);

// --- The catalog -------------------------------------------------------------------------------

const P = (key: string, label: string, kind: PortKind, required = false): PortSpec => ({
  key,
  label,
  kind,
  required,
});
const ERROR_OUT = P("error", "Error", "ERROR");

export const NODE_SPECS = [
  {
    type: "CANDIDATE",
    version: 1,
    label: "Candidate",
    description: "Your candidate profile (only your own) as the workflow's candidate context.",
    group: "INPUT",
    inputs: [],
    outputs: [P("candidate", "Candidate", "CANDIDATE")],
    configSchema: z.object({ source: z.literal("CURRENT_USER").default("CURRENT_USER") }).strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
    summarize: () => "Your profile",
  },
  {
    type: "SEARCH_PROFILE",
    version: 1,
    label: "Search profile",
    description: "One of your saved Search Profiles (country, location, work mode, criteria).",
    group: "INPUT",
    inputs: [],
    outputs: [P("profile", "Search profile", "SEARCH_PROFILE")],
    configSchema: z.object({ searchProfileId: z.uuid("Choose a search profile") }).strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "JOB_SEARCH",
    version: 1,
    label: "Job search",
    description:
      "Searches the job catalog with the search profile's criteria (no jobs are invented).",
    group: "DISCOVERY",
    inputs: [P("profile", "Search profile", "SEARCH_PROFILE", true)],
    outputs: [P("jobs", "Jobs", "JOB_LIST"), ERROR_OUT],
    configSchema: z
      .object({
        limit: limit(200, 50),
        postedWithinDays: z.coerce.number().int().min(1).max(365).nullish(),
      })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
    summarize: (c: { limit: number; postedWithinDays?: number | null }) =>
      `Up to ${c.limit} jobs${c.postedWithinDays ? ` · last ${c.postedWithinDays} days` : ""}`,
  },
  {
    type: "FILTER",
    version: 1,
    label: "Filter",
    description: "Keeps jobs matching simple deterministic criteria (no AI).",
    group: "DISCOVERY",
    inputs: [P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [P("kept", "Kept", "JOB_LIST"), P("rejected", "Rejected", "JOB_LIST")],
    configSchema: z
      .object({
        remoteStatuses: z.array(z.enum(REMOTE_OPTIONS)).max(4).default([]),
        countryCodes: z
          .array(z.string().regex(/^[A-Z]{2}$/, "Use 2-letter country codes"))
          .max(30)
          .default([]),
        employmentTypes: z.array(z.string().max(40)).max(10).default([]),
        excludeClosed: z.boolean().default(true),
        postedWithinDays: z.coerce.number().int().min(1).max(365).nullish(),
      })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "DEDUPLICATE",
    version: 1,
    label: "Deduplicate",
    description: "Removes duplicate jobs using the catalog's duplicate links.",
    group: "DISCOVERY",
    inputs: [P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [P("unique", "Unique", "JOB_LIST"), P("duplicates", "Duplicates", "JOB_LIST")],
    configSchema: z.object({}).strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "ELIGIBILITY",
    version: 1,
    label: "Eligibility",
    description: "Deterministic eligibility from the matching engine: pass, fail or unknown.",
    group: "ANALYSIS",
    inputs: [P("candidate", "Candidate", "CANDIDATE", true), P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [
      P("pass", "Pass", "JOB_LIST"),
      P("fail", "Fail", "JOB_LIST"),
      P("unknown", "Unknown", "JOB_LIST"),
      ERROR_OUT,
    ],
    configSchema: z.object({ maxJobs: limit(100, 25) }).strict(),
    sideEffect: "INTERNAL",
    retrySafety: "IDEMPOTENT",
  },
  {
    type: "MATCH",
    version: 1,
    label: "Match",
    description:
      "Runs the matching engine for each job (stores match records; no hiring probabilities).",
    group: "ANALYSIS",
    inputs: [P("candidate", "Candidate", "CANDIDATE", true), P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [
      P("strong", "Strong", "JOB_LIST"),
      P("good", "Good", "JOB_LIST"),
      P("partial", "Partial", "JOB_LIST"),
      P("blocked", "Blocked", "JOB_LIST"),
      P("unknown", "Unknown", "JOB_LIST"),
      ERROR_OUT,
    ],
    configSchema: z
      .object({
        maxJobs: limit(100, 25),
        concurrency: z.coerce.number().int().min(1).max(5).default(2),
      })
      .strict(),
    sideEffect: "INTERNAL",
    retrySafety: "IDEMPOTENT",
    summarize: (c: { maxJobs: number }) => `Up to ${c.maxJobs} jobs`,
  },
  {
    type: "RESEARCH",
    version: 1,
    label: "Research",
    description: "Job and company research from public sources (reuses fresh research).",
    group: "ANALYSIS",
    inputs: [P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [P("jobs", "Researched jobs", "JOB_LIST"), ERROR_OUT],
    configSchema: z
      .object({ maxJobs: limit(20, 5), reuseIfFresh: z.boolean().default(true) })
      .strict(),
    sideEffect: "INTERNAL",
    retrySafety: "IDEMPOTENT",
    summarize: (c: { maxJobs: number }) => `Up to ${c.maxJobs} jobs`,
  },
  {
    type: "TAILOR_RESUME",
    version: 1,
    label: "Tailor resume",
    description:
      "Creates a tailored resume draft per job from your master resume (needs your approval).",
    group: "CONTENT",
    inputs: [P("candidate", "Candidate", "CANDIDATE", true), P("jobs", "Jobs", "JOB_LIST", true)],
    outputs: [P("resumes", "Resume drafts", "RESUME_LIST"), ERROR_OUT],
    configSchema: z
      .object({
        maxJobs: limit(10, 3),
        useAi: z.boolean().default(true),
        summaryMode: z.enum(["preserve", "rewrite", "generate"]).default("preserve"),
      })
      .strict(),
    sideEffect: "INTERNAL",
    retrySafety: "IDEMPOTENT",
    summarize: (c: { maxJobs: number; useAi: boolean }) =>
      `Up to ${c.maxJobs} · ${c.useAi ? "local AI wording" : "deterministic"}`,
  },
  {
    type: "COVER_LETTER",
    version: 1,
    label: "Cover letter",
    description: "Drafts a cover letter per resume with your local model (needs your approval).",
    group: "CONTENT",
    inputs: [P("resumes", "Resume versions", "RESUME_LIST", true)],
    outputs: [P("letters", "Cover letters", "COMMUNICATION_LIST"), ERROR_OUT],
    configSchema: z
      .object({
        tone: z.enum(TONES).default("NATURAL"),
        length: z.enum(LENGTHS).default("STANDARD"),
      })
      .strict(),
    sideEffect: "INTERNAL",
    retrySafety: "NOT_SAFE_TO_RETRY",
  },
  {
    type: "WRITE_EMAIL",
    version: 1,
    label: "Write email",
    description: "Drafts an application email per resume (never sent; needs your approval).",
    group: "CONTENT",
    inputs: [P("resumes", "Resume versions", "RESUME_LIST", true)],
    outputs: [P("emails", "Emails", "COMMUNICATION_LIST"), ERROR_OUT],
    configSchema: z
      .object({ tone: z.enum(TONES).default("NATURAL"), length: z.enum(LENGTHS).default("SHORT") })
      .strict(),
    sideEffect: "INTERNAL",
    retrySafety: "NOT_SAFE_TO_RETRY",
  },
  {
    type: "COMMUNICATION_PACKAGE",
    version: 1,
    label: "Communication package",
    description:
      "Bundles the approved resume (and cover letter / email) per job; ready only when every check passes.",
    group: "CONTENT",
    inputs: [
      P("resumes", "Resume versions", "RESUME_LIST", true),
      P("letters", "Cover letters", "COMMUNICATION_LIST"),
      P("emails", "Emails", "COMMUNICATION_LIST"),
    ],
    outputs: [P("packages", "Packages", "PACKAGE_LIST"), ERROR_OUT],
    configSchema: z.object({ channel: z.enum(["PORTAL", "EMAIL"]).default("PORTAL") }).strict(),
    sideEffect: "INTERNAL",
    retrySafety: "IDEMPOTENT",
  },
  {
    type: "APPLICATION",
    version: 1,
    label: "Application",
    description:
      "PREPARE creates the application, finds the channel and reads the form. SUBMIT hands an approved application to the browser worker — CAPTCHA, sign-in and anti-bot pages always stop for you.",
    group: "APPLICATION",
    inputs: [
      P("packages", "Packages", "PACKAGE_LIST"),
      P("applications", "Applications", "APPLICATION_LIST"),
    ],
    outputs: [
      P("applications", "Applications", "APPLICATION_LIST"),
      P("manual", "Needs you", "APPLICATION_LIST"),
      ERROR_OUT,
    ],
    configSchema: z
      .object({
        action: z.enum(["PREPARE", "SUBMIT"]).default("PREPARE"),
        maxApplications: z.coerce.number().int().min(1).max(25).default(3),
      })
      .strict(),
    sideEffect: (c: { action: string }) => (c.action === "SUBMIT" ? "EXTERNAL" : "INTERNAL"),
    retrySafety: "NOT_SAFE_TO_RETRY",
    summarize: (c: { action: string; maxApplications: number }) =>
      `${c.action === "SUBMIT" ? "Submit" : "Prepare"} · max ${c.maxApplications}`,
  },
  {
    type: "HUMAN_APPROVAL",
    version: 1,
    label: "Human approval",
    description: "Pauses the run until you approve or reject the exact content that reached it.",
    group: "APPLICATION",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [P("approved", "Approved", "ANY"), P("rejected", "Rejected", "ANY")],
    configSchema: z
      .object({ message: z.string().trim().max(300).default("Review before continuing") })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
    summarize: (c: { message: string }) => c.message,
  },
  {
    type: "CONDITION",
    version: 1,
    label: "Condition",
    description: "Splits items by rules: matching items go one way, the rest the other.",
    group: "CONTROL",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [P("match", "Matches", "ANY"), P("noMatch", "Doesn't match", "ANY")],
    configSchema: rules.strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "IF",
    version: 1,
    label: "IF",
    description:
      "Sends the whole input to TRUE or FALSE depending on rules (e.g. number of items).",
    group: "CONTROL",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [P("true", "True", "ANY"), P("false", "False", "ANY")],
    configSchema: rules.strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "MERGE",
    version: 1,
    label: "Merge",
    description:
      "Rejoins branches: wait for all inputs, or continue with the first that completes.",
    group: "CONTROL",
    inputs: [P("a", "Input A", "ANY"), P("b", "Input B", "ANY")],
    outputs: [P("merged", "Merged", "ANY")],
    configSchema: z
      .object({ mode: z.enum(["WAIT_FOR_ALL", "FIRST_COMPLETED"]).default("WAIT_FOR_ALL") })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
    summarize: (c: { mode: string }) =>
      c.mode === "WAIT_FOR_ALL" ? "Wait for all" : "First completed",
  },
  {
    type: "WAIT",
    version: 1,
    label: "Wait",
    description: "Waits for you to continue, or for a short fixed duration.",
    group: "CONTROL",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [P("output", "Output", "ANY")],
    configSchema: z
      .object({
        mode: z.enum(["WAIT_FOR_HUMAN", "DURATION"]).default("WAIT_FOR_HUMAN"),
        seconds: z.coerce.number().int().min(1).max(3600).default(60),
      })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "STOP",
    version: 1,
    label: "Stop",
    description: "Ends the run intentionally.",
    group: "CONTROL",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [],
    configSchema: z
      .object({ reason: z.string().trim().max(200).default("Stopped by the workflow") })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
  {
    type: "LOG",
    version: 1,
    label: "Log",
    description: "Writes a structured log line (ids and counts only) and passes its input on.",
    group: "UTILITY",
    inputs: [P("input", "Input", "ANY", true)],
    outputs: [P("output", "Output", "ANY")],
    configSchema: z
      .object({
        message: z.string().trim().max(200).default("Checkpoint"),
        level: z.enum(["INFO", "WARNING", "ERROR"]).default("INFO"),
      })
      .strict(),
    sideEffect: "NONE",
    retrySafety: "SAFE_TO_RETRY",
  },
] as const satisfies readonly NodeSpec[];

export type NodeType = (typeof NODE_SPECS)[number]["type"];
export const NODE_TYPES = NODE_SPECS.map((s) => s.type) as NodeType[];

const BY_TYPE = new Map<string, NodeSpec>(
  NODE_SPECS.map((s) => [s.type, s as unknown as NodeSpec]),
);

export function nodeSpec(type: string): NodeSpec | null {
  return BY_TYPE.get(type) ?? null;
}

export function sideEffectOf(spec: NodeSpec, config: unknown): SideEffect {
  return typeof spec.sideEffect === "function" ? spec.sideEffect(config as never) : spec.sideEffect;
}

/** Default config for a new node of this type (schema defaults). */
export function defaultConfig(type: string): Record<string, unknown> {
  const spec = nodeSpec(type);
  if (!spec) return {};
  const parsed = spec.configSchema.safeParse({});
  return parsed.success ? (parsed.data as Record<string, unknown>) : {};
}

/** Whether a value of kind `from` may flow into an input of kind `to`. */
export function portsCompatible(from: PortKind, to: PortKind): boolean {
  if (from === "ERROR") return to === "ANY";
  return from === to || from === "ANY" || to === "ANY";
}
