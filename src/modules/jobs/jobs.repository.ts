import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";

/**
 * Job persistence. Every read is restricted to jobs the user may see
 * (shared PUBLIC jobs or their own PRIVATE jobs) — the same rule RLS enforces.
 */

export function visibleTo(userId: string): Prisma.JobWhereInput {
  return {
    deletedAt: null,
    OR: [{ visibility: "PUBLIC" }, { createdByUserId: userId }],
  };
}

const listSelect = {
  id: true,
  title: true,
  locationRaw: true,
  city: true,
  countryCode: true,
  remoteStatus: true,
  employmentType: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  salaryRaw: true,
  postedAt: true,
  lastSeenAt: true,
  status: true,
  sourceKey: true,
  company: { select: { name: true } },
  source: { select: { sourceName: true } },
} satisfies Prisma.JobSelect;

export function findVisibleJobs(tx: Tx, userId: string, take = 200) {
  return tx.job.findMany({
    where: visibleTo(userId),
    select: listSelect,
    orderBy: [{ createdAt: "desc" }],
    take,
  });
}

export function findVisibleJob(tx: Tx, userId: string, id: string) {
  return tx.job.findFirst({
    where: { id, ...visibleTo(userId) },
    include: { company: true, source: { select: { id: true, sourceName: true, sourceKey: true } } },
  });
}

export function findOwnManualJob(tx: Tx, userId: string, id: string) {
  return tx.job.findFirst({
    where: {
      id,
      createdByUserId: userId,
      visibility: "PRIVATE",
      sourceKey: "MANUAL",
      deletedAt: null,
    },
    include: { company: true },
  });
}

/** Create-or-reuse a company by normalised name. Companies are never renamed by users. */
export async function findOrCreateCompany(tx: Tx, name: string, nameNormalized: string) {
  const existing = await tx.company.findUnique({ where: { nameNormalized } });
  if (existing) return { company: existing, created: false };
  const company = await tx.company.create({ data: { name, nameNormalized } });
  return { company, created: true };
}

export function insertJob(tx: Tx, data: Prisma.JobUncheckedCreateInput) {
  return tx.job.create({ data });
}

export function updateJob(tx: Tx, id: string, data: Prisma.JobUncheckedUpdateInput) {
  return tx.job.update({ where: { id }, data });
}

export function countJobsBySource(tx: Tx, userId: string, sourceIds: string[]) {
  return tx.job.groupBy({
    by: ["sourceId"],
    where: { sourceId: { in: sourceIds }, ...visibleTo(userId) },
    _count: { _all: true },
  });
}
