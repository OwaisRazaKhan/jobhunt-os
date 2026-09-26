import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { matchCandidateToJob, NO_PROFILE_MESSAGE, type ActorRef } from "./match.service";
import { BATCH_CHUNK, batchInput, MAX_BATCH_JOBS } from "./types";

/**
 * Batch matching ("Match selected jobs"). Always an explicit user action — jobs are never
 * matched automatically. Runs in the background in chunks with real progress, heartbeat and
 * cooperative cancellation; one active batch per user (partial unique index).
 */

/** A RUNNING batch without a heartbeat for this long is considered dead and marked FAILED. */
const STALE_AFTER_MS = 10 * 60 * 1000;

export type MatchBatchView = Awaited<ReturnType<typeof getMatchBatch>>;

const view = {
  id: true,
  status: true,
  total: true,
  done: true,
  failed: true,
  skipped: true,
  counts: true,
  cancelRequested: true,
  message: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} as const;

export async function startMatchBatch(actor: ActorRef, raw: unknown) {
  const parsed = batchInput.safeParse(raw);
  if (!parsed.success)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `Select between 1 and ${MAX_BATCH_JOBS} jobs.`,
    });
  const jobIds = [...new Set(parsed.data.jobIds)];
  return withUserContext(actor.userId, async (t) => {
    const profile = await t.candidateProfile.findUnique({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (!profile) throw new AppError("VALIDATION_ERROR", { publicMessage: NO_PROFILE_MESSAGE });
    await t.matchBatch.updateMany({
      where: {
        userId: actor.userId,
        status: { in: ["QUEUED", "RUNNING"] },
        OR: [
          { heartbeatAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
          { heartbeatAt: null, createdAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
        ],
      },
      data: { status: "FAILED", finishedAt: new Date(), message: "Stopped responding." },
    });
    try {
      const batch = await t.matchBatch.create({
        data: { userId: actor.userId, jobIds, total: jobIds.length, status: "QUEUED" },
        select: view,
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "match_batch_started",
        resourceType: "match_batch",
        resourceId: batch.id,
        metadata: { total: jobIds.length },
      });
      return batch;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
        throw new AppError("CONFLICT", {
          publicMessage: "A match batch is already running. Wait for it or cancel it.",
        });
      throw error;
    }
  });
}

type Counts = Record<string, number>;

/** Executes a QUEUED batch to completion. Safe to call in the background (after()). */
export async function executeMatchBatch(actor: ActorRef, batchId: string) {
  const claimed = await withUserContext(actor.userId, (t) =>
    t.matchBatch.updateMany({
      where: { id: batchId, userId: actor.userId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
    }),
  );
  if (claimed.count !== 1) return;
  const batch = await withUserContext(actor.userId, (t) =>
    t.matchBatch.findFirstOrThrow({ where: { id: batchId }, select: { jobIds: true } }),
  );
  let done = 0;
  let failed = 0;
  let skipped = 0;
  const counts: Counts = {};
  try {
    for (let i = 0; i < batch.jobIds.length; i += BATCH_CHUNK) {
      const state = await withUserContext(actor.userId, (t) =>
        t.matchBatch.findFirst({ where: { id: batchId }, select: { cancelRequested: true } }),
      );
      if (state?.cancelRequested) {
        await finish(
          actor,
          batchId,
          "CANCELLED",
          { done, failed, skipped, counts },
          `Cancelled after ${done} of ${batch.jobIds.length} jobs.`,
        );
        return;
      }
      for (const jobId of batch.jobIds.slice(i, i + BATCH_CHUNK)) {
        try {
          const { match } = await matchCandidateToJob(actor, null, jobId, { source: "BATCH" });
          counts[match.overallStatus] = (counts[match.overallStatus] ?? 0) + 1;
          done++;
        } catch (error) {
          if (error instanceof AppError && error.code === "NOT_FOUND") skipped++;
          else {
            failed++;
            logger.warn("batch match failed", {
              code: error instanceof AppError ? error.code : "UNEXPECTED",
            });
          }
        }
      }
      await withUserContext(actor.userId, (t) =>
        t.matchBatch.update({
          where: { id: batchId },
          data: { done, failed, skipped, counts, heartbeatAt: new Date() },
        }),
      );
    }
    await finish(
      actor,
      batchId,
      "COMPLETED",
      { done, failed, skipped, counts },
      `Matched ${done} job${done === 1 ? "" : "s"}${skipped ? `, ${skipped} no longer available` : ""}${failed ? `, ${failed} failed` : ""}.`,
    );
  } catch (error) {
    logger.error("match batch failed", {
      error: error instanceof Error ? { name: error.name } : undefined,
    });
    await finish(
      actor,
      batchId,
      "FAILED",
      { done, failed, skipped, counts },
      "The batch stopped because of an error. Completed matches were kept.",
    ).catch(() => undefined);
  }
}

async function finish(
  actor: ActorRef,
  batchId: string,
  status: "COMPLETED" | "CANCELLED" | "FAILED",
  progress: { done: number; failed: number; skipped: number; counts: Counts },
  message: string,
) {
  await withUserContext(actor.userId, async (t) => {
    await t.matchBatch.update({
      where: { id: batchId },
      data: { ...progress, status, message, finishedAt: new Date(), heartbeatAt: new Date() },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: status === "CANCELLED" ? "match_batch_cancelled" : "match_batch_finished",
      resourceType: "match_batch",
      resourceId: batchId,
      metadata: { status, done: progress.done, failed: progress.failed, skipped: progress.skipped },
    });
  });
}

export async function cancelMatchBatch(actor: ActorRef, batchId: string) {
  return withUserContext(actor.userId, async (t) => {
    const batch = await t.matchBatch.findFirst({
      where: { id: batchId, userId: actor.userId },
      select: { status: true },
    });
    if (!batch) throw new AppError("NOT_FOUND");
    if (batch.status === "QUEUED")
      await t.matchBatch.update({
        where: { id: batchId },
        data: {
          status: "CANCELLED",
          cancelRequested: true,
          finishedAt: new Date(),
          message: "Cancelled before it started.",
        },
      });
    else if (batch.status === "RUNNING")
      await t.matchBatch.update({ where: { id: batchId }, data: { cancelRequested: true } });
    return t.matchBatch.findFirstOrThrow({ where: { id: batchId }, select: view });
  });
}

export async function getMatchBatch(actor: ActorRef, batchId: string) {
  const batch = await withUserContext(actor.userId, (t) =>
    t.matchBatch.findFirst({ where: { id: batchId, userId: actor.userId }, select: view }),
  );
  if (!batch) throw new AppError("NOT_FOUND");
  return batch;
}

export async function latestMatchBatch(actor: ActorRef) {
  return withUserContext(actor.userId, (t) =>
    t.matchBatch.findFirst({
      where: { userId: actor.userId },
      orderBy: { createdAt: "desc" },
      select: view,
    }),
  );
}
