import { z } from "zod";
import { REQUIREMENT_KINDS, REQUIREMENT_TYPES } from "./requirements/extract";

/**
 * Phase 4 matching contracts (client-safe). See docs/matching.md.
 *
 * Categories and statuses are documented SYSTEM categories derived from
 * explainable dimensions. They are never predictions of hiring success.
 */

/** Bump when engine rules change: existing matches then show "Requires recalculation". */
export const MATCHING_VERSION = "engine-2.0";

export const DIMENSIONS = [
  "SKILLS",
  "EXPERIENCE",
  "EDUCATION",
  "PROJECTS",
  "PORTFOLIO",
  "LOCATION",
  "WORK_MODE",
  "EMPLOYMENT_TYPE",
  "SALARY",
  "WORK_AUTHORIZATION",
  "LANGUAGE",
  "CAREER_PREFERENCES",
] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DIMENSION_STATUSES = [
  "STRONG_MATCH",
  "MATCH",
  "PARTIAL_MATCH",
  "UNKNOWN",
  "GAP",
  "BLOCKED",
  "NOT_APPLICABLE",
] as const;
export type DimensionStatus = (typeof DIMENSION_STATUSES)[number];

export const OVERALL_STATUSES = [
  "STRONG_MATCH",
  "GOOD_MATCH",
  "PARTIAL_MATCH",
  "LOW_MATCH",
  "BLOCKED",
  "INSUFFICIENT_DATA",
] as const;
export type OverallStatus = (typeof OVERALL_STATUSES)[number];

export const FRESHNESS = ["CURRENT", "STALE", "REQUIRES_RECALCULATION"] as const;
export type Freshness = (typeof FRESHNESS)[number];

export { REQUIREMENT_KINDS, REQUIREMENT_TYPES } from "./requirements/extract";
export type { RequirementKind, RequirementType } from "./requirements/extract";
export const EXTRACTION_METHODS = ["RULE", "AI", "USER"] as const;

/** Stable reference to a Phase 1 candidate fact: "<kind>:<uuid>". */
const FACT_REF =
  /^(education|experience|achievement|project|skill|certification|portfolio|language|authorization):[0-9a-f-]{36}$/i;
export const factRefSchema = z.string().regex(FACT_REF, "Invalid fact reference");

// --- Requirements ----------------------------------------------------------------

export const requirementInput = z.object({
  category: z.enum(REQUIREMENT_KINDS),
  requirementType: z.enum(REQUIREMENT_TYPES),
  text: z.string().trim().min(1).max(500),
  normalizedValue: z.record(z.string(), z.unknown()).default({}),
  /** Verbatim wording from the job. Required: nothing is stored without traceability. */
  sourceText: z.string().trim().min(1).max(2000),
  confidence: z.number().min(0).max(1),
  sourceReference: z.string().trim().min(1).max(200),
  extractionMethod: z.enum(EXTRACTION_METHODS),
  extractorVersion: z.string().trim().min(1).max(20),
});
export type RequirementInput = z.input<typeof requirementInput>;

// --- Match results (engine output, persisted) -------------------------------------

export type { OverallStatusV2, ResultStatus, GapKind, MatchCounts } from "./engine/types";

export const OVERALL_LABELS: Record<string, string> = {
  STRONG_MATCH: "Strong match",
  GOOD_MATCH: "Good match",
  PARTIAL_MATCH: "Partial match",
  LOW_MATCH: "Low match",
  BLOCKED: "Blocked",
  INSUFFICIENT_DATA: "Insufficient data",
  REVIEW: "Review",
};

export const OVERALL_DESCRIPTIONS: Record<string, string> = {
  STRONG_MATCH:
    "Nearly all stated requirements are supported by your recorded facts, with no required gaps.",
  GOOD_MATCH: "Most stated requirements are supported; at most one required gap.",
  PARTIAL_MATCH: "Some stated requirements are supported; several gaps or partial matches.",
  LOW_MATCH: "Few stated requirements are supported by your recorded facts.",
  BLOCKED:
    "A stated requirement is explicitly incompatible with your recorded facts or mandatory preferences.",
  INSUFFICIENT_DATA: "Too little structured information to compare reliably.",
};

export const RESULT_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  RELATED: "Related",
  PARTIAL: "Partial",
  GAP: "Gap",
  UNKNOWN: "Unknown",
  UNVERIFIED: "Needs review",
  CONFLICT: "Conflict",
  BLOCKED: "Hard block",
  NOT_APPLICABLE: "Not assessed",
};

export const GAP_KIND_LABELS: Record<string, string> = {
  REQUIRED: "Required gap",
  PREFERRED: "Preferred gap",
  PREFERENCE: "Preference conflict",
};

export const DIMENSION_LABELS: Record<Dimension, string> = {
  SKILLS: "Skills",
  EXPERIENCE: "Experience",
  EDUCATION: "Education",
  PROJECTS: "Projects",
  PORTFOLIO: "Portfolio",
  LOCATION: "Location",
  WORK_MODE: "Work mode",
  EMPLOYMENT_TYPE: "Employment type",
  SALARY: "Salary",
  WORK_AUTHORIZATION: "Work authorization",
  LANGUAGE: "Language",
  CAREER_PREFERENCES: "Other",
};

export const DIMENSION_STATUS_LABELS: Record<DimensionStatus, string> = {
  STRONG_MATCH: "Strong match",
  MATCH: "Match",
  PARTIAL_MATCH: "Partial match",
  UNKNOWN: "Unknown",
  GAP: "Gap",
  BLOCKED: "Blocked",
  NOT_APPLICABLE: "Not applicable",
};

export const SEMANTIC_ASSIST_LABELS: Record<string, string> = {
  NOT_USED: "Not used (off in matching settings)",
  NOT_NEEDED: "Not needed (no skill gaps to review)",
  UNAVAILABLE: "Unavailable (local AI not reachable) — deterministic result only",
  APPLIED: "Applied (reviewed skill gaps; only validated related-skill links kept)",
  REJECTED: "Rejected (AI output failed validation; deterministic result only)",
};

// --- Matching preferences -----------------------------------------------------------

export const matchingPreferencesInput = z.object({
  workModeHard: z.boolean(),
  employmentTypeHard: z.boolean(),
  locationHard: z.boolean(),
  salaryMinHard: z.boolean(),
  semanticAssist: z.boolean(),
});
export type MatchingPreferencesInput = z.infer<typeof matchingPreferencesInput>;

// --- Batches -----------------------------------------------------------------------

export const MAX_BATCH_JOBS = 200;
export const BATCH_CHUNK = 10;
export const batchInput = z.object({
  jobIds: z.array(z.uuid()).min(1).max(MAX_BATCH_JOBS),
});

// --- Future workflow node contract (Phase 9 canvas will call this) ------------------

export const matchingNodeInput = z.object({
  candidateId: z.uuid(),
  jobIds: z.array(z.uuid()).max(MAX_BATCH_JOBS).optional(),
  /** Minimum overall status to count as "matched" (default GOOD_MATCH). */
  threshold: z.enum(["STRONG_MATCH", "GOOD_MATCH", "PARTIAL_MATCH"]).optional(),
  options: z.object({ recalculate: z.boolean().optional() }).optional(),
});
export type MatchingNodeInput = z.infer<typeof matchingNodeInput>;
export interface MatchingNodeOutput {
  matchedJobs: { jobId: string; matchId: string; overallStatus: string }[];
  partialJobs: { jobId: string; matchId: string; overallStatus: string }[];
  blockedJobs: { jobId: string; matchId: string; reason: string }[];
  unknownJobs: { jobId: string; reason: string }[];
}
