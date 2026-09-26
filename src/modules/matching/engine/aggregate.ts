import { candidateSkillSources, evaluateRequirement, type EvalContext } from "./evaluate";
import {
  DEFAULT_SETTINGS,
  type CandidateEvidence,
  type DimensionSummary,
  type MatchComputation,
  type MatchCounts,
  type MatchingSettings,
  type OverallStatusV2,
  type RequirementLike,
  type RequirementResult,
} from "./types";

/**
 * Deterministic aggregation (pure). The overall status is a documented category derived
 * from counted requirement results — never a probability, never a judgement of the person.
 * See docs/matching.md § Overall status for the exact thresholds.
 */

/** Requirements about the job's substance (not about your preferences). */
export const SUBSTANTIVE = new Set([
  "SKILL",
  "EXPERIENCE",
  "EDUCATION",
  "LANGUAGE",
  "CERTIFICATION",
  "PORTFOLIO",
  "DOMAIN",
  "AUTHORIZATION",
]);

/** Minimum substantive requirements for a reliable match (otherwise INSUFFICIENT_DATA). */
export const MIN_SUBSTANTIVE = 2;

const CATEGORY_DIMENSION: Record<string, string> = {
  SKILL: "SKILLS",
  EXPERIENCE: "EXPERIENCE",
  DOMAIN: "EXPERIENCE",
  EDUCATION: "EDUCATION",
  CERTIFICATION: "EDUCATION",
  PORTFOLIO: "PORTFOLIO",
  LOCATION: "LOCATION",
  WORK_MODE: "WORK_MODE",
  EMPLOYMENT: "EMPLOYMENT_TYPE",
  SALARY: "SALARY",
  AUTHORIZATION: "WORK_AUTHORIZATION",
  LANGUAGE: "LANGUAGE",
  OTHER: "CAREER_PREFERENCES",
};

const VALUE: Partial<Record<RequirementResult["status"], number>> = {
  MATCHED: 1,
  RELATED: 0.5,
  PARTIAL: 0.5,
  GAP: 0,
};
const isAssessed = (r: RequirementResult) => r.status in VALUE;

export interface ComputeInput {
  requirements: RequirementLike[];
  candidate: CandidateEvidence;
  settings?: MatchingSettings;
  now?: Date;
  jobCountryCode?: string | null;
}

export function countResults(
  requirements: RequirementLike[],
  results: RequirementResult[],
): MatchCounts {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const c: MatchCounts = {
    total: results.length,
    assessed: 0,
    matched: 0,
    related: 0,
    partial: 0,
    requiredGaps: 0,
    preferredGaps: 0,
    preferenceGaps: 0,
    unknown: 0,
    unverified: 0,
    conflicts: 0,
    hardBlocks: 0,
    notApplicable: 0,
    requiredTotal: 0,
    requiredMet: 0,
  };
  for (const r of results) {
    const req = byId.get(r.requirementId);
    if (isAssessed(r)) c.assessed++;
    if (r.status === "MATCHED") c.matched++;
    else if (r.status === "RELATED") c.related++;
    else if (r.status === "PARTIAL") c.partial++;
    else if (r.status === "UNKNOWN") c.unknown++;
    else if (r.status === "UNVERIFIED") c.unverified++;
    else if (r.status === "CONFLICT") c.conflicts++;
    else if (r.status === "BLOCKED") c.hardBlocks++;
    else if (r.status === "NOT_APPLICABLE") c.notApplicable++;
    else if (r.status === "GAP") {
      if (r.gapKind === "REQUIRED") c.requiredGaps++;
      else if (r.gapKind === "PREFERENCE") c.preferenceGaps++;
      else c.preferredGaps++;
    }
    if (req?.requirementType === "REQUIRED" && r.status !== "NOT_APPLICABLE") {
      c.requiredTotal++;
      if (r.status === "MATCHED") c.requiredMet++;
    }
  }
  return c;
}

function dimensionSummaries(
  requirements: RequirementLike[],
  results: RequirementResult[],
): DimensionSummary[] {
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const groups = new Map<string, RequirementResult[]>();
  for (const r of results) {
    const dim =
      CATEGORY_DIMENSION[byId.get(r.requirementId)?.category ?? "OTHER"] ?? "CAREER_PREFERENCES";
    groups.set(dim, [...(groups.get(dim) ?? []), r]);
  }
  return [...groups].map(([dimension, rs]) => {
    const assessed = rs.filter(isAssessed);
    const met = assessed.filter((r) => r.status === "MATCHED").length;
    const value = assessed.reduce((s, r) => s + (VALUE[r.status] ?? 0), 0);
    let status: DimensionSummary["status"];
    if (rs.some((r) => r.status === "BLOCKED")) status = "BLOCKED";
    else if (rs.every((r) => r.status === "NOT_APPLICABLE")) status = "NOT_APPLICABLE";
    else if (!assessed.length) status = "UNKNOWN";
    else if (met === assessed.length) status = "MATCH";
    else if (value / assessed.length >= 0.5) status = "PARTIAL_MATCH";
    else status = "GAP";
    const open =
      rs.length - assessed.length - rs.filter((r) => r.status === "NOT_APPLICABLE").length;
    const summary =
      status === "BLOCKED"
        ? (rs.find((r) => r.status === "BLOCKED")?.explanation ?? "Hard block")
        : `${met} of ${assessed.length} assessed requirement${assessed.length === 1 ? "" : "s"} matched${open ? `; ${open} unknown or unverified` : ""}.`;
    return {
      dimension,
      status,
      isHard: rs.some((r) => r.isHardBlock),
      summary: summary.slice(0, 1000),
      met,
      assessed: assessed.length,
    };
  });
}

function overall(
  requirements: RequirementLike[],
  results: RequirementResult[],
  counts: MatchCounts,
): { status: OverallStatusV2; insufficient: "JOB" | "CANDIDATE" | null } {
  if (counts.hardBlocks > 0) return { status: "BLOCKED", insufficient: null };
  const byId = new Map(requirements.map((r) => [r.id, r]));
  const substantive = results.filter((r) => {
    const req = byId.get(r.requirementId);
    return req && SUBSTANTIVE.has(req.category) && r.status !== "NOT_APPLICABLE";
  });
  if (substantive.length < MIN_SUBSTANTIVE)
    return { status: "INSUFFICIENT_DATA", insufficient: "JOB" };
  const assessed = substantive.filter(isAssessed);
  const required = substantive.filter(
    (r) => byId.get(r.requirementId)!.requirementType === "REQUIRED",
  );
  const requiredKnown = required.filter(isAssessed);
  if (
    assessed.length / substantive.length < 0.5 ||
    (required.length > 0 && requiredKnown.length / required.length < 0.5)
  )
    return { status: "INSUFFICIENT_DATA", insufficient: "CANDIDATE" };
  // Required requirements weigh twice as much as preferred ones.
  const weight = (r: RequirementResult) =>
    byId.get(r.requirementId)!.requirementType === "REQUIRED" ? 2 : 1;
  const total = assessed.reduce((s, r) => s + weight(r), 0);
  const met = assessed.reduce((s, r) => s + weight(r) * (VALUE[r.status] ?? 0), 0);
  const ratio = total ? met / total : 0;
  if (ratio >= 0.85 && counts.requiredGaps === 0 && counts.preferenceGaps <= 1)
    return { status: "STRONG_MATCH", insufficient: null };
  if (ratio >= 0.65 && counts.requiredGaps <= 1)
    return { status: "GOOD_MATCH", insufficient: null };
  if (ratio >= 0.4) return { status: "PARTIAL_MATCH", insufficient: null };
  return { status: "LOW_MATCH", insufficient: null };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Grounded one-paragraph summary built only from counts and requirement results. */
function summarize(
  status: OverallStatusV2,
  counts: MatchCounts,
  insufficient: "JOB" | "CANDIDATE" | null,
  blockReason: string | null,
) {
  if (status === "BLOCKED") return `Hard block: ${blockReason}`;
  if (insufficient === "JOB")
    return "This job does not contain enough structured requirements for a reliable match.";
  const parts = [
    `${counts.matched} of ${counts.total} requirements matched`,
    counts.related ? plural(counts.related, "related skill") : "",
    counts.partial ? `${counts.partial} partially met` : "",
    counts.requiredGaps ? plural(counts.requiredGaps, "required gap") : "",
    counts.preferredGaps ? plural(counts.preferredGaps, "preferred gap") : "",
    counts.preferenceGaps ? plural(counts.preferenceGaps, "preference conflict") : "",
    counts.unknown + counts.unverified
      ? `${counts.unknown + counts.unverified} unknown or unverified`
      : "",
    counts.conflicts ? plural(counts.conflicts, "conflict") + " in your data" : "",
  ].filter(Boolean);
  const lead =
    insufficient === "CANDIDATE"
      ? "Too many requirements cannot be assessed from your profile yet. "
      : "";
  return `${lead}${parts.join(", ")}.`;
}

/** Evaluate every requirement and aggregate — the whole deterministic engine. */
export function computeMatch(
  input: ComputeInput,
): MatchComputation & { insufficient: "JOB" | "CANDIDATE" | null } {
  const ctx: EvalContext = {
    candidate: input.candidate,
    settings: input.settings ?? DEFAULT_SETTINGS,
    now: input.now ?? new Date(),
    jobCountryCode: input.jobCountryCode ?? null,
  };
  const sources = candidateSkillSources(input.candidate);
  const results = input.requirements.map((req) => evaluateRequirement(req, ctx, sources));
  return aggregate(input.requirements, results);
}

/** Aggregate already-evaluated results (also used after AI-assisted refinement). */
export function aggregate(requirements: RequirementLike[], results: RequirementResult[]) {
  const counts = countResults(requirements, results);
  const { status, insufficient } = overall(requirements, results, counts);
  const blocks = results.filter((r) => r.isHardBlock);
  const hardBlockReason = blocks.length
    ? blocks
        .map((b) => b.explanation)
        .join(" ")
        .slice(0, 1000)
    : null;
  return {
    overallStatus: status,
    hardBlockReason,
    results,
    counts,
    dimensions: dimensionSummaries(requirements, results),
    summary: summarize(status, counts, insufficient, hardBlockReason),
    insufficient,
  };
}
