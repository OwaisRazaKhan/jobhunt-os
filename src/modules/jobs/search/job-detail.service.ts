import "server-only";
import { withUserContext } from "@/server/db";

/**
 * Catalog context for the job detail page: which of the user's Search Profiles found the
 * job (and in which run), its categories with provenance, every source posting, and the
 * user's own bookmark/hidden state. Read-only; no matching.
 */

type ActorRef = { userId: string };

export async function getJobCatalogContext(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, async (t) => {
    const hits = await t.jobSearchProfileHit.findMany({
      where: { jobId, userId: actor.userId },
      select: {
        firstMatchedAt: true,
        lastMatchedAt: true,
        discoveryRunId: true,
        profile: { select: { id: true, name: true } },
      },
      orderBy: { firstMatchedAt: "asc" },
    });
    const categories = await t.jobCategoryAssignment.findMany({
      where: { jobId, OR: [{ userId: null }, { userId: actor.userId }] },
      select: {
        method: true,
        confidence: true,
        matchedTerms: true,
        model: true,
        classifierVersion: true,
        userId: true,
        category: { select: { id: true, name: true } },
      },
      orderBy: { confidence: "desc" },
    });
    const postings = await t.jobSourcePosting.findMany({
      where: { jobId },
      select: {
        id: true,
        sourceKey: true,
        board: true,
        externalJobId: true,
        jobUrl: true,
        firstSeenAt: true,
        lastSeenAt: true,
        removedAt: true,
      },
      orderBy: { firstSeenAt: "asc" },
    });
    const state = await t.userJobState.findUnique({
      where: { userId_jobId: { userId: actor.userId, jobId } },
      select: { bookmarkedAt: true, hiddenAt: true },
    });
    return {
      hits,
      categories: categories.map(({ userId, ...c }) => ({ ...c, own: userId === actor.userId })),
      postings,
      bookmarkedAt: state?.bookmarkedAt ?? null,
      hiddenAt: state?.hiddenAt ?? null,
    };
  });
}
