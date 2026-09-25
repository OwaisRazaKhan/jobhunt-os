import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import type { Dimension } from "./types";

/** Persistence for requirements and match results. All queries are user-scoped (and RLS-enforced). */

export function findRequirements(tx: Tx, jobId: string) {
  return tx.jobRequirement.findMany({
    where: { jobId },
    orderBy: [{ category: "asc" }, { createdAt: "asc" }],
  });
}

export async function replaceRequirements(
  tx: Tx,
  jobId: string,
  rows: Omit<Prisma.JobRequirementUncheckedCreateInput, "jobId">[],
) {
  await tx.jobRequirement.deleteMany({ where: { jobId } });
  if (rows.length > 0)
    await tx.jobRequirement.createMany({ data: rows.map((r) => ({ ...r, jobId })) });
  return findRequirements(tx, jobId);
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
