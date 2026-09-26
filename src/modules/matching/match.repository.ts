import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import type { Dimension } from "./types";

/** Persistence for requirements and match results. All queries are user-scoped (and RLS-enforced). */

export function findCurrentRequirementSet(tx: Tx, jobId: string) {
  return tx.jobRequirementSet.findFirst({
    where: { jobId, isCurrent: true },
    include: { requirements: { orderBy: { position: "asc" } } },
  });
}

export type RequirementRow = Omit<
  Prisma.JobRequirementUncheckedCreateInput,
  "jobId" | "setId" | "position" | "id"
>;

/**
 * Creates the next numbered set for a job and makes it current. The previous set is kept
 * (superseded), so earlier match results stay traceable to the exact requirements used.
 */
export async function createRequirementSet(
  tx: Tx,
  jobId: string,
  input: { extractorVersion: string; jobContentHash: string; rows: RequirementRow[] },
) {
  const last = await tx.jobRequirementSet.findFirst({
    where: { jobId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  await tx.jobRequirementSet.updateMany({
    where: { jobId, isCurrent: true },
    data: { isCurrent: false },
  });
  const set = await tx.jobRequirementSet.create({
    data: {
      jobId,
      version: (last?.version ?? 0) + 1,
      extractorVersion: input.extractorVersion,
      jobContentHash: input.jobContentHash,
      requirementCount: input.rows.length,
    },
  });
  if (input.rows.length)
    await tx.jobRequirement.createMany({
      data: input.rows.map((r, position) => ({ ...r, jobId, setId: set.id, position })),
    });
  return findCurrentRequirementSet(tx, jobId);
}

const matchInclude = {
  dimensions: true,
  requirementSet: { select: { id: true, version: true, extractorVersion: true, isCurrent: true } },
} as const;

/** The current (latest) match of a job for this user. */
export function findCurrentMatch(tx: Tx, userId: string, jobId: string) {
  return tx.jobMatch.findFirst({
    where: { userId, jobId, isCurrent: true },
    include: matchInclude,
  });
}

/** One match version with its per-requirement results (in requirement order). */
export function findMatchById(tx: Tx, userId: string, matchId: string) {
  return tx.jobMatch.findFirst({
    where: { id: matchId, userId },
    include: {
      ...matchInclude,
      requirementResults: {
        orderBy: { position: "asc" },
        include: {
          requirement: {
            select: {
              id: true,
              category: true,
              requirementType: true,
              text: true,
              sourceText: true,
              sourceReference: true,
              confidence: true,
            },
          },
        },
      },
    },
  });
}

/** All match versions of a job for this user, newest first (history is never deleted). */
export function findMatchHistory(tx: Tx, userId: string, jobId: string, take = 50) {
  return tx.jobMatch.findMany({
    where: { userId, jobId },
    select: {
      id: true,
      overallStatus: true,
      isCurrent: true,
      matchingVersion: true,
      computedAt: true,
      counts: true,
      semanticAssist: true,
      requirementSet: { select: { version: true } },
    },
    orderBy: { computedAt: "desc" },
    take,
  });
}

export function findCurrentMatches(
  tx: Tx,
  userId: string,
  filter: { statuses?: string[]; take?: number } = {},
) {
  return tx.jobMatch.findMany({
    where: {
      userId,
      isCurrent: true,
      job: { deletedAt: null },
      ...(filter.statuses?.length ? { overallStatus: { in: filter.statuses } } : {}),
    },
    include: {
      job: {
        select: {
          id: true,
          title: true,
          contentHash: true,
          status: true,
          company: { select: { name: true } },
          requirementSets: { where: { isCurrent: true }, select: { id: true } },
        },
      },
    },
    orderBy: [{ computedAt: "desc" }],
    take: filter.take ?? 200,
  });
}

/** Current match status per job (for list indicators). */
export function findCurrentStatuses(tx: Tx, userId: string, jobIds: string[]) {
  if (!jobIds.length) return Promise.resolve([]);
  return tx.jobMatch.findMany({
    where: { userId, isCurrent: true, jobId: { in: jobIds } },
    select: {
      id: true,
      jobId: true,
      overallStatus: true,
      matchingVersion: true,
      candidateSnapshotHash: true,
      jobContentHash: true,
      requirementSetId: true,
    },
  });
}

export interface MatchVersionRow {
  candidateId: string;
  requirementSetId: string;
  overallStatus: string;
  hardBlockReason: string | null;
  explanation: object;
  summary: string;
  counts: object;
  matchingVersion: string;
  candidateSnapshotHash: string;
  jobContentHash: string;
  semanticAssist: string;
  aiGenerationId: string | null;
  durationMs: number;
  dimensions: {
    dimension: Dimension;
    status: string;
    isHard: boolean;
    summary: string;
    evidence: object[];
  }[];
  results: {
    requirementId: string;
    position: number;
    status: string;
    relationship: string | null;
    gapKind: string | null;
    isHardBlock: boolean;
    evidence: object[];
    explanation: string;
    method: string;
  }[];
}

/**
 * Store a NEW match version and make it current. Earlier versions are kept (is_current = false)
 * so match history stays traceable. The caller holds a row lock on the job for this user.
 */
export async function insertMatchVersion(
  tx: Tx,
  userId: string,
  jobId: string,
  row: MatchVersionRow,
) {
  const { dimensions, results, ...fields } = row;
  await tx.jobMatch.updateMany({
    where: { userId, jobId, isCurrent: true },
    data: { isCurrent: false },
  });
  const match = await tx.jobMatch.create({
    data: {
      ...fields,
      userId,
      jobId,
      isCurrent: true,
      freshness: "CURRENT",
      hardBlock: fields.overallStatus === "BLOCKED",
      summaryScore: null,
      computedAt: new Date(),
    },
  });
  if (dimensions.length)
    await tx.jobMatchDimension.createMany({
      data: dimensions.map((d) => ({ ...d, matchId: match.id, userId })),
    });
  if (results.length)
    await tx.jobMatchRequirementResult.createMany({
      data: results.map((r) => ({ ...r, matchId: match.id, userId })),
    });
  return match;
}

// --- Matching preferences ------------------------------------------------------------

export function findMatchingPreferences(tx: Tx, userId: string) {
  return tx.matchingPreferences.findUnique({ where: { userId } });
}

export function upsertMatchingPreferences(
  tx: Tx,
  userId: string,
  data: Omit<Prisma.MatchingPreferencesUncheckedCreateInput, "userId" | "id">,
) {
  return tx.matchingPreferences.upsert({
    where: { userId },
    create: { ...data, userId },
    update: data,
  });
}
