import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { uuidv7 } from "@/lib/ids";
import type { Tx } from "@/server/db";
import type { DraftClaim } from "./types";

/** Research persistence. Every query runs inside withUserContext (RLS) and is scoped by userId. */

export const visibleJobWhere = (userId: string, jobId: string) => ({
  id: jobId,
  deletedAt: null,
  OR: [{ visibility: "PUBLIC" }, { createdByUserId: userId }],
});

export function findVisibleJob(t: Tx, userId: string, jobId: string) {
  return t.job.findFirst({
    where: visibleJobWhere(userId, jobId),
    select: {
      id: true,
      title: true,
      description: true,
      sourceKey: true,
      jobUrl: true,
      applicationUrl: true,
      contentHash: true,
      lastSeenAt: true,
      visibility: true,
      companyId: true,
      company: {
        select: {
          id: true,
          name: true,
          officialWebsite: true,
          websiteConfidence: true,
          websiteSource: true,
        },
      },
    },
  });
}

export function findCompany(t: Tx, companyId: string) {
  return t.company.findUnique({ where: { id: companyId } });
}

export function findTarget(t: Tx, userId: string, companyId: string) {
  return t.companyResearchTarget.findUnique({ where: { userId_companyId: { userId, companyId } } });
}

export function findSettings(t: Tx, userId: string) {
  return t.researchSettings.findUnique({ where: { userId } });
}

export function findCurrentCompanyResearch(t: Tx, userId: string, companyId: string) {
  return t.companyResearch.findFirst({ where: { userId, companyId, isCurrent: true } });
}

export function findCurrentJobResearch(t: Tx, userId: string, jobId: string) {
  return t.jobResearch.findFirst({ where: { userId, jobId, isCurrent: true } });
}

export function findActiveRun(t: Tx, userId: string) {
  return t.researchRun.findFirst({ where: { userId, status: { in: ["QUEUED", "RUNNING"] } } });
}

// --- Sources ---------------------------------------------------------------------------------

export interface SourceInput {
  companyId: string | null;
  jobId: string | null;
  url: string;
  normalizedUrl: string;
  sourceType: string;
  reliability: string;
  relevance: string;
  origin: string;
  fetchStatus: string;
  httpStatus: number | null;
  error: string | null;
  title: string | null;
  publishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  retrievedAt: Date | null;
  contentHash: string | null;
  contentText: string | null;
  addedByUser?: boolean;
}

/**
 * Deduplicate: the same normalized URL with the same content hash reuses the existing row
 * (retrieved_at refreshed); changed content creates a new row so older evidence stays intact.
 */
export async function upsertSource(t: Tx, userId: string, input: SourceInput) {
  const latest = await t.researchSource.findFirst({
    where: { userId, normalizedUrl: input.normalizedUrl },
    orderBy: { createdAt: "desc" },
  });
  const sameContent =
    latest &&
    latest.fetchStatus === input.fetchStatus &&
    latest.contentHash === input.contentHash &&
    latest.sourceType === input.sourceType;
  if (latest && sameContent) {
    const updated = await t.researchSource.update({
      where: { id: latest.id },
      data: {
        retrievedAt: input.retrievedAt ?? latest.retrievedAt,
        relevance: input.relevance,
        httpStatus: input.httpStatus,
        error: input.error,
        ...(input.addedByUser && !latest.addedByUser
          ? { addedByUser: true, addedAt: new Date() }
          : {}),
      },
    });
    return { source: updated, changed: false, previousHash: latest.contentHash };
  }
  const { addedByUser, ...rest } = input;
  const created = await t.researchSource.create({
    data: {
      ...rest,
      userId,
      title: rest.title?.slice(0, 500) ?? null,
      error: rest.error?.slice(0, 500) ?? null,
      contentText: rest.contentText?.slice(0, 20_000) ?? null,
      addedByUser: Boolean(addedByUser),
      addedAt: addedByUser ? new Date() : null,
    },
  });
  return { source: created, changed: Boolean(latest), previousHash: latest?.contentHash ?? null };
}

// --- Claims ----------------------------------------------------------------------------------

/** Insert claims + evidence. `sourceIds` maps a draft's sourceKey to the stored source id. */
export async function insertClaims(
  t: Tx,
  userId: string,
  owner: { companyResearchId: string } | { jobResearchId: string },
  drafts: DraftClaim[],
  sourceIds: Map<string, string>,
) {
  const claimRows: Prisma.ResearchClaimCreateManyInput[] = [];
  const evidenceRows: Prisma.ResearchClaimEvidenceCreateManyInput[] = [];
  const ids: string[] = [];
  drafts.forEach((d, position) => {
    const id = uuidv7();
    ids.push(id);
    claimRows.push({
      id,
      userId,
      ...owner,
      position,
      section: d.section,
      claim: d.claim.slice(0, 1000),
      claimType: d.claimType,
      verification: d.verification,
      method: d.method,
      valueKey: d.valueKey ?? null,
      value: d.value?.slice(0, 300) ?? null,
      temporal: d.temporal ?? "UNDATED",
      rejectionReason:
        d.verification === "REJECTED" ? (d.rejectionReason ?? "Rejected").slice(0, 500) : null,
    });
    const seen = new Set<string>();
    for (const e of d.evidence) {
      const sourceId = sourceIds.get(e.sourceKey);
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      evidenceRows.push({
        userId,
        claimId: id,
        sourceId,
        excerpt: e.excerpt.slice(0, 1000) || "(empty)",
        sourceReference: e.reference?.slice(0, 200) ?? null,
      });
    }
  });
  if (claimRows.length) await t.researchClaim.createMany({ data: claimRows });
  if (evidenceRows.length) await t.researchClaimEvidence.createMany({ data: evidenceRows });
  return ids;
}

export const claimInclude = {
  evidence: {
    include: {
      source: {
        select: {
          id: true,
          url: true,
          title: true,
          sourceType: true,
          reliability: true,
          retrievedAt: true,
          publishedAt: true,
          addedByUser: true,
        },
      },
    },
  },
} as const;

export function findJobResearchVersion(t: Tx, userId: string, jobId: string, id?: string) {
  return t.jobResearch.findFirst({
    where: id ? { id, userId, jobId } : { userId, jobId, isCurrent: true },
    include: { claims: { orderBy: { position: "asc" }, include: claimInclude } },
  });
}

export function findCompanyResearchVersion(t: Tx, userId: string, companyId: string, id?: string) {
  return t.companyResearch.findFirst({
    where: id ? { id, userId, companyId } : { userId, companyId, isCurrent: true },
    include: { claims: { orderBy: { position: "asc" }, include: claimInclude } },
  });
}

export function findRunSources(t: Tx, userId: string, runId: string) {
  return t.researchRunSource.findMany({
    where: { userId, runId },
    include: { source: true },
    orderBy: { createdAt: "asc" },
  });
}
