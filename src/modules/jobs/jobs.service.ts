import "server-only";
import { normalizeOrganization, normalizeTitle } from "@/lib/text-normalize";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { getDb, withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import {
  countJobsBySource,
  findOrCreateCompany,
  findOwnManualJob,
  findVisibleJob,
  findVisibleJobs,
  insertJob,
  updateJob,
} from "./jobs.repository";
import { manualJobInput, type ManualJobInput } from "./jobs.schemas";
import { getSourceByKey, type ActorRef } from "./sources.service";
import type { JobListItem, JobStatus, RemoteStatus, SalaryPeriod } from "./types";

/**
 * Job use cases (manual entry in Phase 2 / Checkpoint 3).
 * Manual jobs: source MANUAL · source_type MANUAL · source_status USER_ENTERED ·
 * visibility PRIVATE (only the creator can see, edit or delete them).
 */

function contentHash(input: ManualJobInput) {
  return sha256Hex(
    JSON.stringify([
      normalizeTitle(input.title),
      normalizeOrganization(input.company),
      input.locationRaw.toLowerCase(),
      input.countryCode,
      input.description,
      input.jobUrl,
    ]),
  );
}

function columnsFrom(input: ManualJobInput) {
  return {
    title: input.title,
    normalizedTitle: normalizeTitle(input.title),
    description: input.description,
    locationRaw: input.locationRaw,
    // City/region normalisation is a later checkpoint; the raw location is preserved as entered.
    countryCode: input.countryCode,
    employmentType: input.employmentType,
    remoteStatus: input.remoteStatus,
    relocationAvailable: input.relocationAvailable,
    salaryMin: input.salaryMin,
    salaryMax: input.salaryMax,
    salaryCurrency: input.salaryCurrency,
    salaryPeriod: input.salaryPeriod,
    postedAt: input.postedAt ? new Date(`${input.postedAt}T00:00:00.000Z`) : null,
    jobUrl: input.jobUrl,
    applicationUrl: input.applicationUrl,
    visaTextRaw: input.visaTextRaw,
    notes: input.notes,
    contentHash: contentHash(input),
  };
}

async function assertCountry(t: Tx, code: string) {
  const country = await t.country.findUnique({ where: { code } });
  if (!country)
    throw new AppError("VALIDATION_ERROR", {
      details: [{ path: "countryCode", message: "Select a country" }],
    });
}

async function resolveCompany(t: Tx, name: string) {
  const normalized = normalizeOrganization(name);
  if (!normalized) {
    throw new AppError("VALIDATION_ERROR", {
      details: [{ path: "company", message: "Enter a company name with letters or numbers" }],
    });
  }
  return findOrCreateCompany(t, name, normalized);
}

export async function createManualJob(actor: ActorRef, rawInput: unknown) {
  const input = manualJobInput.parse(rawInput);
  return withUserContext(actor.userId, async (t) => {
    const manual = await getSourceByKey(actor, "MANUAL", t);
    if (!manual.enabled) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Manual Entry is disabled. Enable it in Jobs → Sources to add jobs.",
      });
    }
    await assertCountry(t, input.countryCode);
    const { company, created } = await resolveCompany(t, input.company);
    const job = await insertJob(t, {
      ...columnsFrom(input),
      companyId: company.id,
      sourceId: manual.id,
      sourceKey: "MANUAL",
      sourceType: "MANUAL",
      sourceStatus: "USER_ENTERED",
      visibility: "PRIVATE",
      createdByUserId: actor.userId,
      status: "OPEN",
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "job_created",
      resourceType: "job",
      resourceId: job.id,
      metadata: { sourceKey: "MANUAL", companyCreated: created },
    });
    return job;
  });
}

export async function updateManualJob(actor: ActorRef, jobId: string, rawInput: unknown) {
  const input = manualJobInput.parse(rawInput);
  return withUserContext(actor.userId, async (t) => {
    const existing = await findOwnManualJob(t, actor.userId, jobId);
    if (!existing) throw new AppError("NOT_FOUND");
    await assertCountry(t, input.countryCode);
    const { company } = await resolveCompany(t, input.company);
    const columns = columnsFrom(input);
    const changed = Object.entries({ ...columns, companyId: company.id })
      .filter(([key, value]) => {
        const before = (existing as Record<string, unknown>)[key];
        const a = before instanceof Date ? before.getTime() : (before ?? null);
        const b = value instanceof Date ? value.getTime() : (value ?? null);
        return a !== b;
      })
      .map(([key]) => key)
      .filter((key) => key !== "contentHash" && key !== "normalizedTitle");
    if (changed.length === 0) return existing;
    const job = await updateJob(t, existing.id, { ...columns, companyId: company.id });
    await recordAudit(t, {
      userId: actor.userId,
      action: "job_updated",
      resourceType: "job",
      resourceId: job.id,
      metadata: { fields: changed },
    });
    return job;
  });
}

/** Soft delete (retention: purged after 30 days by maintenance). Only the creator of a manual job. */
export async function deleteManualJob(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    const existing = await findOwnManualJob(t, actor.userId, jobId);
    if (!existing) throw new AppError("NOT_FOUND");
    await updateJob(t, existing.id, { deletedAt: new Date() });
    await recordAudit(t, {
      userId: actor.userId,
      action: "job_deleted",
      resourceType: "job",
      resourceId: existing.id,
    });
  });
}

export async function listJobs(actor: ActorRef): Promise<JobListItem[]> {
  const rows = await withUserContext(actor.userId, (t) => findVisibleJobs(t, actor.userId));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    companyName: r.company.name,
    locationRaw: r.locationRaw,
    city: r.city,
    countryCode: r.countryCode,
    remoteStatus: r.remoteStatus as RemoteStatus,
    employmentType: r.employmentType === "UNKNOWN" ? null : r.employmentType,
    salaryMin: r.salaryMin,
    salaryMax: r.salaryMax,
    salaryCurrency: r.salaryCurrency,
    salaryPeriod: (r.salaryPeriod as SalaryPeriod | null) ?? null,
    salaryRaw: r.salaryRaw,
    sourceName: r.source?.sourceName ?? (r.sourceKey === "MANUAL" ? "Manual Entry" : r.sourceKey),
    postedAt: r.postedAt,
    lastSeenAt: r.lastSeenAt,
    status: r.status as JobStatus,
  }));
}

export async function getJob(actor: ActorRef, jobId: string) {
  const job = await withUserContext(actor.userId, (t) => findVisibleJob(t, actor.userId, jobId));
  if (!job) throw new AppError("NOT_FOUND");
  const canEdit =
    job.visibility === "PRIVATE" &&
    job.sourceKey === "MANUAL" &&
    job.createdByUserId === actor.userId;
  return { job, canEdit };
}

/** Real job counts per source for the sources page. */
export async function jobCountsBySource(actor: ActorRef, sourceIds: string[]) {
  if (sourceIds.length === 0) return new Map<string, number>();
  const groups = await withUserContext(actor.userId, (t) =>
    countJobsBySource(t, actor.userId, sourceIds),
  );
  return new Map(
    groups.filter((g) => g.sourceId).map((g) => [g.sourceId as string, g._count._all]),
  );
}

/** The user's own private jobs, for data export. */
export async function exportUserJobs(actor: ActorRef) {
  return withUserContext(actor.userId, (t) =>
    t.job.findMany({
      where: { createdByUserId: actor.userId },
      include: { company: { select: { name: true } } },
    }),
  );
}

/** Maintenance: hard-delete jobs soft-deleted longer than the retention window (owner connection). */
export async function purgeDeletedJobs(retentionDays = 30) {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const { count } = await getDb().job.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  return count;
}
