import "server-only";
import { resolveFactRefs } from "@/modules/candidate";
import { isUsableStatus } from "@/modules/candidate/provenance";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/session";
import {
  createRequirementSet,
  findCurrentRequirementSet,
  findMatch,
  findMatches,
  upsertMatch,
} from "./match.repository";
import {
  MATCHING_VERSION,
  matchResultInput,
  requirementInput,
  type Dimension,
  type Freshness,
  type MatchResultInput,
  type RequirementInput,
} from "./types";

/**
 * Matching foundation (Phase 4 / Checkpoint 1): persistence, validation and
 * freshness. The evaluators that PRODUCE results arrive in later checkpoints;
 * everything they save must pass saveMatchResult's validation:
 *   - Zod contract (statuses, hard-block consistency, evidence-first statements)
 *   - every requirementId belongs to the job
 *   - every factRef resolves to the caller's OWN candidate fact, and
 *     supporting evidence may only cite VERIFIED / USER_PROVIDED facts
 *     (AI_INFERRED / NEEDS_REVIEW facts never become evidence)
 * Verification labels on evidence are taken from the database, never from input.
 */

export type ActorRef = Pick<Actor, "userId">;

/** Job must be visible to the caller (shared, or their own private job). */
async function loadVisibleJob(t: Tx, actor: ActorRef, jobId: string) {
  const job = await t.job.findFirst({
    where: {
      id: jobId,
      deletedAt: null,
      OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
    },
    select: { id: true, visibility: true, createdByUserId: true, contentHash: true },
  });
  if (!job) throw new AppError("NOT_FOUND");
  return job;
}

// --- Requirements ------------------------------------------------------------------

/** The job's current requirement set (without extracting). See requirements.service for extraction. */
export async function listJobRequirements(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    await loadVisibleJob(t, actor, jobId);
    return (await findCurrentRequirementSet(t, jobId))?.requirements ?? [];
  });
}

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

/**
 * Fingerprint of everything a match depends on for this user: usable facts,
 * profile and preferences. Any change makes existing matches STALE.
 */
export async function candidateSnapshotHash(t: Tx, actor: ActorRef): Promise<string> {
  const where = { userId: actor.userId, deletedAt: null };
  const select = { id: true, updatedAt: true, verificationStatus: true } as const;
  const parts = [
    await t.candidateProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true, updatedAt: true },
    }),
    await t.candidatePreferences.findUnique({
      where: { userId: actor.userId },
      select: { updatedAt: true },
    }),
    await t.candidateTargetLocation.findMany({
      where: { userId: actor.userId },
      select: { id: true, updatedAt: true },
      orderBy: { id: "asc" },
    }),
    await t.candidateEducation.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateExperience.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateSkill.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateProject.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateCertification.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidatePortfolioItem.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateLanguage.findMany({ where, select, orderBy: { id: "asc" } }),
    await t.candidateWorkAuthorization.findMany({ where, select, orderBy: { id: "asc" } }),
  ];
  return sha256Hex(JSON.stringify(parts));
}

/** Job side of a match: its content plus the exact requirement set version used. */
async function jobSnapshotHash(t: Tx, jobId: string, jobContentHash: string): Promise<string> {
  const set = await t.jobRequirementSet.findFirst({
    where: { jobId, isCurrent: true },
    select: { id: true, version: true },
  });
  return sha256Hex(JSON.stringify([jobContentHash, set?.id ?? null, set?.version ?? null]));
}

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

// --- Match results -----------------------------------------------------------------

export async function getMatchForJob(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    const match = await findMatch(t, actor.userId, jobId);
    if (!match) return null;
    const freshness = computeFreshness(match, {
      candidateHash: await candidateSnapshotHash(t, actor),
      jobHash: await jobSnapshotHash(t, jobId, job.contentHash),
    });
    return { ...match, freshness };
  });
}

export async function listMatches(actor: ActorRef) {
  return withUserContext(actor.userId, (t) => findMatches(t, actor.userId));
}

/** Persist a match result after full validation (used by the evaluators from Checkpoint 3 on). */
export async function saveMatchResult(actor: ActorRef, jobId: string, raw: MatchResultInput) {
  const result = matchResultInput.parse(raw);
  const factRefs = new Set<string>();
  const requirementIds = new Set<string>();
  for (const d of result.dimensions) {
    for (const e of d.evidence) {
      if (e.factRef) factRefs.add(e.factRef.toLowerCase());
      if (e.requirementId) requirementIds.add(e.requirementId);
    }
  }
  for (const s of [
    ...result.explanation.fits,
    ...result.explanation.gaps,
    ...result.explanation.unknowns,
  ]) {
    s.factRefs.forEach((f) => factRefs.add(f.toLowerCase()));
    s.requirementIds.forEach((r) => requirementIds.add(r));
  }

  // Resolve facts in the caller's own knowledge base (foreign or unknown refs are dropped by resolveFactRefs).
  const facts = await resolveFactRefs(actor, [...factRefs]);
  const byRef = new Map(facts.map((f) => [f.ref.toLowerCase(), f]));
  const missing = [...factRefs].filter((r) => !byRef.has(r));
  if (missing.length > 0) {
    throw new AppError("VALIDATION_ERROR", {
      message: `Unknown or foreign fact references: ${missing.length}`,
    });
  }
  for (const d of result.dimensions) {
    for (const e of d.evidence) {
      if ((e.outcome === "SUPPORTS" || e.outcome === "PARTIAL") && e.factRef) {
        const fact = byRef.get(e.factRef.toLowerCase())!;
        if (!isUsableStatus(fact.verificationStatus)) {
          throw new AppError("VALIDATION_ERROR", {
            message: `Fact ${e.factRef} is ${fact.verificationStatus} and cannot support a match`,
          });
        }
      }
    }
  }
  for (const ref of result.explanation.fits.flatMap((s) => s.factRefs)) {
    if (!isUsableStatus(byRef.get(ref.toLowerCase())!.verificationStatus)) {
      throw new AppError("VALIDATION_ERROR", { message: `Fact ${ref} is not usable as evidence` });
    }
  }

  return withUserContext(actor.userId, async (t) => {
    const job = await loadVisibleJob(t, actor, jobId);
    const profile = await t.candidateProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!profile)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Create your candidate profile before analyzing matches.",
      });
    if (requirementIds.size > 0) {
      const found = await t.jobRequirement.count({
        where: { jobId, id: { in: [...requirementIds] }, set: { isCurrent: true } },
      });
      if (found !== requirementIds.size) {
        throw new AppError("VALIDATION_ERROR", {
          message: "Evidence cites requirements that do not belong to this job",
        });
      }
    }
    const saved = await upsertMatch(t, actor.userId, jobId, {
      candidateId: profile.id,
      overallStatus: result.overallStatus,
      summaryScore: result.summaryScore,
      hardBlock: result.hardBlock,
      hardBlockReason: result.hardBlockReason,
      explanation: result.explanation,
      matchingVersion: MATCHING_VERSION,
      candidateSnapshotHash: await candidateSnapshotHash(t, actor),
      jobContentHash: await jobSnapshotHash(t, jobId, job.contentHash),
      dimensions: result.dimensions.map((d) => ({
        dimension: d.dimension as Dimension,
        status: d.status,
        isHard: d.isHard,
        summary: d.summary,
        // Verification labels come from the database, never from the caller.
        evidence: d.evidence.map((e) => ({
          ...e,
          verification: e.factRef ? byRef.get(e.factRef.toLowerCase())!.verificationStatus : null,
        })),
      })),
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "match_completed",
      resourceType: "job_match",
      resourceId: saved!.id,
      metadata: {
        jobId,
        overallStatus: result.overallStatus,
        matchingVersion: MATCHING_VERSION,
        dimensions: result.dimensions.length,
      },
    });
    return saved!;
  });
}
