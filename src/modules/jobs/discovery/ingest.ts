import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { normalizeOrganization, normalizeTitle } from "@/lib/text-normalize";
import { getDb, type Tx } from "@/server/db";
import {
  CLASSIFIER_VERSION,
  classifyJob,
  experienceFromTitle,
  type CategoryTerms,
} from "@/modules/search-profiles/criteria";
import { canonicalContentHash, dedupeFingerprint, sha256, type CanonicalJob } from "./canonical";

/**
 * Catalog ingestion for ONE fetched board. Discovered jobs are PUBLIC shared catalog rows,
 * written by the system (owner client) — the RLS app role can only create private jobs.
 * The caller has already verified that the user owns an enabled source configuration.
 *
 * Deduplication layers (never silently merges an uncertain match):
 *   1. source + board + external id  → same posting: update or mark unchanged
 *   2. normalized company + title + location fingerprint → same job listed elsewhere:
 *      attach another source posting to the existing canonical job (multi-source)
 *   3. same company, other source, identical description or near-identical title in the
 *      same country → create the job AND flag a PENDING duplicate candidate for review
 * Closure: only after a COMPLETE (untruncated) board fetch, postings no longer listed are
 * marked removed; a job closes when none of its postings remain.
 */

export interface IngestInput {
  sourceKey: CanonicalJob["sourceKey"];
  board: string;
  /** The discovering user's source row (provenance for new jobs) */
  sourceId: string;
  jobs: CanonicalJob[];
  /** True only when the fetch was not truncated by limits */
  complete: boolean;
  /** System category terms used for rule classification */
  categories: readonly CategoryTerms[];
  now?: Date;
}

export interface IngestResult {
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  flagged: number;
  closed: number;
  /** Every canonical job id this board maps to (for profile evaluation) */
  jobIds: string[];
}

const SIMILAR_TITLE = 0.85;
const CHUNK = 100;

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function descriptionKey(description: string) {
  const folded = description.toLowerCase().replace(/\s+/g, " ").trim();
  return folded.length >= 200 ? sha256(folded) : null;
}

function titleTokens(title: string) {
  return new Set(
    normalizeTitle(title)
      .split(" ")
      .filter((t) => t.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>) {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function jobColumns(cj: CanonicalJob, countries: Set<string>, now: Date) {
  const experience = experienceFromTitle(cj.title);
  return {
    title: cj.title,
    normalizedTitle: normalizeTitle(cj.title),
    description: cj.description,
    locationRaw: cj.locationRaw,
    city: cj.city,
    region: cj.region,
    countryCode: cj.countryCode && countries.has(cj.countryCode) ? cj.countryCode : null,
    employmentType: cj.employmentType,
    employmentTypeRaw: cj.employmentTypeRaw,
    remoteStatus: cj.remoteStatus,
    remoteStatusRaw: cj.remoteStatusRaw,
    salaryMin: cj.salaryMin,
    salaryMax: cj.salaryMax,
    salaryCurrency: cj.salaryCurrency,
    salaryPeriod: cj.salaryPeriod,
    salaryRaw: cj.salaryRaw,
    postedAt: cj.postedAt,
    jobUrl: cj.jobUrl,
    applicationUrl: cj.applicationUrl,
    sourceUrl: cj.sourceUrl,
    visaTextRaw: cj.visaTextRaw,
    department: cj.department?.slice(0, 200) ?? null,
    team: cj.team?.slice(0, 200) ?? null,
    experienceLevel: experience.level,
    experienceLevelRaw: experience.raw,
    dedupeFingerprint: dedupeFingerprint(cj),
    sourceUpdatedAt: cj.sourceUpdatedAt,
    contentHash: canonicalContentHash(cj),
    lastSeenAt: now,
  };
}

function postingColumns(cj: CanonicalJob, now: Date) {
  return {
    jobUrl: cj.jobUrl,
    applicationUrl: cj.applicationUrl,
    sourceUrl: cj.sourceUrl,
    raw: cj.raw as Prisma.InputJsonValue,
    contentHash: canonicalContentHash(cj),
    lastSeenAt: now,
    removedAt: null,
    sourceUpdatedAt: cj.sourceUpdatedAt,
  };
}

async function resolveCompanies(t: Tx, names: string[]) {
  const byNormalized = new Map<string, string>();
  for (const name of names) {
    const normalized = normalizeOrganization(name);
    if (normalized && !byNormalized.has(normalized)) byNormalized.set(normalized, name);
  }
  const existing = await t.company.findMany({
    where: { nameNormalized: { in: [...byNormalized.keys()] } },
  });
  const ids = new Map(existing.map((c) => [c.nameNormalized, c.id]));
  const missing = [...byNormalized].filter(([n]) => !ids.has(n));
  if (missing.length) {
    await t.company.createMany({
      data: missing.map(([nameNormalized, name]) => ({ name, nameNormalized })),
      skipDuplicates: true,
    });
    const created = await t.company.findMany({
      where: { nameNormalized: { in: missing.map(([n]) => n) } },
    });
    for (const c of created) ids.set(c.nameNormalized, c.id);
  }
  return (name: string) => ids.get(normalizeOrganization(name));
}

async function writeSystemCategories(
  t: Tx,
  jobs: { id: string; title: string; department: string | null; team: string | null }[],
  categories: readonly CategoryTerms[],
) {
  if (jobs.length === 0 || categories.length === 0) return;
  for (const part of chunks(jobs)) {
    await t.jobCategoryAssignment.deleteMany({
      where: { jobId: { in: part.map((j) => j.id) }, userId: null, method: "RULE" },
    });
    const rows = part.flatMap((j) =>
      classifyJob(j, categories).map((hit) => ({
        jobId: j.id,
        categoryId: hit.categoryId,
        method: "RULE",
        confidence: hit.confidence,
        matchedTerms: hit.matchedTerms,
        classifierVersion: CLASSIFIER_VERSION,
      })),
    );
    if (rows.length) await t.jobCategoryAssignment.createMany({ data: rows, skipDuplicates: true });
  }
}

export async function ingestBoard(input: IngestInput): Promise<IngestResult> {
  const now = input.now ?? new Date();
  const result: IngestResult = {
    created: 0,
    updated: 0,
    unchanged: 0,
    duplicates: 0,
    flagged: 0,
    closed: 0,
    jobIds: [],
  };
  // De-duplicate inside the payload itself (a board never lists the same id twice, but be safe).
  const incoming = [...new Map(input.jobs.map((j) => [j.externalJobId, j])).values()];

  await getDb().$transaction(
    async (t) => {
      const countries = new Set(
        (await t.country.findMany({ select: { code: true } })).map((c) => c.code),
      );
      const companyId = await resolveCompanies(
        t,
        incoming.map((j) => j.companyName),
      );

      // Layer 1 — existing postings of this board.
      const postings = await t.jobSourcePosting.findMany({
        where: { sourceKey: input.sourceKey, board: input.board },
        select: {
          id: true,
          jobId: true,
          externalJobId: true,
          contentHash: true,
          removedAt: true,
          job: { select: { sourceKey: true, externalJobId: true, status: true } },
        },
      });
      const byExternal = new Map(postings.map((p) => [p.externalJobId, p]));

      const fresh: CanonicalJob[] = [];
      const unchangedPostingIds: string[] = [];
      const touchedJobIds = new Set<string>();
      const reclassify: {
        id: string;
        title: string;
        department: string | null;
        team: string | null;
      }[] = [];

      for (const cj of incoming) {
        const posting = byExternal.get(cj.externalJobId);
        if (!posting) {
          fresh.push(cj);
          continue;
        }
        touchedJobIds.add(posting.jobId);
        const hash = canonicalContentHash(cj);
        const isPrimary =
          posting.job.sourceKey === input.sourceKey &&
          posting.job.externalJobId === cj.externalJobId;
        const reopened = posting.removedAt !== null || posting.job.status === "CLOSED";
        if (hash === posting.contentHash && !reopened) {
          unchangedPostingIds.push(posting.id);
          result.unchanged++;
          continue;
        }
        await t.jobSourcePosting.update({
          where: { id: posting.id },
          data: postingColumns(cj, now),
        });
        if (isPrimary) {
          const cid = companyId(cj.companyName);
          await t.job.update({
            where: { id: posting.jobId },
            data: {
              ...jobColumns(cj, countries, now),
              ...(cid ? { companyId: cid } : {}),
              ...(hash !== posting.contentHash ? { lastContentChangeAt: now } : {}),
              ...(reopened ? { status: "OPEN", closedAt: null } : {}),
            },
          });
          reclassify.push({
            id: posting.jobId,
            title: cj.title,
            department: cj.department,
            team: cj.team,
          });
        } else if (reopened) {
          await t.job.updateMany({
            where: { id: posting.jobId, status: "CLOSED" },
            data: { status: "OPEN", closedAt: null, lastSeenAt: now },
          });
        }
        result.updated++;
      }

      if (unchangedPostingIds.length) {
        for (const part of chunks(unchangedPostingIds, 500)) {
          await t.jobSourcePosting.updateMany({
            where: { id: { in: part } },
            data: { lastSeenAt: now },
          });
        }
      }

      // Layer 2 — same job already in the catalog from another source/board.
      const fingerprints = [...new Set(fresh.map((cj) => dedupeFingerprint(cj)))];
      const existingByFingerprint = new Map<string, string>();
      for (const part of chunks(fingerprints, 500)) {
        const rows = await t.job.findMany({
          where: { dedupeFingerprint: { in: part }, visibility: "PUBLIC", deletedAt: null },
          select: { id: true, dedupeFingerprint: true },
          orderBy: { createdAt: "asc" },
        });
        for (const r of rows)
          if (r.dedupeFingerprint && !existingByFingerprint.has(r.dedupeFingerprint))
            existingByFingerprint.set(r.dedupeFingerprint, r.id);
      }

      const toCreate: CanonicalJob[] = [];
      const attachRows: Prisma.JobSourcePostingCreateManyInput[] = [];
      for (const cj of fresh) {
        const existingId = existingByFingerprint.get(dedupeFingerprint(cj));
        if (existingId) {
          attachRows.push({
            jobId: existingId,
            sourceKey: input.sourceKey,
            board: input.board,
            externalJobId: cj.externalJobId,
            ...postingColumns(cj, now),
          });
          touchedJobIds.add(existingId);
          result.duplicates++;
        } else {
          toCreate.push(cj);
        }
      }
      if (attachRows.length) {
        await t.jobSourcePosting.createMany({ data: attachRows, skipDuplicates: true });
        await t.job.updateMany({
          where: { id: { in: attachRows.map((r) => r.jobId) }, status: "CLOSED" },
          data: { status: "OPEN", closedAt: null },
        });
      }

      // Layer 3 preparation — same-company jobs that come from OTHER boards/sources.
      const companyIds = [
        ...new Set(
          toCreate.map((cj) => companyId(cj.companyName)).filter((x): x is string => Boolean(x)),
        ),
      ];
      const others = companyIds.length
        ? await t.job.findMany({
            where: {
              companyId: { in: companyIds },
              visibility: "PUBLIC",
              deletedAt: null,
              postings: { none: { sourceKey: input.sourceKey, board: input.board } },
            },
            select: {
              id: true,
              companyId: true,
              title: true,
              countryCode: true,
              description: true,
            },
            take: 5000,
          })
        : [];
      const otherIndex = others.map((o) => ({
        ...o,
        tokens: titleTokens(o.title),
        descKey: descriptionKey(o.description),
      }));

      // Create new canonical jobs (batched) and their postings.
      const flags: Prisma.JobDuplicateCandidateCreateManyInput[] = [];
      for (const part of chunks(toCreate)) {
        const rows = part.flatMap((cj) => {
          const cid = companyId(cj.companyName);
          if (!cid) return [];
          return [
            {
              ...jobColumns(cj, countries, now),
              companyId: cid,
              sourceId: input.sourceId,
              sourceKey: input.sourceKey,
              sourceType: "ATS_PUBLIC_API",
              sourceStatus: "DISCOVERED",
              externalJobId: cj.externalJobId,
              visibility: "PUBLIC",
              status: "OPEN",
              discoveredAt: now,
              lastContentChangeAt: now,
            },
          ];
        });
        const created = await t.job.createManyAndReturn({
          data: rows,
          select: { id: true, externalJobId: true },
        });
        const idByExternal = new Map(created.map((c) => [c.externalJobId, c.id]));
        await t.jobSourcePosting.createMany({
          data: part
            .filter((cj) => idByExternal.has(cj.externalJobId))
            .map((cj) => ({
              jobId: idByExternal.get(cj.externalJobId)!,
              sourceKey: input.sourceKey,
              board: input.board,
              externalJobId: cj.externalJobId,
              ...postingColumns(cj, now),
              firstSeenAt: now,
            })),
        });
        for (const cj of part) {
          const id = idByExternal.get(cj.externalJobId);
          if (!id) continue;
          touchedJobIds.add(id);
          reclassify.push({ id, title: cj.title, department: cj.department, team: cj.team });
          result.created++;
          const cid = companyId(cj.companyName);
          const tokens = titleTokens(cj.title);
          const descKey = descriptionKey(cj.description);
          for (const other of otherIndex) {
            if (other.companyId !== cid) continue;
            if (descKey && other.descKey === descKey) {
              flags.push({
                jobId: id,
                duplicateOfId: other.id,
                reason: "SAME_CONTENT",
                similarity: 1,
              });
              break;
            }
            const similarity = jaccard(tokens, other.tokens);
            if (similarity >= SIMILAR_TITLE && other.countryCode === (cj.countryCode ?? null)) {
              flags.push({
                jobId: id,
                duplicateOfId: other.id,
                reason: "SIMILAR_TITLE_LOCATION",
                similarity: Math.round(similarity * 100) / 100,
              });
              break;
            }
          }
        }
      }
      if (flags.length) {
        await t.jobDuplicateCandidate.createMany({ data: flags, skipDuplicates: true });
        result.flagged = flags.length;
      }

      // Keep lastSeenAt current on every canonical job this board still lists.
      for (const part of chunks([...touchedJobIds], 500)) {
        await t.job.updateMany({ where: { id: { in: part } }, data: { lastSeenAt: now } });
      }

      await writeSystemCategories(t, reclassify, input.categories);

      // Closure — only a complete fetch proves a posting is gone.
      if (input.complete) {
        const seen = new Set(incoming.map((j) => j.externalJobId));
        const gone = postings.filter((p) => p.removedAt === null && !seen.has(p.externalJobId));
        if (gone.length) {
          await t.jobSourcePosting.updateMany({
            where: { id: { in: gone.map((p) => p.id) } },
            data: { removedAt: now },
          });
          const candidates = [...new Set(gone.map((p) => p.jobId))];
          const stillListed = await t.jobSourcePosting.findMany({
            where: { jobId: { in: candidates }, removedAt: null },
            select: { jobId: true },
            distinct: ["jobId"],
          });
          const listed = new Set(stillListed.map((p) => p.jobId));
          const toClose = candidates.filter((id) => !listed.has(id));
          if (toClose.length) {
            const closed = await t.job.updateMany({
              where: { id: { in: toClose }, visibility: "PUBLIC", status: { not: "CLOSED" } },
              data: { status: "CLOSED", closedAt: now },
            });
            result.closed = closed.count;
          }
        }
      }

      result.jobIds = [...touchedJobIds];
    },
    { maxWait: 10_000, timeout: 180_000 },
  );
  return result;
}
