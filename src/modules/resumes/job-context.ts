import "server-only";
import { ensureJobRequirements } from "@/modules/matching/requirements/requirements.service";
import { findSkills, skillByKey } from "@/modules/matching/skills";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import type { AlignRequirement } from "./alignment";

/**
 * Everything Resume Studio needs about a target job, loaded from existing phases:
 * the job itself (Phase 2/3), its current structured requirements (Phase 4), the user's latest
 * match summary (Phase 4) and verified job-research claims (Phase 5).
 * Research only adds emphasis signals (INFORMATIONAL requirements); company facts never
 * become candidate facts.
 */
export interface JobContext {
  job: {
    id: string;
    title: string;
    company: string | null;
    description: string;
    locationRaw: string;
    remoteStatus: string;
    employmentType: string;
  };
  requirements: AlignRequirement[];
  /** Emphasis derived from verified research claims (subset of `requirements`) */
  researchSignals: { requirementId: string; skill: string; claim: string }[];
  match: { overallStatus: string; computedAt: Date } | null;
}

export async function loadJobContext(
  actor: { userId: string },
  jobId: string,
): Promise<JobContext> {
  const job = await withUserContext(actor.userId, (t) =>
    t.job.findFirst({
      where: {
        id: jobId,
        deletedAt: null,
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      select: {
        id: true,
        title: true,
        description: true,
        locationRaw: true,
        remoteStatus: true,
        employmentType: true,
        company: { select: { name: true } },
      },
    }),
  );
  if (!job)
    throw new AppError("NOT_FOUND", {
      publicMessage: "The target job was not found or is no longer available.",
    });

  const { set } = await ensureJobRequirements(actor, jobId);
  const requirements: AlignRequirement[] = set.requirements.map((r) => ({
    id: r.id,
    category: r.category,
    requirementType: r.requirementType,
    text: r.text,
    normalizedValue: (r.normalizedValue ?? {}) as Record<string, unknown>,
  }));

  const extra = await withUserContext(actor.userId, async (t) => {
    const match = await t.jobMatch.findFirst({
      where: { userId: actor.userId, jobId },
      select: { overallStatus: true, computedAt: true },
      orderBy: { computedAt: "desc" },
    });
    const research = await t.jobResearch.findFirst({
      where: { userId: actor.userId, jobId, isCurrent: true },
      select: {
        claims: {
          where: { verification: "VERIFIED_FROM_SOURCE" },
          select: { id: true, claim: true },
          take: 200,
        },
      },
    });
    return { match, claims: research?.claims ?? [] };
  });

  const known = new Set(
    requirements
      .map((r) => (typeof r.normalizedValue.skill === "string" ? r.normalizedValue.skill : null))
      .filter(Boolean),
  );
  const researchSignals: JobContext["researchSignals"] = [];
  for (const c of extra.claims) {
    for (const s of findSkills(c.claim)) {
      if (known.has(s.key)) continue;
      known.add(s.key);
      const id = `research:${c.id}:${s.key}`;
      requirements.push({
        id,
        category: "SKILL",
        requirementType: "INFORMATIONAL",
        text: skillByKey(s.key)?.name ?? s.matched,
        normalizedValue: { skill: s.key, source: "research" },
      });
      researchSignals.push({
        requirementId: id,
        skill: skillByKey(s.key)?.name ?? s.matched,
        claim: c.claim.slice(0, 300),
      });
    }
  }

  return {
    job: {
      id: job.id,
      title: job.title,
      company: job.company?.name ?? null,
      description: job.description,
      locationRaw: job.locationRaw,
      remoteStatus: job.remoteStatus,
      employmentType: job.employmentType,
    },
    requirements,
    researchSignals,
    match: extra.match,
  };
}
