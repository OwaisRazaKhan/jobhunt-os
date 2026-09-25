import "server-only";
import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  executeDiscoveryRun,
  getDiscoveryRun,
  recordSkippedScheduledRun,
  startDiscovery,
} from "./run.service";

/**
 * Scheduled discovery. A profile with `schedule_interval_hours` is due when
 * `next_run_at <= now`. The cron endpoint claims due profiles and runs them one after
 * another through the normal, RLS-scoped discovery pipeline (trigger = SCHEDULED).
 *
 * Finding and claiming due profiles is the only cross-user step, so it uses the owner
 * client (like catalog ingestion) and touches just `id`, `user_id`, `next_run_at`.
 */

/** Retry soon when the user already had a run in progress. */
export const BUSY_RETRY_MS = 30 * 60_000;

export interface ClaimedProfile {
  profileId: string;
  userId: string;
}

export interface ScheduledOutcome extends ClaimedProfile {
  runId: string | null;
  status: string;
  reason?: string;
}

/**
 * Atomically claims up to `limit` due profiles by moving `next_run_at` one interval ahead.
 * The compare-and-set on the old `next_run_at` means concurrent cron calls never claim
 * the same profile twice.
 */
export async function claimDueProfiles(now: Date, limit: number): Promise<ClaimedProfile[]> {
  const db = getDb();
  const due = await db.searchProfile.findMany({
    where: { enabled: true, scheduleIntervalHours: { not: null }, nextRunAt: { lte: now } },
    select: { id: true, userId: true, nextRunAt: true, scheduleIntervalHours: true },
    orderBy: { nextRunAt: "asc" },
    take: limit,
  });
  const claimed: ClaimedProfile[] = [];
  for (const p of due) {
    const { count } = await db.searchProfile.updateMany({
      where: { id: p.id, enabled: true, nextRunAt: p.nextRunAt },
      data: { nextRunAt: new Date(now.getTime() + p.scheduleIntervalHours! * 3_600_000) },
    });
    if (count === 1) claimed.push({ profileId: p.id, userId: p.userId });
  }
  return claimed;
}

/** Runs claimed profiles sequentially (one active run per user is enforced by startDiscovery). */
export async function runClaimedProfiles(
  claimed: readonly ClaimedProfile[],
  now = new Date(),
): Promise<ScheduledOutcome[]> {
  const outcomes: ScheduledOutcome[] = [];
  for (const c of claimed) {
    const actor = { userId: c.userId };
    try {
      const run = await startDiscovery(actor, c.profileId, "SCHEDULED");
      await executeDiscoveryRun(actor, run.id);
      const done = await getDiscoveryRun(actor, run.id);
      outcomes.push({ ...c, runId: run.id, status: done.status });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      const reason = error instanceof AppError ? error.publicMessage : "Unexpected error";
      if (code === "CONFLICT") {
        // The user was already running discovery; try this profile again soon.
        await getDb().searchProfile.updateMany({
          where: { id: c.profileId },
          data: { nextRunAt: new Date(now.getTime() + BUSY_RETRY_MS) },
        });
      } else if (code === "INTERNAL_ERROR") {
        logger.error("scheduled discovery failed", { code });
      } else {
        // VALIDATION (disabled / no boards): keep the next interval, but leave a visible record.
        await recordSkippedScheduledRun(actor, c.profileId, reason).catch(() => undefined);
      }
      outcomes.push({ ...c, runId: null, status: "SKIPPED", reason });
    }
  }
  return outcomes;
}

export async function runDueDiscovery(opts: { now?: Date; limit: number }) {
  const now = opts.now ?? new Date();
  const claimed = await claimDueProfiles(now, opts.limit);
  return runClaimedProfiles(claimed, now);
}
