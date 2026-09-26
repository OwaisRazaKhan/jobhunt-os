import "server-only";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { matchCandidateToJob, type ActorRef } from "./match.service";
import { matchingNodeInput, type MatchingNodeOutput } from "./types";

/**
 * Matching node contract for the future workflow canvas (Phase 9). Not wired to any UI yet.
 * Input {candidateId, jobIds?, threshold?, options?} → {matchedJobs, partialJobs, blockedJobs, unknownJobs}.
 * Without jobIds it matches the caller's bookmarked jobs (an explicit user selection).
 * It only computes and stores matches — it never triggers any outbound action.
 */
const RANK: Record<string, number> = {
  STRONG_MATCH: 3,
  GOOD_MATCH: 2,
  PARTIAL_MATCH: 1,
  LOW_MATCH: 0,
};

export async function runMatchingNode(actor: ActorRef, raw: unknown): Promise<MatchingNodeOutput> {
  const input = matchingNodeInput.parse(raw);
  const threshold = RANK[input.threshold ?? "GOOD_MATCH"]!;
  const jobIds =
    input.jobIds ??
    (
      await withUserContext(actor.userId, (t) =>
        t.userJobState.findMany({
          where: { userId: actor.userId, bookmarkedAt: { not: null }, job: { deletedAt: null } },
          select: { jobId: true },
          take: 200,
        }),
      )
    ).map((s) => s.jobId);
  const out: MatchingNodeOutput = {
    matchedJobs: [],
    partialJobs: [],
    blockedJobs: [],
    unknownJobs: [],
  };
  for (const jobId of new Set(jobIds)) {
    try {
      const { match } = await matchCandidateToJob(actor, input.candidateId, jobId, {
        source: "WORKFLOW",
      });
      const item = { jobId, matchId: match.id, overallStatus: match.overallStatus };
      if (match.overallStatus === "BLOCKED")
        out.blockedJobs.push({
          jobId,
          matchId: match.id,
          reason: match.hardBlockReason ?? "Hard block",
        });
      else if (match.overallStatus === "INSUFFICIENT_DATA")
        out.unknownJobs.push({ jobId, reason: match.summary ?? "Insufficient data" });
      else if ((RANK[match.overallStatus] ?? 0) >= threshold) out.matchedJobs.push(item);
      else out.partialJobs.push(item);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")
      )
        out.unknownJobs.push({ jobId, reason: error.publicMessage ?? "Not available" });
      else throw error;
    }
  }
  return out;
}
