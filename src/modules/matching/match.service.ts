import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import type { Actor } from "@/server/session";
import { aggregate, computeMatch } from "./engine/aggregate";
import type { RequirementLike } from "./engine/types";
import { candidateHash, jobHash, loadCandidateEvidence, loadMatchingSettings } from "./evidence";
import {
  createRequirementSet,
  findCurrentMatch,
  findCurrentMatches,
  findCurrentStatuses,
  findMatchById,
  findMatchHistory,
  findMatchingPreferences,
  insertMatchVersion,
  upsertMatchingPreferences,
} from "./match.repository";
import { ensureJobRequirements } from "./requirements/requirements.service";
import { applySemanticAssist, type SemanticStatus } from "./semantic";
import {
  MATCHING_VERSION,
  matchingPreferencesInput,
  requirementInput,
  type Dimension,
  type Freshness,
  type RequirementInput,
} from "./types";

/**
 * MatchingService (Phase 4). The reusable entry point is matchCandidateToJob():
 *   1. make sure the job has a current requirement set (deterministic extractor)
 *   2. load the caller's OWN candidate evidence + matching settings (RLS-scoped)
 *   3. run the deterministic engine; optionally let local AI propose RELATED skill links
 *   4. store a NEW match version (history kept), unless nothing changed (idempotent)
 * The result is a requirements-alignment analysis — never a hiring prediction.
 */

export type ActorRef = Pick<Actor, "userId">;

export const NO_PROFILE_MESSAGE = "Complete your candidate profile before running a match.";

/** Job must be visible to the caller (shared, or their own private job). */
async function loadVisibleJob(t: Tx, actor: ActorRef, jobId: string) {
  const job = await t.job.findFirst({
    where: {
      id: jobId,
      deletedAt: null,
      OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
    },
    select: {
      id: true,
      visibility: true,
      createdByUserId: true,
      contentHash: true,
      countryCode: true,
    },
  });
  if (!job) throw new AppError("NOT_FOUND");
  return job;
}

// --- Requirements (manual override for private jobs) -------------------------------

/**
 * Replace a private job's requirements by hand (method USER). Creates a new set version;
 * requirements of shared jobs are maintained by the system extractor only.
 */
export async function replaceJobRequirements(
  actor: ActorRef,
  jobId: string,
  rawRows: RequirementInput[],
) {
  const rows = rawRows.map((r) => requirementInput.parse(r));
  return withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    if (job.visibility !== "PRIVATE" || job.createdByUserId !== actor.userId) {
      throw new AppError("PERMISSION_ERROR", {
        publicMessage: "Requirements of shared jobs are maintained by the system.",
      });
    }
    return createRequirementSet(t, jobId, {
      extractorVersion: "user",
      jobContentHash: job.contentHash,
      rows: rows.map((r) => ({ ...r, normalizedValue: r.normalizedValue as object })),
    });
  });
}

// --- Freshness ---------------------------------------------------------------------

export function computeFreshness(
  match: { matchingVersion: string; candidateSnapshotHash: string; jobContentHash: string },
  current: { candidateHash: string; jobHash: string },
): Freshness {
  if (match.matchingVersion !== MATCHING_VERSION) return "REQUIRES_RECALCULATION";
  if (
    match.candidateSnapshotHash !== current.candidateHash ||
    match.jobContentHash !== current.jobHash
  )
    return "STALE";
  return "CURRENT";
}

async function currentCandidateHash(t: Tx, userId: string) {
  const [evidence, settings] = [
    await loadCandidateEvidence(t, userId),
    await loadMatchingSettings(t, userId),
  ];
  return { evidence, settings, hash: candidateHash(evidence, settings) };
}

async function currentJobHash(t: Tx, jobId: string, contentHash: string) {
  const set = await t.jobRequirementSet.findFirst({
    where: { jobId, isCurrent: true },
    select: { id: true, version: true },
  });
  return jobHash(contentHash, set);
}

// --- Run a match -------------------------------------------------------------------

export interface MatchOptions {
  /** Where the request came from (audit metadata only). */
  source?: "MANUAL" | "BATCH" | "WORKFLOW";
}

/**
 * Match the caller's candidate profile against one job. `candidateId` must be the caller's own
 * profile (there is one per user); anything else is NOT_FOUND. Safe to call twice (double click):
 * unchanged inputs return the existing current match instead of a duplicate version.
 */
export async function matchCandidateToJob(
  actor: ActorRef,
  candidateId: string | null,
  jobId: string,
  options: MatchOptions = {},
) {
  const started = Date.now();
  const { set } = await ensureJobRequirements(actor, jobId);

  const prepared = await withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    const cand = await currentCandidateHash(t, actor.userId);
    if (!cand.evidence)
      throw new AppError("VALIDATION_ERROR", { publicMessage: NO_PROFILE_MESSAGE });
    if (candidateId && cand.evidence.profile.id !== candidateId) throw new AppError("NOT_FOUND");
    const jHash = jobHash(job.contentHash, set);
    const existing = await findCurrentMatch(t, actor.userId, jobId);
    return { job, cand, jHash, existing };
  });
  const { job, cand, jHash, existing } = prepared;
  const evidence = cand.evidence!;
  const unchanged = (m: {
    matchingVersion: string;
    candidateSnapshotHash: string;
    jobContentHash: string;
  }) => computeFreshness(m, { candidateHash: cand.hash, jobHash: jHash }) === "CURRENT";
  if (existing && unchanged(existing)) return { match: existing, reused: true };

  const requirements: RequirementLike[] = set.requirements.map((r) => ({
    id: r.id,
    category: r.category,
    requirementType: r.requirementType,
    text: r.text,
    normalizedValue: (r.normalizedValue ?? {}) as Record<string, unknown>,
    sourceText: r.sourceText,
  }));
  let computed = computeMatch({
    requirements,
    candidate: evidence,
    settings: cand.settings,
    jobCountryCode: job.countryCode,
  });
  let semantic: SemanticStatus = "NOT_USED";
  let aiGenerationId: string | null = null;
  if (cand.settings.semanticAssist) {
    try {
      const assisted = await applySemanticAssist({
        userId: actor.userId,
        requirements,
        results: computed.results,
        candidate: evidence,
      });
      semantic = assisted.status;
      aiGenerationId = assisted.generationId;
      if (assisted.status === "APPLIED") computed = aggregate(requirements, assisted.results);
    } catch (error) {
      // AI failure never fails the match: the deterministic result stands.
      semantic = "UNAVAILABLE";
      logger.warn("semantic assist failed", {
        category: "ai",
        error: error instanceof Error ? { name: error.name } : undefined,
      });
    }
  }

  const positions = new Map(set.requirements.map((r) => [r.id, r.position]));
  const match = await withUserContext(actor.userId, async (t) => {
    // Serialise per user+job so concurrent clicks cannot create two versions.
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`match:${actor.userId}:${jobId}`}, 0))`;
    const again = await findCurrentMatch(t, actor.userId, jobId);
    if (again && unchanged(again)) return { row: again, reused: true };
    const row = await insertMatchVersion(t, actor.userId, jobId, {
      candidateId: evidence.profile.id,
      requirementSetId: set.id,
      overallStatus: computed.overallStatus,
      hardBlockReason: computed.hardBlockReason,
      explanation: {
        insufficient: computed.insufficient,
        requirementSetVersion: set.version,
        extractorVersion: set.extractorVersion,
      },
      summary: computed.summary.slice(0, 2000),
      counts: computed.counts,
      matchingVersion: MATCHING_VERSION,
      candidateSnapshotHash: cand.hash,
      jobContentHash: jHash,
      semanticAssist: semantic,
      aiGenerationId,
      durationMs: Date.now() - started,
      dimensions: computed.dimensions.map((d) => ({
        dimension: d.dimension as Dimension,
        status: d.status,
        isHard: d.isHard,
        summary: d.summary,
        evidence: [],
      })),
      results: computed.results.map((r) => ({
        requirementId: r.requirementId,
        position: positions.get(r.requirementId) ?? 0,
        status: r.status,
        relationship: r.relationship,
        gapKind: r.gapKind,
        isHardBlock: r.isHardBlock,
        evidence: r.evidence as object[],
        explanation: r.explanation,
        method: r.method,
      })),
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: existing ? "match_recalculated" : "match_completed",
      resourceType: "job_match",
      resourceId: row.id,
      metadata: {
        jobId,
        overallStatus: computed.overallStatus,
        matchingVersion: MATCHING_VERSION,
        requirementSetVersion: set.version,
        requirements: computed.counts.total,
        semanticAssist: semantic,
        source: options.source ?? "MANUAL",
        previousVersion: existing?.matchingVersion ?? null,
      },
    });
    return { row: (await findCurrentMatch(t, actor.userId, jobId))!, reused: false };
  });
  logger.info("match computed", {
    overallStatus: match.row.overallStatus,
    requirements: computed.counts.total,
    durationMs: Date.now() - started,
    semanticAssist: semantic,
    reused: match.reused,
  });
  return { match: match.row, reused: match.reused };
}

// --- Read models -------------------------------------------------------------------

/** Job-detail card: the current match (with freshness) and what is needed to run one. */
export async function getMatchForJob(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    const match = await findCurrentMatch(t, actor.userId, jobId);
    const cand = await currentCandidateHash(t, actor.userId);
    if (!match) return { match: null, hasProfile: Boolean(cand.evidence) };
    const freshness = computeFreshness(match, {
      candidateHash: cand.hash,
      jobHash: await currentJobHash(t, jobId, job.contentHash),
    });
    return { match: { ...match, freshness }, hasProfile: Boolean(cand.evidence) };
  });
}

/** Full match detail (a given version, or the current one) with requirement results and history. */
export async function getMatchDetail(actor: ActorRef, jobId: string, matchId?: string) {
  return withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    const current = await findCurrentMatch(t, actor.userId, jobId);
    const id = matchId ?? current?.id;
    const cand = await currentCandidateHash(t, actor.userId);
    const history = await findMatchHistory(t, actor.userId, jobId);
    if (!id) return { match: null, history, hasProfile: Boolean(cand.evidence) };
    const match = await findMatchById(t, actor.userId, id);
    if (!match || match.jobId !== jobId) throw new AppError("NOT_FOUND");
    const freshness = match.isCurrent
      ? computeFreshness(match, {
          candidateHash: cand.hash,
          jobHash: await currentJobHash(t, jobId, job.contentHash),
        })
      : ("STALE" as Freshness);
    return { match: { ...match, freshness }, history, hasProfile: Boolean(cand.evidence) };
  });
}

/** The caller's current matches (one per job), newest first, each with freshness. */
export async function listCurrentMatches(actor: ActorRef, filter: { statuses?: string[] } = {}) {
  return withUserContext(actor.userId, async (t) => {
    const rows = await findCurrentMatches(t, actor.userId, filter);
    const cand = await currentCandidateHash(t, actor.userId);
    const sets = new Map(
      (
        await t.jobRequirementSet.findMany({
          where: { isCurrent: true, jobId: { in: rows.map((r) => r.jobId) } },
          select: { id: true, version: true, jobId: true },
        })
      ).map((s) => [s.jobId, s]),
    );
    return rows.map((r) => ({
      ...r,
      freshness: computeFreshness(r, {
        candidateHash: cand.hash,
        jobHash: jobHash(r.job.contentHash, sets.get(r.jobId) ?? null),
      }),
    }));
  });
}

/** Match indicator per job for list views (reads stored matches; never computes one). */
export async function getMatchIndicators(actor: ActorRef, jobIds: string[]) {
  const out = new Map<string, { status: string; freshness: Freshness }>();
  if (!jobIds.length) return out;
  return withUserContext(actor.userId, async (t) => {
    const rows = await findCurrentStatuses(t, actor.userId, jobIds);
    if (!rows.length) return out;
    const cand = await currentCandidateHash(t, actor.userId);
    const ids = rows.map((r) => r.jobId);
    const jobs = new Map(
      (
        await t.job.findMany({
          where: { id: { in: ids } },
          select: { id: true, contentHash: true },
        })
      ).map((j) => [j.id, j.contentHash]),
    );
    const sets = new Map(
      (
        await t.jobRequirementSet.findMany({
          where: { isCurrent: true, jobId: { in: ids } },
          select: { id: true, version: true, jobId: true },
        })
      ).map((s) => [s.jobId, s]),
    );
    for (const r of rows)
      out.set(r.jobId, {
        status: r.overallStatus,
        freshness: computeFreshness(r, {
          candidateHash: cand.hash,
          jobHash: jobHash(jobs.get(r.jobId) ?? "", sets.get(r.jobId) ?? null),
        }),
      });
    return out;
  });
}

// --- Matching preferences ------------------------------------------------------------

export async function getMatchingPreferences(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const row = await findMatchingPreferences(t, actor.userId);
    return {
      workModeHard: row?.workModeHard ?? false,
      employmentTypeHard: row?.employmentTypeHard ?? false,
      locationHard: row?.locationHard ?? false,
      salaryMinHard: row?.salaryMinHard ?? false,
      semanticAssist: row?.semanticAssist ?? false,
    };
  });
}

export async function saveMatchingPreferences(actor: ActorRef, raw: unknown) {
  const data = matchingPreferencesInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const row = await upsertMatchingPreferences(t, actor.userId, data);
    await recordAudit(t, {
      userId: actor.userId,
      action: "matching_preferences_updated",
      resourceType: "matching_preferences",
      resourceId: row.id,
      metadata: { fields: Object.keys(data) },
    });
    return row;
  });
}
