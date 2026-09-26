import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { checkPublicHttpUrl } from "@/lib/safe-url";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { uncertainMatches } from "./company-resolution";
import { normalizeUrl, parsePage } from "./extract/page";
import { FetchSession } from "./fetch/session";
import { ResearchFetchError } from "./fetch/safe-fetch";
import { executeResearchRun } from "./pipeline";
import {
  findCompanyResearchVersion,
  findJobResearchVersion,
  findRunSources,
  findVisibleJob,
  upsertSource,
  visibleJobWhere,
} from "./research.repository";
import { getServerEnv } from "@/config/env";
import { sha256Hex } from "@/server/crypto";
import {
  DEFAULT_FRESHNESS,
  freshnessOf,
  noteInput,
  RESEARCH_ENGINE_VERSION,
  researchOptionsSchema,
  researchSettingsInput,
  type Depth,
  type Freshness,
  type FreshnessPolicy,
  type ResearchOptions,
} from "./types";

/**
 * Research Service (Phase 5). Reusable entry points for the UI and the future [RESEARCH]
 * workflow node: startJobResearch / startCompanyResearch (background), researchJob /
 * researchCompany (inline), refreshResearch. Research is user-scoped (RLS); the job and company
 * entities stay shared. Nothing here writes resumes, emails or applications.
 */

type ActorRef = { userId: string };
const STALE_RUN_MS = 10 * 60 * 1000;

async function policyFor(
  t: Tx,
  userId: string,
): Promise<FreshnessPolicy & { defaultDepth: Depth; aiSynthesis: boolean }> {
  const s = await t.researchSettings.findUnique({ where: { userId } });
  return s
    ? {
        freshDays: s.freshDays,
        staleDays: s.staleDays,
        defaultDepth: s.defaultDepth as Depth,
        aiSynthesis: s.aiSynthesis,
      }
    : { ...DEFAULT_FRESHNESS, defaultDepth: "STANDARD", aiSynthesis: false };
}

async function companyVisible(t: Tx, userId: string, companyId: string) {
  const company = await t.company.findUnique({ where: { id: companyId } });
  if (!company) throw new AppError("NOT_FOUND");
  const jobs = await t.job.count({
    where: {
      companyId,
      deletedAt: null,
      OR: [{ visibility: "PUBLIC" }, { createdByUserId: userId }],
    },
  });
  if (!jobs) throw new AppError("NOT_FOUND");
  return company;
}

// --- Starting runs -------------------------------------------------------------------------------

async function createRun(
  actor: ActorRef,
  data: {
    kind: "JOB" | "COMPANY";
    companyId: string;
    jobId: string | null;
    depth: Depth;
    trigger: "MANUAL" | "REFRESH" | "WORKFLOW";
    refreshCompany: boolean;
  },
) {
  return withUserContext(actor.userId, async (t) => {
    await t.researchRun.updateMany({
      where: {
        userId: actor.userId,
        status: { in: ["QUEUED", "RUNNING"] },
        OR: [
          { heartbeatAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
          { heartbeatAt: null, createdAt: { lt: new Date(Date.now() - STALE_RUN_MS) } },
        ],
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: [{ message: "Stopped responding" }],
      },
    });
    try {
      const run = await t.researchRun.create({
        data: { ...data, userId: actor.userId, engineVersion: RESEARCH_ENGINE_VERSION },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "research_started",
        resourceType: "research_run",
        resourceId: run.id,
        metadata: {
          kind: data.kind,
          depth: data.depth,
          trigger: data.trigger,
          jobId: data.jobId,
          companyId: data.companyId,
        },
      });
      return run;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError("CONFLICT", {
          publicMessage: "A research run is already in progress. Wait for it to finish.",
        });
      throw error;
    }
  });
}

export async function startJobResearch(
  actor: ActorRef,
  jobId: string,
  rawOptions: unknown = {},
  trigger: "MANUAL" | "REFRESH" | "WORKFLOW" = "MANUAL",
) {
  const options = researchOptionsSchema.parse(rawOptions);
  const { job, policy } = await withUserContext(actor.userId, async (t) => ({
    job: await findVisibleJob(t, actor.userId, jobId),
    policy: await policyFor(t, actor.userId),
  }));
  if (!job) throw new AppError("NOT_FOUND");
  return createRun(actor, {
    kind: "JOB",
    companyId: job.companyId,
    jobId: job.id,
    depth: options.depth ?? policy.defaultDepth,
    trigger,
    refreshCompany: Boolean(options.refreshCompany),
  });
}

export async function startCompanyResearch(
  actor: ActorRef,
  companyId: string,
  rawOptions: unknown = {},
  trigger: "MANUAL" | "REFRESH" | "WORKFLOW" = "MANUAL",
) {
  const options = researchOptionsSchema.parse(rawOptions);
  const policy = await withUserContext(actor.userId, async (t) => {
    await companyVisible(t, actor.userId, companyId);
    return policyFor(t, actor.userId);
  });
  return createRun(actor, {
    kind: "COMPANY",
    companyId,
    jobId: null,
    depth: options.depth ?? policy.defaultDepth,
    trigger,
    refreshCompany: true,
  });
}

/** Inline job research (workflow / tests): start, execute, return the structured result. */
export async function researchJob(
  actor: ActorRef,
  input: { jobId: string; options?: ResearchOptions; trigger?: "MANUAL" | "WORKFLOW" },
) {
  const run = await startJobResearch(
    actor,
    input.jobId,
    input.options ?? {},
    input.trigger ?? "WORKFLOW",
  );
  await executeResearchRun(actor, run.id);
  return researchResultForJob(actor, input.jobId);
}

export async function researchCompany(
  actor: ActorRef,
  input: { companyId: string; options?: ResearchOptions; trigger?: "MANUAL" | "WORKFLOW" },
) {
  const run = await startCompanyResearch(
    actor,
    input.companyId,
    input.options ?? {},
    input.trigger ?? "WORKFLOW",
  );
  await executeResearchRun(actor, run.id);
  return researchResultForCompany(actor, input.companyId);
}

/** Refresh a research record (job or company) by its id: queues a new run (history is kept). */
export async function refreshResearch(
  actor: ActorRef,
  input: { researchId: string; options?: ResearchOptions },
) {
  const found = await withUserContext(actor.userId, async (t) => ({
    job: await t.jobResearch.findFirst({
      where: { id: input.researchId, userId: actor.userId },
      select: { jobId: true, depth: true },
    }),
    company: await t.companyResearch.findFirst({
      where: { id: input.researchId, userId: actor.userId },
      select: { companyId: true, depth: true },
    }),
  }));
  if (found.job)
    return startJobResearch(
      actor,
      found.job.jobId,
      { depth: found.job.depth, ...input.options },
      "REFRESH",
    );
  if (found.company)
    return startCompanyResearch(
      actor,
      found.company.companyId,
      { depth: found.company.depth, ...input.options },
      "REFRESH",
    );
  throw new AppError("NOT_FOUND");
}

export async function getRun(actor: ActorRef, runId: string) {
  const run = await withUserContext(actor.userId, (t) =>
    t.researchRun.findFirst({
      where: { id: runId, userId: actor.userId },
      select: {
        id: true,
        kind: true,
        status: true,
        steps: true,
        depth: true,
        jobId: true,
        companyId: true,
        sourcesAttempted: true,
        sourcesSuccessful: true,
        sourcesFailed: true,
        startedAt: true,
        completedAt: true,
        errors: true,
      },
    }),
  );
  if (!run) throw new AppError("NOT_FOUND");
  return run;
}

// --- Freshness / invalidation ------------------------------------------------------------------

export interface FreshnessView {
  freshness: Freshness;
  reasons: string[];
}

function jobFreshness(
  research: {
    researchedAt: Date;
    invalidatedAt: Date | null;
    invalidationReason: string | null;
    engineVersion: string;
    jobContentHash: string;
    companyResearchVersion: number | null;
  },
  policy: FreshnessPolicy,
  job: { contentHash: string },
  currentCompanyVersion: number | null,
): FreshnessView {
  const reasons: string[] = [];
  if (research.invalidatedAt) reasons.push(research.invalidationReason ?? "Marked for refresh");
  if (research.engineVersion !== RESEARCH_ENGINE_VERSION)
    reasons.push("The research engine was updated");
  if (research.jobContentHash !== job.contentHash) reasons.push("The job description changed");
  if (
    currentCompanyVersion !== null &&
    research.companyResearchVersion !== null &&
    currentCompanyVersion !== research.companyResearchVersion
  )
    reasons.push("Company research was refreshed since");
  const base = freshnessOf(research, policy);
  if (base === "STALE" && !reasons.length) reasons.push(`Older than ${policy.staleDays} days`);
  return { freshness: reasons.length ? "STALE" : base, reasons };
}

function companyFreshness(
  research: {
    researchedAt: Date;
    invalidatedAt: Date | null;
    invalidationReason: string | null;
    engineVersion: string;
  },
  policy: FreshnessPolicy,
): FreshnessView {
  const reasons: string[] = [];
  if (research.invalidatedAt) reasons.push(research.invalidationReason ?? "Marked for refresh");
  if (research.engineVersion !== RESEARCH_ENGINE_VERSION)
    reasons.push("The research engine was updated");
  const base = freshnessOf(research, policy);
  if (base === "STALE" && !reasons.length) reasons.push(`Older than ${policy.staleDays} days`);
  return { freshness: reasons.length ? "STALE" : base, reasons };
}

async function invalidate(
  t: Tx,
  userId: string,
  where: { companyId?: string; jobId?: string },
  reason: string,
) {
  const data = { invalidatedAt: new Date(), invalidationReason: reason.slice(0, 200) };
  let count = 0;
  if (where.companyId) {
    count += (
      await t.companyResearch.updateMany({
        where: { userId, companyId: where.companyId, isCurrent: true, invalidatedAt: null },
        data,
      })
    ).count;
    count += (
      await t.jobResearch.updateMany({
        where: { userId, companyId: where.companyId, isCurrent: true, invalidatedAt: null },
        data,
      })
    ).count;
  }
  if (where.jobId)
    count += (
      await t.jobResearch.updateMany({
        where: { userId, jobId: where.jobId, isCurrent: true, invalidatedAt: null },
        data,
      })
    ).count;
  if (count)
    await recordAudit(t, {
      userId,
      action: "research_invalidated",
      resourceType: "research",
      resourceId: where.jobId ?? where.companyId!,
      metadata: { reason, count },
    });
}

// --- Read models ---------------------------------------------------------------------------------

export async function getJobResearchView(actor: ActorRef, jobId: string, versionId?: string) {
  return withUserContext(actor.userId, async (t) => {
    const job = await findVisibleJob(t, actor.userId, jobId);
    if (!job) throw new AppError("NOT_FOUND");
    const policy = await policyFor(t, actor.userId);
    const research = await findJobResearchVersion(t, actor.userId, jobId, versionId);
    if (versionId && !research) throw new AppError("NOT_FOUND");
    const companyCurrent = await t.companyResearch.findFirst({
      where: { userId: actor.userId, companyId: job.companyId, isCurrent: true },
    });
    const companyResearch = research?.companyResearchId
      ? await findCompanyResearchVersion(t, actor.userId, job.companyId, research.companyResearchId)
      : null;
    const activeRun = await t.researchRun.findFirst({
      where: { userId: actor.userId, jobId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true, status: true, steps: true },
    });
    const lastRun = research?.runId
      ? await t.researchRun.findFirst({ where: { id: research.runId, userId: actor.userId } })
      : null;
    const runSources = lastRun ? await findRunSources(t, actor.userId, lastRun.id) : [];
    const history = await t.jobResearch.findMany({
      where: { userId: actor.userId, jobId },
      select: {
        id: true,
        version: true,
        status: true,
        depth: true,
        isCurrent: true,
        researchedAt: true,
        companyResearchVersion: true,
        changes: true,
      },
      orderBy: { version: "desc" },
      take: 30,
    });
    const notes = await t.researchNote.findMany({
      where: { userId: actor.userId, jobId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const manualSources = await t.researchSource.findMany({
      where: { userId: actor.userId, jobId, addedByUser: true },
      distinct: ["normalizedUrl"],
      orderBy: { createdAt: "desc" },
    });
    const freshness = research
      ? research.isCurrent
        ? jobFreshness(research, policy, job, companyCurrent?.version ?? null)
        : { freshness: "STALE" as Freshness, reasons: ["Older version"] }
      : { freshness: "UNKNOWN" as Freshness, reasons: [] };
    return {
      job,
      research,
      companyResearch,
      companyCurrent,
      freshness,
      activeRun,
      lastRun,
      runSources,
      history,
      notes,
      manualSources,
      policy,
    };
  });
}

export async function getCompanyResearchView(
  actor: ActorRef,
  companyId: string,
  versionId?: string,
) {
  return withUserContext(actor.userId, async (t) => {
    const company = await companyVisible(t, actor.userId, companyId);
    const policy = await policyFor(t, actor.userId);
    const research = await findCompanyResearchVersion(t, actor.userId, companyId, versionId);
    if (versionId && !research) throw new AppError("NOT_FOUND");
    const target = await t.companyResearchTarget.findUnique({
      where: { userId_companyId: { userId: actor.userId, companyId } },
    });
    const activeRun = await t.researchRun.findFirst({
      where: { userId: actor.userId, companyId, status: { in: ["QUEUED", "RUNNING"] } },
      select: { id: true, status: true, steps: true, kind: true, jobId: true },
    });
    const runSources = research?.runId ? await findRunSources(t, actor.userId, research.runId) : [];
    const history = await t.companyResearch.findMany({
      where: { userId: actor.userId, companyId },
      select: {
        id: true,
        version: true,
        status: true,
        depth: true,
        isCurrent: true,
        researchedAt: true,
        changes: true,
      },
      orderBy: { version: "desc" },
      take: 30,
    });
    const jobs = await t.job.findMany({
      where: {
        companyId,
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      select: {
        id: true,
        title: true,
        locationRaw: true,
        city: true,
        countryCode: true,
        remoteStatus: true,
        employmentType: true,
        status: true,
        postedAt: true,
      },
      orderBy: [{ postedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
      take: 100,
    });
    const notes = await t.researchNote.findMany({
      where: { userId: actor.userId, companyId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const manualSources = await t.researchSource.findMany({
      where: { userId: actor.userId, companyId, jobId: null, addedByUser: true },
      distinct: ["normalizedUrl"],
      orderBy: { createdAt: "desc" },
    });
    const similar = uncertainMatches(
      company,
      await t.company.findMany({
        where: {
          id: { not: companyId },
          name: { startsWith: company.name.split(/\s+/)[0]!.slice(0, 4), mode: "insensitive" },
        },
        select: {
          id: true,
          name: true,
          nameNormalized: true,
          officialWebsite: true,
          websiteConfidence: true,
          websiteSource: true,
          createdAt: true,
          updatedAt: true,
        },
        take: 20,
      }),
    );
    const freshness = research
      ? research.isCurrent
        ? companyFreshness(research, policy)
        : { freshness: "STALE" as Freshness, reasons: ["Older version"] }
      : { freshness: "UNKNOWN" as Freshness, reasons: [] };
    return {
      company,
      research,
      target,
      activeRun,
      runSources,
      history,
      jobs,
      notes,
      manualSources,
      similar,
      freshness,
      policy,
    };
  });
}

/** Companies with at least one job visible to the caller, plus the caller's research status. */
export async function listCompanies(actor: ActorRef, query: { q?: string } = {}) {
  const q = (query.q ?? "").trim().slice(0, 100);
  return withUserContext(actor.userId, async (t) => {
    const companies = await t.company.findMany({
      where: {
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
        jobs: {
          some: {
            deletedAt: null,
            OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
          },
        },
      },
      select: {
        id: true,
        name: true,
        officialWebsite: true,
        _count: {
          select: {
            jobs: {
              where: {
                deletedAt: null,
                OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
      take: 200,
    });
    const research = await t.companyResearch.findMany({
      where: {
        userId: actor.userId,
        isCurrent: true,
        companyId: { in: companies.map((c) => c.id) },
      },
      select: {
        companyId: true,
        status: true,
        version: true,
        researchedAt: true,
        invalidatedAt: true,
        invalidationReason: true,
        engineVersion: true,
      },
    });
    const policy = await policyFor(t, actor.userId);
    const byCompany = new Map(research.map((r) => [r.companyId, r]));
    return companies.map((c) => {
      const r = byCompany.get(c.id);
      return {
        ...c,
        jobs: c._count.jobs,
        research: r ? { ...r, freshness: companyFreshness(r, policy).freshness } : null,
      };
    });
  });
}

// --- Manual sources, company targets, notes, settings -------------------------------------

/**
 * Add a public URL to a job's or company's research. The page is fetched immediately through the
 * normal SSRF-safe pipeline (never trusted automatically); current research is marked stale so the
 * next refresh includes it.
 */
export async function addManualSource(
  actor: ActorRef,
  input: { jobId?: string; companyId?: string; url: string },
) {
  const check = checkPublicHttpUrl(input.url);
  if (!check.ok) throw new AppError("VALIDATION_ERROR", { publicMessage: check.reason });
  const scope = await withUserContext(actor.userId, async (t) => {
    if (input.jobId) {
      const job = await findVisibleJob(t, actor.userId, input.jobId);
      if (!job) throw new AppError("NOT_FOUND");
      return { jobId: job.id, companyId: job.companyId };
    }
    if (!input.companyId) throw new AppError("VALIDATION_ERROR");
    await companyVisible(t, actor.userId, input.companyId);
    return { jobId: null, companyId: input.companyId };
  });
  const env = getServerEnv();
  const session = new FetchSession(actor.userId, {
    maxPages: 1,
    maxDurationMs: 20_000,
    requestsPerMinute: env.RESEARCH_REQUESTS_PER_MINUTE,
    requestsPerHour: env.RESEARCH_REQUESTS_PER_HOUR,
    perHostPerMinute: env.RESEARCH_PER_HOST_PER_MINUTE,
    concurrency: 1,
    maxBytes: env.RESEARCH_MAX_RESPONSE_BYTES,
    maxRetries: 1,
  });
  let fetchStatus = "OK";
  let error: string | null = null;
  let httpStatus: number | null = null;
  let text: string | null = null;
  let title: string | null = null;
  let publishedAt: Date | null = null;
  try {
    const page = await session.fetchPage(check.url.toString());
    httpStatus = page.status;
    const parsed = parsePage(page.body, page.finalUrl);
    text = page.contentType.includes("text/plain") ? page.body.slice(0, 20_000) : parsed.text;
    title = parsed.title;
    publishedAt = parsed.publishedAt ? new Date(parsed.publishedAt) : null;
  } catch (e) {
    const err =
      e instanceof ResearchFetchError ? e : new ResearchFetchError("NETWORK", "Request failed");
    if (err.kind === "UNSAFE_URL")
      throw new AppError("VALIDATION_ERROR", { publicMessage: err.message });
    fetchStatus =
      err.kind === "ROBOTS_DISALLOWED"
        ? "ROBOTS_DISALLOWED"
        : err.kind === "BLOCKED"
          ? "BLOCKED"
          : "FAILED";
    error = err.message;
    httpStatus = err.status ?? null;
  }
  return withUserContext(actor.userId, async (t) => {
    const { source } = await upsertSource(t, actor.userId, {
      companyId: scope.companyId,
      jobId: scope.jobId,
      url: check.url.toString().slice(0, 2048),
      normalizedUrl: normalizeUrl(check.url.toString()),
      sourceType: "MANUAL",
      reliability: "SECONDARY",
      relevance: "UNKNOWN",
      origin: "MANUAL",
      fetchStatus,
      httpStatus,
      error,
      title,
      publishedAt,
      sourceUpdatedAt: null,
      retrievedAt: text ? new Date() : null,
      contentHash: text ? sha256Hex(text) : null,
      contentText: text,
      addedByUser: true,
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "source_added",
      resourceType: "research_source",
      resourceId: source.id,
      metadata: {
        jobId: scope.jobId,
        companyId: scope.companyId,
        fetchStatus,
        host: check.url.hostname,
      },
    });
    await invalidate(
      t,
      actor.userId,
      scope.jobId ? { jobId: scope.jobId } : { companyId: scope.companyId },
      "A source you added is not included yet",
    );
    return source;
  });
}

export async function setCompanyTarget(
  actor: ActorRef,
  companyId: string,
  input: { websiteUrl: string; careersUrl: string },
) {
  const norm = (value: string, label: string) => {
    const v = value.trim();
    if (!v) return null;
    const check = checkPublicHttpUrl(v);
    if (!check.ok)
      throw new AppError("VALIDATION_ERROR", { publicMessage: `${label}: ${check.reason}` });
    return check.url.toString().replace(/\/$/, "");
  };
  const websiteUrl = norm(input.websiteUrl, "Website");
  const careersUrl = norm(input.careersUrl, "Careers page");
  return withUserContext(actor.userId, async (t) => {
    await companyVisible(t, actor.userId, companyId);
    const target = await t.companyResearchTarget.upsert({
      where: { userId_companyId: { userId: actor.userId, companyId } },
      create: { userId: actor.userId, companyId, websiteUrl, careersUrl },
      update: { websiteUrl, careersUrl },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "company_target_updated",
      resourceType: "company",
      resourceId: companyId,
      metadata: { website: Boolean(websiteUrl), careers: Boolean(careersUrl) },
    });
    await invalidate(t, actor.userId, { companyId }, "Company website or careers page changed");
    return target;
  });
}

export async function addNote(
  actor: ActorRef,
  input: { jobId?: string; companyId?: string; body: unknown },
) {
  const { body } = noteInput.parse({ body: input.body });
  return withUserContext(actor.userId, async (t) => {
    if (input.jobId) {
      if (
        !(await t.job.findFirst({
          where: visibleJobWhere(actor.userId, input.jobId),
          select: { id: true },
        }))
      )
        throw new AppError("NOT_FOUND");
    } else if (input.companyId) await companyVisible(t, actor.userId, input.companyId);
    else throw new AppError("VALIDATION_ERROR");
    const note = await t.researchNote.create({
      data: {
        userId: actor.userId,
        jobId: input.jobId ?? null,
        companyId: input.jobId ? null : input.companyId!,
        body,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "manual_note_added",
      resourceType: "research_note",
      resourceId: note.id,
      metadata: {
        jobId: input.jobId ?? null,
        companyId: input.companyId ?? null,
        length: body.length,
      },
    });
    return note;
  });
}

export async function deleteNote(actor: ActorRef, noteId: string) {
  return withUserContext(actor.userId, async (t) => {
    const res = await t.researchNote.updateMany({
      where: { id: noteId, userId: actor.userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (!res.count) throw new AppError("NOT_FOUND");
    await recordAudit(t, {
      userId: actor.userId,
      action: "manual_note_deleted",
      resourceType: "research_note",
      resourceId: noteId,
    });
  });
}

export async function getResearchSettings(actor: ActorRef) {
  return withUserContext(actor.userId, (t) => policyFor(t, actor.userId));
}

export async function saveResearchSettings(actor: ActorRef, raw: unknown) {
  const data = researchSettingsInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const row = await t.researchSettings.upsert({
      where: { userId: actor.userId },
      create: { ...data, userId: actor.userId },
      update: data,
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "research_settings_updated",
      resourceType: "research_settings",
      resourceId: row.id,
      metadata: { fields: Object.keys(data) },
    });
    return row;
  });
}

// --- Structured results (workflow node + export) --------------------------------------------

export async function researchResultForJob(actor: ActorRef, jobId: string) {
  const view = await getJobResearchView(actor, jobId);
  return toJobResult(view);
}

export async function researchResultForCompany(actor: ActorRef, companyId: string) {
  const view = await getCompanyResearchView(actor, companyId);
  const r = view.research;
  return {
    schemaVersion: 1,
    engineVersion: RESEARCH_ENGINE_VERSION,
    companyId,
    status: r ? r.status : "NOT_STARTED",
    freshness: view.freshness.freshness,
    companyResearch: r
      ? { id: r.id, version: r.version, summary: r.summary, brief: r.brief, stats: r.stats }
      : null,
    evidenceIds: r ? r.claims.flatMap((c) => c.evidence.map((e) => e.id)) : [],
    unknowns: r ? ((r.brief as { unknowns?: string[] }).unknowns ?? []) : [],
  };
}

type JobView = Awaited<ReturnType<typeof getJobResearchView>>;

export function toJobResult(view: JobView) {
  const r = view.research;
  const c = view.companyResearch;
  const jb = (r?.brief ?? {}) as Record<string, unknown>;
  const cb = (c?.brief ?? {}) as Record<string, unknown>;
  const texts = (v: unknown) =>
    Array.isArray(v) ? (v as { text: string }[]).map((i) => i.text) : [];
  return {
    schemaVersion: 1,
    engineVersion: RESEARCH_ENGINE_VERSION,
    jobId: view.job.id,
    companyId: view.job.companyId,
    status: r ? r.status : "NOT_STARTED",
    freshness: view.freshness.freshness,
    jobResearch: r
      ? { id: r.id, version: r.version, summary: r.jobSummary, brief: r.brief, stats: r.stats }
      : null,
    companyResearch: c
      ? { id: c.id, version: c.version, summary: c.summary, brief: c.brief, stats: c.stats }
      : null,
    /** Fields shaped for Phase 6 (research context only — no resume content). */
    forTailoring: {
      companyPositioning: texts(cb.companyPositioning),
      rolePriorities: texts(jb.rolePriorities),
      importantTerms: Array.isArray(jb.importantTerms)
        ? (jb.importantTerms as { term: string }[]).map((t) => t.term)
        : [],
      relevantCompanyContext: texts(jb.relevantPublicContext),
      recentRelevantActivity: texts(cb.relevantActivity),
      verifiedRoleRequirements: [
        ...texts(jb.requiredSkills),
        ...texts(jb.requiredExperience),
        ...texts(jb.educationExpectations),
      ],
      openQuestions: (jb.openQuestions as string[] | undefined) ?? [],
    },
    evidenceIds: [...(r?.claims ?? []), ...(c?.claims ?? [])].flatMap((cl) =>
      cl.evidence.map((e) => e.id),
    ),
    unknowns: [
      ...((jb.openQuestions as string[] | undefined) ?? []),
      ...((cb.unknowns as string[] | undefined) ?? []),
    ],
  };
}

export async function exportJobResearch(actor: ActorRef, jobId: string, format: "json" | "md") {
  const view = await getJobResearchView(actor, jobId);
  if (!view.research)
    throw new AppError("NOT_FOUND", {
      publicMessage: "Research has not been run for this job yet.",
    });
  const result = toJobResult(view);
  if (format === "json") return JSON.stringify({ ...result, sources: sourcesOf(view) }, null, 2);
  return toMarkdown(view);
}

function sourcesOf(view: JobView) {
  const map = new Map<
    string,
    { id: string; url: string; title: string | null; sourceType: string; retrievedAt: Date | null }
  >();
  for (const cl of [...(view.research?.claims ?? []), ...(view.companyResearch?.claims ?? [])])
    for (const e of cl.evidence)
      map.set(e.source.id, {
        id: e.source.id,
        url: e.source.url,
        title: e.source.title,
        sourceType: e.source.sourceType,
        retrievedAt: e.source.retrievedAt,
      });
  return [...map.values()];
}

function toMarkdown(view: JobView): string {
  const r = view.research!;
  const c = view.companyResearch;
  const sources = sourcesOf(view);
  const index = new Map(sources.map((s, i) => [s.id, i + 1]));
  const cite = (cl: { evidence: { source: { id: string } }[] }) =>
    cl.evidence.length
      ? ` [${[...new Set(cl.evidence.map((e) => index.get(e.source.id)))].join(", ")}]`
      : "";
  const label = (t: string) => (t === "FACT" ? "" : ` _(${t.toLowerCase()})_`);
  const section = (
    title: string,
    claims: {
      claim: string;
      claimType: string;
      verification: string;
      evidence: { source: { id: string } }[];
    }[],
  ) =>
    claims.length
      ? `\n## ${title}\n\n${claims.map((cl) => `- ${cl.claim}${label(cl.claimType)}${cite(cl)}`).join("\n")}\n`
      : "";
  const pick = (claims: typeof r.claims, sections: string[]) =>
    claims.filter((cl) => sections.includes(cl.section) && cl.verification !== "REJECTED");
  const brief = r.brief as { openQuestions?: string[] };
  const cbrief = (c?.brief ?? {}) as { unknowns?: string[] };
  return [
    `# Research brief — ${view.job.title} at ${view.job.company.name}`,
    "",
    `Job research v${r.version} (${r.status.toLowerCase()}, ${r.depth.toLowerCase()}) · researched ${r.researchedAt.toISOString().slice(0, 10)} · freshness: ${view.freshness.freshness.toLowerCase()}`,
    c
      ? `Company research v${c.version} · researched ${c.researchedAt.toISOString().slice(0, 10)}`
      : "Company research: none",
    "",
    "> Evidence-first research. Facts are quoted from sources; interpretations are labelled. This is not a resume or application text.",
    section(
      "Company — what they do",
      pick(c?.claims ?? [], ["WHAT_THEY_DO", "MARKETS", "INDUSTRY"]),
    ),
    section("Company — products & services", pick(c?.claims ?? [], ["PRODUCTS"])),
    section("Recent relevant activity", pick(c?.claims ?? [], ["ACTIVITY"])),
    section(
      "Conflicting information",
      (c?.claims ?? []).filter((cl) => cl.claimType === "CONFLICTING"),
    ),
    section("Role summary", pick(r.claims, ["ROLE_SUMMARY", "ROLE_PURPOSE"])),
    section("Key responsibilities", pick(r.claims, ["RESPONSIBILITY"])),
    section("What the employer emphasizes", pick(r.claims, ["PRIORITY"])),
    section(
      "Requirements",
      r.claims.filter((cl) => cl.section.startsWith("REQ_")),
    ),
    section("Application instructions", pick(r.claims, ["APPLICATION"])),
    section("Important terminology", pick(r.claims, ["TERM"])),
    section("Relevant company context", pick(r.claims, ["RELEVANT_CONTEXT", "MANUAL_SOURCE"])),
    section("AI synthesis (pending your review)", pick(r.claims, ["AI_SYNTHESIS"])),
    `\n## Unknown / needs verification\n\n${[...(brief.openQuestions ?? []), ...(cbrief.unknowns ?? [])].map((q) => `- ${q}`).join("\n") || "- None recorded"}\n`,
    `\n## Sources\n\n${sources.map((s, i) => `${i + 1}. ${s.title ?? s.url} — ${s.url} (${s.sourceType.toLowerCase().replace(/_/g, " ")}${s.retrievedAt ? `, retrieved ${s.retrievedAt.toISOString().slice(0, 10)}` : ""})`).join("\n")}\n`,
  ].join("\n");
}

/** Research overview: the caller's current job research and recent runs. */
export async function listRecentResearch(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const policy = await policyFor(t, actor.userId);
    const jobResearch = await t.jobResearch.findMany({
      where: { userId: actor.userId, isCurrent: true, job: { deletedAt: null } },
      select: {
        id: true,
        jobId: true,
        version: true,
        status: true,
        depth: true,
        researchedAt: true,
        invalidatedAt: true,
        invalidationReason: true,
        engineVersion: true,
        jobContentHash: true,
        companyResearchVersion: true,
        job: {
          select: { title: true, contentHash: true, company: { select: { id: true, name: true } } },
        },
      },
      orderBy: { researchedAt: "desc" },
      take: 100,
    });
    const runs = await t.researchRun.findMany({
      where: { userId: actor.userId },
      select: {
        id: true,
        kind: true,
        status: true,
        depth: true,
        trigger: true,
        createdAt: true,
        durationMs: true,
        sourcesSuccessful: true,
        sourcesFailed: true,
        requestsMade: true,
        aiUsed: true,
        jobId: true,
        companyId: true,
        company: { select: { name: true } },
        job: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const currentCompany = new Map(
      (
        await t.companyResearch.findMany({
          where: {
            userId: actor.userId,
            isCurrent: true,
            companyId: { in: jobResearch.map((j) => j.job.company.id) },
          },
          select: { companyId: true, version: true },
        })
      ).map((c) => [c.companyId, c.version]),
    );
    return {
      policy,
      jobResearch: jobResearch.map((r) => ({
        ...r,
        freshness: jobFreshness(r, policy, r.job, currentCompany.get(r.job.company.id) ?? null)
          .freshness,
      })),
      runs,
    };
  });
}
