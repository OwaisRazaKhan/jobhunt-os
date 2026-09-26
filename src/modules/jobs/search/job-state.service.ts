import "server-only";
import { recordAudit } from "@/server/audit";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { visibleTo } from "../jobs.repository";

/**
 * JobVisibility / bookmark state — per-user preferences about a shared job.
 * Never modifies or deletes the canonical job; another user's view is unaffected.
 */

type ActorRef = { userId: string };
export type JobStateChange = "bookmark" | "unbookmark" | "hide" | "restore";

const AUDIT = {
  bookmark: "job_bookmarked",
  unbookmark: "job_unbookmarked",
  hide: "job_hidden",
  restore: "job_restored",
} as const;

export async function setJobState(actor: ActorRef, jobId: string, change: JobStateChange) {
  return withUserContext(actor.userId, async (t) => {
    const job = await t.job.findFirst({
      where: { id: jobId, ...visibleTo(actor.userId) },
      select: { id: true },
    });
    if (!job) throw new AppError("NOT_FOUND");
    const now = new Date();
    const data =
      change === "bookmark"
        ? { bookmarkedAt: now }
        : change === "unbookmark"
          ? { bookmarkedAt: null }
          : change === "hide"
            ? { hiddenAt: now }
            : { hiddenAt: null };
    const state = await t.userJobState.upsert({
      where: { userId_jobId: { userId: actor.userId, jobId } },
      create: { userId: actor.userId, jobId, ...data },
      update: data,
    });
    // A row with nothing set carries no information; remove it.
    if (!state.bookmarkedAt && !state.hiddenAt) {
      await t.userJobState.delete({ where: { id: state.id } });
    }
    await recordAudit(t, {
      userId: actor.userId,
      action: AUDIT[change],
      resourceType: "job",
      resourceId: jobId,
    });
    return { bookmarked: Boolean(state.bookmarkedAt), hidden: Boolean(state.hiddenAt) };
  });
}

export async function getJobState(actor: ActorRef, jobId: string) {
  const state = await withUserContext(actor.userId, (t) =>
    t.userJobState.findUnique({ where: { userId_jobId: { userId: actor.userId, jobId } } }),
  );
  return {
    bookmarkedAt: state?.bookmarkedAt ?? null,
    hiddenAt: state?.hiddenAt ?? null,
  };
}

/** Counts for the Jobs navigation tabs. */
export async function countJobStates(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const base = { userId: actor.userId, job: visibleTo(actor.userId) };
    const bookmarked = await t.userJobState.count({
      where: { ...base, bookmarkedAt: { not: null }, hiddenAt: null },
    });
    const hidden = await t.userJobState.count({ where: { ...base, hiddenAt: { not: null } } });
    return { bookmarked, hidden };
  });
}
