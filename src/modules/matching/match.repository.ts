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

export function findMatch(tx: Tx, userId: string, jobId: string) {
  return tx.jobMatch.findUnique({
    where: { userId_jobId: { userId, jobId } },
    include: { dimensions: true },
  });
}

export function findMatches(tx: Tx, userId: string, take = 200) {
  return tx.jobMatch.findMany({
    where: { userId, job: { deletedAt: null } },
    include: { job: { select: { id: true, title: true, company: { select: { name: true } } } } },
    orderBy: [{ computedAt: "desc" }],
    take,
  });
}

export interface MatchRow {
  candidateId: string;
  overallStatus: string;
  summaryScore: number | null;
  hardBlock: boolean;
  hardBlockReason: string | null;
  explanation: object;
  matchingVersion: string;
  candidateSnapshotHash: string;
  jobContentHash: string;
  dimensions: {
    dimension: Dimension;
    status: string;
    isHard: boolean;
    summary: string;
    evidence: object[];
  }[];
}

/** Upsert a match and fully replace its dimensions (one current result per user + job). */
export async function upsertMatch(tx: Tx, userId: string, jobId: string, row: MatchRow) {
  const { dimensions, ...fields } = row;
  const data = { ...fields, freshness: "CURRENT", computedAt: new Date() };
  const match = await tx.jobMatch.upsert({
    where: { userId_jobId: { userId, jobId } },
    create: { ...data, userId, jobId },
    update: data,
  });
  await tx.jobMatchDimension.deleteMany({ where: { matchId: match.id } });
  await tx.jobMatchDimension.createMany({
    data: dimensions.map((d) => ({ ...d, matchId: match.id, userId })),
  });
  return findMatch(tx, userId, jobId);
}
