import "server-only";
import { getProfile } from "@/modules/candidate/profile.service";
import { factText } from "@/modules/resumes/alignment";
import { parseResumeDocument } from "@/modules/resumes/document";
import { buildRenderModel, renderPlainText } from "@/modules/resumes/render/layout";
import { loadUsableFacts } from "@/modules/resumes/resume.service";
import type { Tx } from "@/server/db";
import type { EvidenceCorpus } from "./claims";

/**
 * Evidence behind a communication version, loaded for the EXACT versions it is locked to:
 *   candidate facts (usable only) · resume version (approved text only counts as evidence) ·
 *   job + requirement set · match · job/company research (VERIFIED_FROM_SOURCE claims only).
 * Company facts and candidate facts stay separate; research never becomes candidate evidence.
 */

export interface EvidenceRefs {
  jobId: string | null;
  resumeVersionId: string | null;
  requirementSetId: string | null;
  jobResearchId: string | null;
  matchId: string | null;
  userContext: string | null;
  recipient: { name: string | null; title: string | null; company: string | null };
}

export interface LoadedEvidence {
  corpus: EvidenceCorpus;
  job: {
    id: string;
    title: string;
    company: string | null;
    requirements: string[];
    description: string;
  } | null;
  resume: { id: string; label: string; approved: boolean; text: string } | null;
  match: { id: string; status: string; strengths: string[]; gaps: string[] } | null;
  research: {
    id: string;
    version: number;
    claims: { id: string; text: string; sourceUrl: string | null; sourceTitle: string | null }[];
  } | null;
  requirementSet: { id: string; version: number } | null;
}

export async function loadEvidence(
  t: Tx,
  actor: { userId: string },
  refs: EvidenceRefs,
): Promise<LoadedEvidence> {
  const [rawFacts, profile] = [await loadUsableFacts(actor, t), await getProfile(actor, t)];
  const facts: EvidenceCorpus["facts"] = rawFacts.map((f) => ({
    ref: f.ref,
    kind: f.kind,
    text: factText(f).replace(/\s+/g, " ").trim(),
  }));
  if (profile) {
    const about = [profile.headline, profile.summary, profile.currentCity]
      .filter(Boolean)
      .join(" \n ");
    if (about) facts.push({ ref: `profile:${profile.id}`, kind: "profile", text: about });
  }

  // Resume version (only an APPROVED version's text counts as evidence).
  let resume: LoadedEvidence["resume"] = null;
  if (refs.resumeVersionId) {
    const v = await t.resumeVersion.findFirst({
      where: { id: refs.resumeVersionId, userId: actor.userId },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        content: true,
        resume: { select: { name: true } },
      },
    });
    if (v) {
      let text = "";
      try {
        text = renderPlainText(buildRenderModel(parseResumeDocument(v.content)));
      } catch {
        text = "";
      }
      const approved = v.status === "APPROVED";
      resume = {
        id: v.id,
        label: `${v.resume.name} · v${v.versionNumber} (${v.status.toLowerCase().replace(/_/g, " ")})`,
        approved,
        text,
      };
      if (approved && text) facts.push({ ref: `resume:${v.id}`, kind: "approved resume", text });
    }
  }

  // Job + requirement set (locked id, else current).
  let job: LoadedEvidence["job"] = null;
  let requirementSet: LoadedEvidence["requirementSet"] = null;
  if (refs.jobId) {
    const row = await t.job.findFirst({
      where: { id: refs.jobId, OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }] },
      select: { id: true, title: true, description: true, company: { select: { name: true } } },
    });
    if (row) {
      const set = refs.requirementSetId
        ? await t.jobRequirementSet.findFirst({
            where: { id: refs.requirementSetId, jobId: row.id },
            include: { requirements: { orderBy: { position: "asc" } } },
          })
        : await t.jobRequirementSet.findFirst({
            where: { jobId: row.id, isCurrent: true },
            include: { requirements: { orderBy: { position: "asc" } } },
          });
      requirementSet = set ? { id: set.id, version: set.version } : null;
      job = {
        id: row.id,
        title: row.title,
        company: row.company?.name ?? null,
        description: row.description,
        requirements: (set?.requirements ?? [])
          .filter(
            (r) =>
              !["LOCATION", "WORK_MODE", "EMPLOYMENT", "SALARY", "AUTHORIZATION"].includes(
                r.category,
              ),
          )
          .map((r) => `[${r.requirementType}] ${r.text}`),
      };
    }
  }

  // Match (strengths / gaps as recorded by the deterministic matcher).
  let match: LoadedEvidence["match"] = null;
  if (refs.matchId) {
    const m = await t.jobMatch.findFirst({
      where: { id: refs.matchId, userId: actor.userId },
      select: {
        id: true,
        overallStatus: true,
        requirementResults: {
          select: { status: true, requirement: { select: { text: true } } },
          orderBy: { position: "asc" },
        },
      },
    });
    if (m) {
      match = {
        id: m.id,
        status: m.overallStatus,
        strengths: m.requirementResults
          .filter((r) => ["MATCHED", "RELATED"].includes(r.status))
          .map((r) => r.requirement.text)
          .slice(0, 15),
        gaps: m.requirementResults
          .filter((r) => r.status === "GAP")
          .map((r) => r.requirement.text)
          .slice(0, 15),
      };
    }
  }

  // Research (locked job research version + its company research), verified claims only.
  let research: LoadedEvidence["research"] = null;
  if (refs.jobResearchId) {
    const jr = await t.jobResearch.findFirst({
      where: { id: refs.jobResearchId, userId: actor.userId },
      select: { id: true, version: true, companyResearchId: true },
    });
    if (jr) {
      const claims = await t.researchClaim.findMany({
        where: {
          userId: actor.userId,
          verification: "VERIFIED_FROM_SOURCE",
          OR: [
            { jobResearchId: jr.id },
            ...(jr.companyResearchId ? [{ companyResearchId: jr.companyResearchId }] : []),
          ],
        },
        select: {
          id: true,
          claim: true,
          evidence: { select: { source: { select: { url: true, title: true } } }, take: 1 },
        },
        orderBy: { position: "asc" },
        take: 120,
      });
      research = {
        id: jr.id,
        version: jr.version,
        claims: claims.map((c) => ({
          id: c.id,
          text: c.claim,
          sourceUrl: c.evidence[0]?.source.url ?? null,
          sourceTitle: c.evidence[0]?.source.title ?? null,
        })),
      };
    }
  }

  const corpus: EvidenceCorpus = {
    facts,
    research: research?.claims ?? [],
    job: {
      title: job?.title ?? null,
      company: job?.company ?? refs.recipient.company ?? null,
      text: job
        ? [job.title, job.company ?? "", ...job.requirements, job.description].join(" \n ")
        : "",
    },
    userContext: refs.userContext,
    candidateName: profile?.fullName ?? null,
    recipient: refs.recipient,
  };
  return { corpus, job, resume, match, research, requirementSet };
}
