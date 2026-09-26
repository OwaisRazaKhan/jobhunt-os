import { z } from "zod";
import { REQUIREMENT_KINDS, REQUIREMENT_TYPES } from "./requirements/extract";

/**
 * Phase 4 matching contracts (client-safe). See docs/matching.md.
 *
 * Categories and statuses are documented SYSTEM categories derived from
 * explainable dimensions. They are never predictions of hiring success.
 */

export const MATCHING_VERSION = "v1";

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
  "REVIEW",
  "BLOCKED",
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

// --- Match results --------------------------------------------------------------

export const EVIDENCE_OUTCOMES = ["SUPPORTS", "PARTIAL", "MISSING", "UNKNOWN", "CONFLICT"] as const;

export const evidenceItemInput = z
  .object({
    requirementId: z.uuid().optional(),
    factRef: factRefSchema.optional(),
    outcome: z.enum(EVIDENCE_OUTCOMES),
    reasoning: z.string().trim().min(1).max(500),
  })
  .refine(
    (e) => (e.outcome !== "SUPPORTS" && e.outcome !== "PARTIAL" ? true : Boolean(e.factRef)),
    {
      message: "Supporting evidence must cite a candidate fact",
      path: ["factRef"],
    },
  );

export const dimensionResultInput = z.object({
  dimension: z.enum(DIMENSIONS),
  status: z.enum(DIMENSION_STATUSES),
  isHard: z.boolean().default(false),
  summary: z.string().trim().min(1).max(1000),
  evidence: z.array(evidenceItemInput).max(100).default([]),
});

export const statementInput = z.object({
  text: z.string().trim().min(1).max(300),
  dimension: z.enum(DIMENSIONS),
  requirementIds: z.array(z.uuid()).max(20).default([]),
  factRefs: z.array(factRefSchema).max(20).default([]),
});

export const explanationInput = z.object({
  // "Why it fits" statements must be backed by candidate facts (evidence-first).
  fits: z
    .array(
      statementInput.refine((s) => s.factRefs.length > 0, {
        message: "A fit statement must cite candidate evidence",
      }),
    )
    .max(30)
    .default([]),
  gaps: z.array(statementInput).max(30).default([]),
  unknowns: z.array(statementInput).max(30).default([]),
});

export const matchResultInput = z
  .object({
    overallStatus: z.enum(OVERALL_STATUSES),
    summaryScore: z.number().int().min(0).max(100).nullable(),
    hardBlock: z.boolean(),
    hardBlockReason: z.string().trim().min(1).max(500).nullable(),
    dimensions: z.array(dimensionResultInput).min(1).max(DIMENSIONS.length),
    explanation: explanationInput,
  })
  .superRefine((m, ctx) => {
    if (m.hardBlock !== (m.overallStatus === "BLOCKED")) {
      ctx.addIssue({
        code: "custom",
        path: ["overallStatus"],
        message: "BLOCKED is used exactly when there is a hard block",
      });
    }
    if (m.hardBlock && !m.hardBlockReason) {
      ctx.addIssue({
        code: "custom",
        path: ["hardBlockReason"],
        message: "A hard block must state its reason",
      });
    }
    if (m.hardBlock && !m.dimensions.some((d) => d.status === "BLOCKED" && d.isHard)) {
      ctx.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "A hard block must come from a BLOCKED hard-requirement dimension",
      });
    }
    const seen = new Set<string>();
    for (const d of m.dimensions) {
      if (seen.has(d.dimension))
        ctx.addIssue({
          code: "custom",
          path: ["dimensions"],
          message: `Duplicate dimension ${d.dimension}`,
        });
      seen.add(d.dimension);
    }
  });
export type MatchResultInput = z.input<typeof matchResultInput>;

// --- Display labels ----------------------------------------------------------------

export const OVERALL_LABELS: Record<OverallStatus, string> = {
  STRONG_MATCH: "Strong match",
  GOOD_MATCH: "Good match",
  PARTIAL_MATCH: "Partial match",
  REVIEW: "Review",
  BLOCKED: "Blocked",
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
  CAREER_PREFERENCES: "Career preferences",
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
