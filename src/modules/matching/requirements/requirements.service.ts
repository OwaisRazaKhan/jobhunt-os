import "server-only";
import { getDb, withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { createRequirementSet, findCurrentRequirementSet } from "../match.repository";
import { EXTRACTOR_VERSION, extractRequirements, type ExtractableJob } from "./extract";

/**
 * JobRequirementService. Requirements are derived deterministically from the job's own
 * content, so extraction is a SYSTEM action on catalog data: visibility is checked in the
 * user's context, the set is written with the owner connection (like catalog ingestion).
 * A set is re-extracted only when the job content or the extractor version changed.
 */

type ActorRef = { userId: string };

const extractableSelect = {
  id: true,
  title: true,
  description: true,
  locationRaw: true,
  city: true,
  region: true,
  countryCode: true,
  remoteStatus: true,
  remoteStatusRaw: true,
  employmentType: true,
  employmentTypeRaw: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryPeriod: true,
  salaryRaw: true,
  experienceLevel: true,
  experienceLevelRaw: true,
  visaTextRaw: true,
  contentHash: true,
} as const;

type SetWithRequirements = NonNullable<Awaited<ReturnType<typeof findCurrentRequirementSet>>>;

/** Is the current set still valid for this job content and extractor? (User-edited sets are kept.) */
function isUpToDate(
  set: { extractorVersion: string; jobContentHash: string } | null,
  contentHash: string,
) {
  if (!set) return false;
  if (set.extractorVersion === "user") return true;
  return set.extractorVersion === EXTRACTOR_VERSION && set.jobContentHash === contentHash;
}

async function extractAndStore(t: Tx, job: ExtractableJob & { id: string; contentHash: string }) {
  // Serialise extraction per job: lock the job row, then re-check — a concurrent request may
  // already have stored an up-to-date set while we were waiting.
  await t.$queryRaw`SELECT "id" FROM "jobs" WHERE "id" = ${job.id}::uuid FOR UPDATE`;
  const current = await findCurrentRequirementSet(t, job.id);
  if (current && isUpToDate(current, job.contentHash)) return { set: current, created: false };
  const rows = extractRequirements(job).map((r) => ({
    category: r.category,
    requirementType: r.requirementType,
    text: r.text,
    normalizedValue: r.normalizedValue as object,
    sourceText: r.sourceText,
    sourceReference: r.sourceReference,
    confidence: r.confidence,
    extractionMethod: "RULE",
    extractorVersion: EXTRACTOR_VERSION,
  }));
  const set = await createRequirementSet(t, job.id, {
    extractorVersion: EXTRACTOR_VERSION,
    jobContentHash: job.contentHash,
    rows,
  });
  return { set: set!, created: true };
}

/** Current requirements of a visible job, extracting (or re-extracting) them when needed. */
export async function ensureJobRequirements(
  actor: ActorRef,
  jobId: string,
): Promise<{ set: SetWithRequirements; extracted: boolean }> {
  const { job, current } = await withUserContext(actor.userId, async (t) => {
    const job = await t.job.findFirst({
      where: {
        id: jobId,
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      select: extractableSelect,
    });
    if (!job) throw new AppError("NOT_FOUND");
    return { job, current: await findCurrentRequirementSet(t, jobId) };
  });
  if (current && isUpToDate(current, job.contentHash)) return { set: current, extracted: false };
  try {
    const { set, created } = await getDb().$transaction((t) => extractAndStore(t, job));
    return { set, extracted: created };
  } catch (error) {
    // A concurrent request may have created the set first (one current set per job).
    const again = await withUserContext(actor.userId, (t) => findCurrentRequirementSet(t, jobId));
    if (again && isUpToDate(again, job.contentHash)) return { set: again, extracted: false };
    throw error;
  }
}

/** All requirement set versions of a visible job (newest first), for history/traceability. */
export async function listRequirementSets(actor: ActorRef, jobId: string) {
  return withUserContext(actor.userId, (t) =>
    t.jobRequirementSet.findMany({
      where: {
        jobId,
        job: { deletedAt: null, OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }] },
      },
      select: {
        id: true,
        version: true,
        extractorVersion: true,
        isCurrent: true,
        requirementCount: true,
        createdAt: true,
      },
      orderBy: { version: "desc" },
    }),
  );
}

/**
 * System: bring requirement sets of catalog jobs up to date (used after discovery ingestion).
 * Jobs whose set is current are skipped; failures are logged per job and never break ingestion.
 */
export async function refreshRequirementsForJobs(jobIds: string[]) {
  let extracted = 0;
  const db = getDb();
  for (let i = 0; i < jobIds.length; i += 100) {
    const part = jobIds.slice(i, i + 100);
    const jobs = await db.job.findMany({
      where: { id: { in: part }, deletedAt: null },
      select: {
        ...extractableSelect,
        requirementSets: {
          where: { isCurrent: true },
          select: { extractorVersion: true, jobContentHash: true },
        },
      },
    });
    for (const job of jobs) {
      if (isUpToDate(job.requirementSets[0] ?? null, job.contentHash)) continue;
      try {
        if ((await db.$transaction((t) => extractAndStore(t, job))).created) extracted++;
      } catch (error) {
        logger.warn("requirement extraction failed", {
          error: error instanceof Error ? { name: error.name } : undefined,
        });
      }
    }
  }
  return extracted;
}
