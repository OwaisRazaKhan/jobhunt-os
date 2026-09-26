import type { AiTask, ProviderKind } from "./types";

/**
 * AI task registry — the single place that declares, per task: data sensitivity, default and
 * allowed providers, fallback, retry budget and output limits. Routing decisions read this;
 * business services never pick a provider themselves.
 */

export const SENSITIVITIES = [
  "PUBLIC",
  "INTERNAL",
  "PRIVATE_CANDIDATE",
  "HIGH_SENSITIVITY",
] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export interface TaskPolicy {
  task: string;
  label: string;
  phase: number;
  sensitivity: Sensitivity;
  /** "public" = AI_PUBLIC_PROVIDER, "default" = AI_DEFAULT_PROVIDER, or a fixed provider */
  defaultProvider: ProviderKind | "public" | "default";
  allowedProviders: readonly ProviderKind[];
  structuredOutputRequired: boolean;
  /** Non-AI path used when no provider may/can run the task */
  fallback: "deterministic" | "rules" | "evidence_only";
  /** Bounded retries for retryable failures (timeouts/5xx). Quota/auth never retry. */
  maxRetries: number;
  maxOutputTokens: number;
  /** Prompt contains third-party content (job/company/document text) that must be treated as data */
  untrustedContent: boolean;
  /** PUBLIC results may be reused from the user's own recent identical generation */
  cacheable: boolean;
  description: string;
}

export const TASKS: Record<AiTask, TaskPolicy> = {
  "candidate.extract_facts": {
    task: "candidate.extract_facts",
    label: "CV / document fact extraction",
    phase: 1,
    sensitivity: "PRIVATE_CANDIDATE",
    defaultProvider: "ollama",
    allowedProviders: ["ollama", "gemini"],
    structuredOutputRequired: true,
    fallback: "rules",
    maxRetries: 1,
    maxOutputTokens: 6000,
    untrustedContent: true,
    cacheable: false,
    description:
      "Suggests facts from your uploaded CV; every suggestion is checked against the document and waits for your review.",
  },
  "matching.semantic_skills": {
    task: "matching.semantic_skills",
    label: "Match semantic assistance",
    phase: 4,
    sensitivity: "PRIVATE_CANDIDATE",
    defaultProvider: "ollama",
    allowedProviders: ["ollama", "gemini"],
    structuredOutputRequired: true,
    fallback: "deterministic",
    maxRetries: 1,
    maxOutputTokens: 2000,
    untrustedContent: true,
    cacheable: false,
    description:
      "Proposes related-skill links between your skills and a job's requirements; the deterministic matcher stays authoritative.",
  },
  "research.synthesize": {
    task: "research.synthesize",
    label: "Company & job research synthesis",
    phase: 5,
    sensitivity: "PUBLIC",
    defaultProvider: "public",
    allowedProviders: ["gemini", "ollama"],
    structuredOutputRequired: true,
    fallback: "evidence_only",
    maxRetries: 1,
    maxOutputTokens: 8000,
    untrustedContent: true,
    cacheable: true,
    description:
      "Summarises public source evidence into claims that cite it; no candidate data is included.",
  },
  "resume.tailor": {
    task: "resume.tailor",
    label: "Resume wording (tailoring)",
    phase: 6,
    sensitivity: "PRIVATE_CANDIDATE",
    defaultProvider: "ollama",
    allowedProviders: ["ollama", "gemini"],
    structuredOutputRequired: true,
    fallback: "deterministic",
    maxRetries: 1,
    maxOutputTokens: 4000,
    untrustedContent: true,
    cacheable: false,
    description:
      "Rewords resume bullets/summary from your facts; every statement passes claim validation.",
  },
};

/**
 * Tasks of later phases, declared so routing/privacy rules exist before the features do.
 * They are NOT routable: the orchestrator refuses them until the phase implements them.
 */
export const PLANNED_TASKS: readonly {
  task: string;
  label: string;
  phase: number;
  sensitivity: Sensitivity;
}[] = [
  {
    task: "job.requirement_extraction",
    label: "Job requirement extraction (rules today)",
    phase: 4,
    sensitivity: "PUBLIC",
  },
  {
    task: "resume.quality_analysis",
    label: "Resume quality analysis (rules today)",
    phase: 6,
    sensitivity: "PRIVATE_CANDIDATE",
  },
  {
    task: "cover_letter.generate",
    label: "Cover letter generation",
    phase: 7,
    sensitivity: "PRIVATE_CANDIDATE",
  },
  { task: "email.generate", label: "Email generation", phase: 7, sensitivity: "PRIVATE_CANDIDATE" },
  {
    task: "application.answers",
    label: "Application answers",
    phase: 8,
    sensitivity: "HIGH_SENSITIVITY",
  },
];

export const SENSITIVITY_LABELS: Record<Sensitivity, string> = {
  PUBLIC: "Public data only",
  INTERNAL: "Internal (no candidate data)",
  PRIVATE_CANDIDATE: "Private candidate data",
  HIGH_SENSITIVITY: "Highly sensitive — local only",
};

export function taskPolicy(task: AiTask): TaskPolicy {
  const policy = TASKS[task];
  if (!policy) throw new Error(`Unknown AI task: ${task}`);
  return policy;
}
