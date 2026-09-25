import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  CLASSIFIER_VERSION,
  classifyJob,
  evaluateJob,
  type CategoryTerms,
  type ProfileCriteria,
} from "@/modules/search-profiles/criteria";
import { criteriaForProfile, getSearchProfile } from "@/modules/search-profiles/profiles.service";
import { visibleTo } from "../jobs.repository";
import {
  configuredBoards,
  isAtsSourceKey,
  rateLimitsFrom,
  type AtsSourceKey,
  type BoardEntry,
} from "../sources.schemas";
import { computeSourceHealth, HEALTH_WINDOW, type SourceHealth } from "../source-health";
import { ADAPTERS } from "./adapters";
import { canonicalJobSchema, type CanonicalJob } from "./canonical";
import { SourceFetchError } from "./http";
import { ingestBoard } from "./ingest";
import { sourceRateLimiter } from "./rate-limiter";

/**
 * Discovery execution: SEARCH PROFILE → SOURCE SELECTION → FETCH → NORMALIZE →
 * DEDUPLICATE → SAVE → PROFILE MATCHING. Runs and per-board sync results are
 * user-owned history; catalog writes happen in ingestBoard (system).
 * Progress counters are written after every board so the UI shows real numbers.
 */

type ActorRef = { userId: string };

/** A RUNNING run without a heartbeat for this long is considered dead. */
export const STALE_RUN_MS = 10 * 60_000;

interface PlannedBoard {
  sourceId: string;
  sourceKey: AtsSourceKey;
  sourceName: string;
  board: BoardEntry;
  options: Record<string, unknown>;
  limits: ReturnType<typeof rateLimitsFrom>;
}

async function planBoards(t: Tx, actor: ActorRef, sourceKeys: string[]): Promise<PlannedBoard[]> {
  const sources = await t.jobSource.findMany({
    where: { userId: actor.userId, enabled: true, sourceType: "ATS_PUBLIC_API" },
    orderBy: { sourceKey: "asc" },
  });
  return sources
    .filter(
      (s) =>
        isAtsSourceKey(s.sourceKey) &&
        (sourceKeys.length === 0 || sourceKeys.includes(s.sourceKey)),
    )
    .flatMap((s) => {
      const key = s.sourceKey as AtsSourceKey;
      const config = (s.configuration ?? {}) as Record<string, unknown>;
      return configuredBoards(key, config).map((board) => ({
        sourceId: s.id,
        sourceKey: key,
        sourceName: s.sourceName,
        board,
        options: key === "LEVER" ? { region: config.region ?? "GLOBAL" } : {},
        limits: rateLimitsFrom(s.rateLimitSettings),
      }));
    });
}

async function failStaleRuns(t: Tx, actor: ActorRef) {
  const cutoff = new Date(Date.now() - STALE_RUN_MS);
  await t.discoveryRun.updateMany({
    where: {
      userId: actor.userId,
      status: { in: ["QUEUED", "RUNNING"] },
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, createdAt: { lt: cutoff } }],
    },
    data: {
      status: "FAILED",
      stage: "DONE",
      finishedAt: new Date(),
      message: "The run stopped responding and was marked failed.",
    },
  });
}

export interface DiscoveryPreview {
  boards: { sourceKey: AtsSourceKey; sourceName: string; board: string; name: string | null }[];
  /** Selected source keys that cannot contribute (disabled / no boards) */
  unavailableSources: string[];
}

/** What a run of this profile would fetch right now (no network, no writes). */
export async function previewDiscovery(
  actor: ActorRef,
  profileId: string,
): Promise<DiscoveryPreview> {
  return withUserContext(actor.userId, async (t) => {
    const profile = await getSearchProfile(actor, profileId, t);
    const boards = await planBoards(t, actor, profile.sourceKeys);
    const contributing = new Set(boards.map((b) => b.sourceKey));
    return {
      boards: boards.map((b) => ({
        sourceKey: b.sourceKey,
        sourceName: b.sourceName,
        board: b.board.id,
        name: b.board.name ?? null,
      })),
      unavailableSources: profile.sourceKeys.filter((k) => !contributing.has(k as AtsSourceKey)),
    };
  });
}

/** The user's QUEUED/RUNNING run, if any (stale runs are failed first). */
export async function getActiveDiscoveryRun(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    await failStaleRuns(t, actor);
    return t.discoveryRun.findFirst({
      where: { userId: actor.userId, status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
    });
  });
}

/** Creates a QUEUED run for an owned, enabled profile. Execution is started by the caller. */
export async function startDiscovery(
  actor: ActorRef,
  profileId: string,
  trigger: "MANUAL" | "SCHEDULED" = "MANUAL",
) {
  return withUserContext(actor.userId, async (t) => {
    await failStaleRuns(t, actor);
    const profile = await getSearchProfile(actor, profileId, t);
    if (!profile.enabled) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This search profile is disabled. Enable it to run discovery.",
      });
    }
    const boards = await planBoards(t, actor, profile.sourceKeys);
    if (boards.length === 0) {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage:
          "No enabled source has boards configured for this profile. Add company boards in Jobs → Sources and enable the source.",
      });
    }
    const active = await t.discoveryRun.findFirst({
      where: { userId: actor.userId, status: { in: ["QUEUED", "RUNNING"] } },
    });
    if (active)
      throw new AppError("CONFLICT", {
        publicMessage: "A discovery run is already in progress. Wait for it to finish.",
      });
    const criteria = await criteriaForProfile(t, actor, profile);
    const run = await t.discoveryRun.create({
      data: {
        userId: actor.userId,
        profileId: profile.id,
        trigger,
        status: "QUEUED",
        stage: "QUEUED",
        sourcesTotal: boards.length,
        criteria: {
          profileName: profile.name,
          ...criteria,
          locations: criteria.locations.map((l) => ({
            id: l.id,
            name: l.name,
            countryCode: l.countryCode,
            kind: l.kind,
          })),
          categories: profile.categories.map((c) => ({ id: c.category.id, name: c.category.name })),
          termCount: criteria.terms.length,
          terms: undefined,
          boards: boards.map((b) => ({ sourceKey: b.sourceKey, board: b.board.id })),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "discovery_started",
      resourceType: "discovery_run",
      resourceId: run.id,
      metadata: { profileId: profile.id, trigger, boards: boards.length },
    });
    return run;
  });
}

interface BoardOutcome {
  ok: boolean;
  counts: {
    fetched: number;
    valid: number;
    invalid: number;
    created: number;
    updated: number;
    unchanged: number;
    duplicates: number;
    flagged: number;
    closed: number;
    matched: number;
  };
}

function errorText(error: unknown): { kind: string; message: string } {
  if (error instanceof SourceFetchError) return { kind: error.kind, message: error.message };
  if (error instanceof AppError) return { kind: error.code, message: error.publicMessage };
  return { kind: "INTERNAL", message: "Unexpected error while processing this board." };
}

async function setStage(actor: ActorRef, runId: string, stage: string) {
  await withUserContext(actor.userId, (t) =>
    t.discoveryRun.update({ where: { id: runId }, data: { stage, heartbeatAt: new Date() } }),
  );
}

/** Profile matching for the jobs one board maps to; writes the user's hits and own-term categories. */
async function matchProfile(
  actor: ActorRef,
  runId: string,
  profileId: string,
  criteria: ProfileCriteria,
  userCategories: CategoryTerms[],
  jobIds: string[],
) {
  if (jobIds.length === 0) return 0;
  return withUserContext(actor.userId, async (t) => {
    let matched = 0;
    for (let i = 0; i < jobIds.length; i += 200) {
      const part = jobIds.slice(i, i + 200);
      const jobs = await t.job.findMany({
        where: { id: { in: part }, ...visibleTo(actor.userId) },
        select: {
          id: true,
          title: true,
          department: true,
          team: true,
          city: true,
          region: true,
          countryCode: true,
          locationRaw: true,
          remoteStatus: true,
          employmentType: true,
          experienceLevel: true,
          salaryMin: true,
          salaryMax: true,
          salaryCurrency: true,
          salaryPeriod: true,
          visaTextRaw: true,
          categoryAssignments: {
            where: { OR: [{ userId: null }, { userId: actor.userId }] },
            select: { categoryId: true },
          },
        },
      });

      // The user's own terms / custom categories become user-scoped assignments (system rows stay untouched).
      if (userCategories.length) {
        await t.jobCategoryAssignment.deleteMany({
          where: { jobId: { in: part }, userId: actor.userId, method: "RULE" },
        });
        const rows = jobs.flatMap((j) =>
          classifyJob(j, userCategories).map((h) => ({
            jobId: j.id,
            categoryId: h.categoryId,
            userId: actor.userId,
            method: "RULE",
            confidence: h.confidence,
            matchedTerms: h.matchedTerms,
            classifierVersion: CLASSIFIER_VERSION,
          })),
        );
        if (rows.length)
          await t.jobCategoryAssignment.createMany({ data: rows, skipDuplicates: true });
        for (const r of rows)
          jobs
            .find((j) => j.id === r.jobId)
            ?.categoryAssignments.push({ categoryId: r.categoryId });
      }

      const hits = jobs
        .map((j) => ({
          job: j,
          evaluation: evaluateJob(criteria, {
            ...j,
            categoryIds: j.categoryAssignments.map((c) => c.categoryId),
          }),
        }))
        .filter((x) => x.evaluation.matched);
      if (hits.length === 0) continue;
      const existing = await t.jobSearchProfileHit.findMany({
        where: { profileId, jobId: { in: hits.map((h) => h.job.id) } },
        select: { jobId: true },
      });
      const known = new Set(existing.map((e) => e.jobId));
      const now = new Date();
      const fresh = hits.filter((h) => !known.has(h.job.id));
      if (fresh.length) {
        await t.jobSearchProfileHit.createMany({
          data: fresh.map((h) => ({
            userId: actor.userId,
            profileId,
            jobId: h.job.id,
            discoveryRunId: runId,
            reasons: h.evaluation.reasons as unknown as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
      }
      if (known.size) {
        await t.jobSearchProfileHit.updateMany({
          where: { profileId, jobId: { in: [...known] } },
          data: { lastMatchedAt: now, discoveryRunId: runId },
        });
      }
      matched += hits.length;
    }
    return matched;
  });
}

async function processBoard(
  actor: ActorRef,
  runId: string,
  plan: PlannedBoard,
  ctx: {
    profileId: string;
    criteria: ProfileCriteria;
    systemCategories: CategoryTerms[];
    userCategories: CategoryTerms[];
  },
): Promise<BoardOutcome> {
  const counts: BoardOutcome["counts"] = {
    fetched: 0,
    valid: 0,
    invalid: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    flagged: 0,
    closed: 0,
    matched: 0,
  };
  const started = Date.now();
  const sync = await withUserContext(actor.userId, (t) =>
    t.sourceSyncRun.create({
      data: {
        userId: actor.userId,
        discoveryRunId: runId,
        sourceId: plan.sourceId,
        sourceKey: plan.sourceKey,
        board: plan.board.id,
        kind: "SYNC",
      },
    }),
  );
  let requests = 0;
  let truncated = false;
  const invalidReasons: Record<string, number> = {};
  try {
    await setStage(actor, runId, "FETCHING");
    const adapter = ADAPTERS[plan.sourceKey];
    const fetched = await adapter.fetchBoard(plan.board, {
      limits: {
        timeoutMs: plan.limits.timeoutMs,
        maxPages: plan.limits.maxPagesPerSync,
        maxJobs: plan.limits.maxJobsPerSync,
        requestsPerMinute: plan.limits.requestsPerMinute,
      },
      beforeRequest: () => sourceRateLimiter.acquire(plan.sourceKey, plan.limits.requestsPerMinute),
      options: plan.options,
    });
    requests = fetched.requests;
    truncated = fetched.truncated;
    counts.fetched = fetched.postings.length;

    await setStage(actor, runId, "NORMALIZING");
    const jobs: CanonicalJob[] = [];
    for (const posting of fetched.postings) {
      const parsed = canonicalJobSchema.safeParse(
        adapter.toCanonical(posting, plan.board, { options: plan.options }),
      );
      if (parsed.success) jobs.push(parsed.data);
      else {
        const key =
          parsed.error.issues
            .map((i) => i.path.join("."))
            .slice(0, 3)
            .join(",") || "unknown";
        invalidReasons[key] = (invalidReasons[key] ?? 0) + 1;
      }
    }
    counts.valid = jobs.length;
    counts.invalid = fetched.postings.length - jobs.length;

    await setStage(actor, runId, "DEDUPLICATING");
    const ingested = await ingestBoard({
      sourceKey: plan.sourceKey,
      board: plan.board.id,
      sourceId: plan.sourceId,
      jobs,
      complete: !truncated,
      categories: ctx.systemCategories,
    });
    Object.assign(counts, {
      created: ingested.created,
      updated: ingested.updated,
      unchanged: ingested.unchanged,
      duplicates: ingested.duplicates,
      flagged: ingested.flagged,
      closed: ingested.closed,
    });

    await setStage(actor, runId, "MATCHING_PROFILE");
    counts.matched = await matchProfile(
      actor,
      runId,
      ctx.profileId,
      ctx.criteria,
      ctx.userCategories,
      ingested.jobIds,
    );

    await withUserContext(actor.userId, async (t) => {
      const { matched: _matched, ...syncCounts } = counts;
      await t.sourceSyncRun.update({
        where: { id: sync.id },
        data: {
          ...syncCounts,
          requests,
          truncated,
          status: "SUCCEEDED",
          invalidReasons,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        },
      });
      await t.jobSource.update({
        where: { id: plan.sourceId },
        data: {
          status: "READY",
          lastSyncAt: new Date(),
          lastSuccessAt: new Date(),
          lastError: null,
        },
      });
    });
    return { ok: true, counts };
  } catch (error) {
    const { kind, message } = errorText(error);
    logger.warn("discovery board failed", { sourceKey: plan.sourceKey, kind });
    await withUserContext(actor.userId, async (t) => {
      await t.sourceSyncRun.update({
        where: { id: sync.id },
        data: {
          fetched: counts.fetched,
          valid: counts.valid,
          invalid: counts.invalid,
          requests,
          truncated,
          status: "FAILED",
          errorKind: kind,
          errorMessage: message.slice(0, 2000),
          invalidReasons,
          durationMs: Date.now() - started,
          finishedAt: new Date(),
        },
      });
      await t.jobSource.update({
        where: { id: plan.sourceId },
        data: {
          status: "ERROR",
          lastSyncAt: new Date(),
          lastError: `${plan.board.id}: ${message}`.slice(0, 1000),
        },
      });
    });
    return { ok: false, counts };
  }
}

/** Executes a QUEUED run to completion. Safe to call in the background (after()). */
export async function executeDiscoveryRun(actor: ActorRef, runId: string) {
  try {
    const setup = await withUserContext(actor.userId, async (t) => {
      const run = await t.discoveryRun.findFirst({ where: { id: runId, userId: actor.userId } });
      if (!run || run.status !== "QUEUED" || !run.profileId) return null;
      await t.discoveryRun.update({
        where: { id: run.id },
        data: {
          status: "RUNNING",
          stage: "FETCHING",
          startedAt: new Date(),
          heartbeatAt: new Date(),
        },
      });
      const profile = await getSearchProfile(actor, run.profileId, t);
      const criteria = await criteriaForProfile(t, actor, profile);
      const boards = await planBoards(t, actor, profile.sourceKeys);
      const categories = await t.jobCategory.findMany({
        where: { OR: [{ userId: null }, { userId: actor.userId }] },
        select: {
          id: true,
          userId: true,
          terms: {
            where: { OR: [{ userId: null }, { userId: actor.userId }] },
            select: { term: true, userId: true },
          },
        },
      });
      const systemCategories = categories
        .filter((c) => c.userId === null)
        .map((c) => ({
          id: c.id,
          terms: c.terms.filter((x) => x.userId === null).map((x) => x.term),
        }))
        .filter((c) => c.terms.length);
      // User categories: own custom categories (all their terms) + the user's own terms on system categories.
      const userCategories = categories
        .map((c) => ({
          id: c.id,
          terms: c.terms.filter((x) => x.userId === actor.userId).map((x) => x.term),
        }))
        .filter((c) => c.terms.length);
      return { profile, criteria, boards, systemCategories, userCategories };
    });
    if (!setup) return;

    const totals = {
      fetched: 0,
      valid: 0,
      invalid: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      duplicates: 0,
      flagged: 0,
      closed: 0,
      matched: 0,
    };
    let failures = 0;
    let done = 0;
    for (const plan of setup.boards) {
      const outcome = await processBoard(actor, runId, plan, {
        profileId: setup.profile.id,
        criteria: setup.criteria,
        systemCategories: setup.systemCategories,
        userCategories: setup.userCategories,
      });
      done++;
      if (!outcome.ok) failures++;
      for (const k of Object.keys(totals) as (keyof typeof totals)[])
        totals[k] += outcome.counts[k];
      await withUserContext(actor.userId, (t) =>
        t.discoveryRun.update({
          where: { id: runId },
          data: { ...totals, sourcesDone: done, errorCount: failures, heartbeatAt: new Date() },
        }),
      );
    }

    const status =
      failures === 0 ? "SUCCEEDED" : failures === setup.boards.length ? "FAILED" : "PARTIAL";
    await withUserContext(actor.userId, async (t) => {
      const finishedAt = new Date();
      await t.discoveryRun.update({
        where: { id: runId },
        data: {
          status,
          stage: "DONE",
          finishedAt,
          message: failures
            ? `${failures} of ${setup.boards.length} boards failed — see sync history for details.`
            : null,
        },
      });
      const hours = setup.profile.scheduleIntervalHours;
      await t.searchProfile.update({
        where: { id: setup.profile.id },
        data: {
          lastRunAt: finishedAt,
          nextRunAt:
            hours && setup.profile.enabled
              ? new Date(finishedAt.getTime() + hours * 3_600_000)
              : null,
        },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "discovery_finished",
        resourceType: "discovery_run",
        resourceId: runId,
        metadata: { status, ...totals },
      });
    });
  } catch (error) {
    logger.error("discovery run crashed", {
      error: error instanceof Error ? { name: error.name, message: error.message } : undefined,
    });
    await withUserContext(actor.userId, (t) =>
      t.discoveryRun.updateMany({
        where: { id: runId, status: { in: ["QUEUED", "RUNNING"] } },
        data: {
          status: "FAILED",
          stage: "DONE",
          finishedAt: new Date(),
          message: "The run failed unexpectedly. Nothing was lost; you can run it again.",
        },
      }),
    ).catch(() => undefined);
  }
}

export async function getDiscoveryRun(actor: ActorRef, runId: string) {
  const run = await withUserContext(actor.userId, (t) =>
    t.discoveryRun.findFirst({
      where: { id: runId, userId: actor.userId },
      include: {
        syncRuns: { orderBy: { startedAt: "asc" } },
        profile: { select: { id: true, name: true } },
      },
    }),
  );
  if (!run) throw new AppError("NOT_FOUND");
  return run;
}

export async function listDiscoveryRuns(actor: ActorRef, take = 20) {
  return withUserContext(actor.userId, (t) =>
    t.discoveryRun.findMany({
      where: { userId: actor.userId },
      include: { profile: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
  );
}

export async function listSyncRuns(
  actor: ActorRef,
  opts: { sourceId?: string; take?: number } = {},
) {
  return withUserContext(actor.userId, (t) =>
    t.sourceSyncRun.findMany({
      where: { userId: actor.userId, ...(opts.sourceId ? { sourceId: opts.sourceId } : {}) },
      orderBy: { startedAt: "desc" },
      take: opts.take ?? 50,
    }),
  );
}

/** Source test: fetch + validate the configured boards (max 3). No catalog writes. */
export async function testSource(actor: ActorRef, sourceId: string) {
  const source = await withUserContext(actor.userId, (t) =>
    t.jobSource.findFirst({ where: { id: sourceId, userId: actor.userId } }),
  );
  if (!source) throw new AppError("NOT_FOUND");
  if (!isAtsSourceKey(source.sourceKey))
    throw new AppError("VALIDATION_ERROR", { publicMessage: "Manual Entry has nothing to test." });
  const key = source.sourceKey as AtsSourceKey;
  const config = (source.configuration ?? {}) as Record<string, unknown>;
  const boards = configuredBoards(key, config).slice(0, 3);
  if (boards.length === 0)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Add at least one board before testing.",
    });
  const limits = rateLimitsFrom(source.rateLimitSettings);
  const results: { board: string; ok: boolean; fetched: number; valid: number; message: string }[] =
    [];
  for (const board of boards) {
    const started = Date.now();
    const adapter = ADAPTERS[key];
    const options = key === "LEVER" ? { region: config.region ?? "GLOBAL" } : {};
    try {
      const res = await adapter.fetchBoard(board, {
        limits: {
          timeoutMs: limits.timeoutMs,
          maxPages: 1,
          maxJobs: Math.min(limits.maxJobsPerSync, 100),
          requestsPerMinute: limits.requestsPerMinute,
        },
        beforeRequest: () => sourceRateLimiter.acquire(key, limits.requestsPerMinute),
        options,
      });
      const valid = res.postings.filter(
        (p) => canonicalJobSchema.safeParse(adapter.toCanonical(p, board, { options })).success,
      ).length;
      results.push({
        board: board.id,
        ok: true,
        fetched: res.postings.length,
        valid,
        message: `${valid}/${res.postings.length} postings valid`,
      });
      await withUserContext(actor.userId, (t) =>
        t.sourceSyncRun.create({
          data: {
            userId: actor.userId,
            sourceId,
            sourceKey: key,
            board: board.id,
            kind: "TEST",
            status: "SUCCEEDED",
            requests: res.requests,
            fetched: res.postings.length,
            valid,
            invalid: res.postings.length - valid,
            truncated: res.truncated,
            durationMs: Date.now() - started,
            finishedAt: new Date(),
          },
        }),
      );
    } catch (error) {
      const { kind, message } = errorText(error);
      results.push({ board: board.id, ok: false, fetched: 0, valid: 0, message });
      await withUserContext(actor.userId, (t) =>
        t.sourceSyncRun.create({
          data: {
            userId: actor.userId,
            sourceId,
            sourceKey: key,
            board: board.id,
            kind: "TEST",
            status: "FAILED",
            errorKind: kind,
            errorMessage: message.slice(0, 2000),
            durationMs: Date.now() - started,
            finishedAt: new Date(),
          },
        }),
      );
    }
  }
  const failed = results.filter((r) => !r.ok);
  await withUserContext(actor.userId, async (t) => {
    await t.jobSource.update({
      where: { id: sourceId },
      data: {
        status: failed.length ? "ERROR" : "READY",
        lastTestedAt: new Date(),
        lastError: failed.length
          ? failed
              .map((f) => `${f.board}: ${f.message}`)
              .join("; ")
              .slice(0, 1000)
          : null,
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "source_tested",
      resourceType: "job_source",
      resourceId: sourceId,
      metadata: { boards: results.length, failed: failed.length },
    });
  });
  return results;
}

/** Health per source from its latest sync/test runs (one query, grouped in memory). */
export async function listSourceHealth(
  actor: ActorRef,
  sources: { id: string; enabled: boolean; sourceKey: string }[],
): Promise<Map<string, SourceHealth>> {
  const runsBySource = await withUserContext(actor.userId, async (t) => {
    const out = new Map<string, { status: string; startedAt: Date }[]>();
    for (const s of sources) {
      out.set(
        s.id,
        await t.sourceSyncRun.findMany({
          where: { userId: actor.userId, sourceId: s.id },
          select: { status: true, startedAt: true },
          orderBy: { startedAt: "desc" },
          take: HEALTH_WINDOW,
        }),
      );
    }
    return out;
  });
  return new Map(
    sources.map((s) => [
      s.id,
      computeSourceHealth(runsBySource.get(s.id) ?? [], {
        enabled: s.enabled,
        manual: s.sourceKey === "MANUAL",
      }),
    ]),
  );
}

/** One source with its sync/test history and health (owner only). */
export async function getSourceHistory(actor: ActorRef, sourceId: string, take = 100) {
  const source = await withUserContext(actor.userId, (t) =>
    t.jobSource.findFirst({ where: { id: sourceId, userId: actor.userId } }),
  );
  if (!source) throw new AppError("NOT_FOUND");
  const runs = await listSyncRuns(actor, { sourceId, take });
  const health = computeSourceHealth(runs, {
    enabled: source.enabled,
    manual: source.sourceKey === "MANUAL",
  });
  return { source, runs, health };
}
