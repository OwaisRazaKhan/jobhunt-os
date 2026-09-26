import "server-only";
import { createFact } from "@/modules/candidate/facts.service";
import { getMatchDetail, matchCandidateToJob } from "@/modules/matching/match.service";
import { skillByKey } from "@/modules/matching/skills";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { alignRequirements, factText, textMentionsRequirement } from "./alignment";
import { runVersionCheck } from "./check.service";
import { parseResumeDocument } from "./document";
import { loadJobContext } from "./job-context";
import { blockingClaims, loadUsableFacts, type ActorRef } from "./resume.service";

/**
 * Tailored-resume readiness — the "does it pass?" gate before approval (and therefore before any
 * later phase can use the resume). A tailored version is READY only when:
 *   1. no REQUIRED job requirement is a gap or hard block for your profile (Phase 4 engine:
 *      skills via the lexicon, experience in years from dated roles, education level …)
 *   2. every REQUIRED requirement your profile supports is actually shown in this resume
 *   3. the Resume Check for this exact content has no ISSUE findings
 *   4. no visible statement is unsupported by your facts
 * Nothing here invents content. Missing skills can only be resolved by the candidate confirming
 * they really have them (confirmSkillsForJob) — which records them as facts THEY entered.
 */

export interface MissingSkill {
  requirementId: string;
  name: string;
  requirementType: string;
  text: string;
}

function skillName(r: { text: string; normalizedValue: Record<string, unknown> }) {
  const key = typeof r.normalizedValue.skill === "string" ? r.normalizedValue.skill : null;
  return (key && skillByKey(key)?.name) || r.text.replace(/^(required|preferred):\s*/i, "").trim();
}

/** Skill requirements of the job that nothing in the candidate's usable facts mentions. */
export async function missingSkillsForJob(actor: ActorRef, jobId: string): Promise<MissingSkill[]> {
  const ctx = await loadJobContext(actor, jobId);
  const facts = await withUserContext(actor.userId, (t) => loadUsableFacts(actor, t));
  const factTexts = facts.map((f) => factText(f));
  const seen = new Set<string>();
  return (
    ctx.requirements
      .filter(
        (r) =>
          r.category === "SKILL" &&
          ["REQUIRED", "PREFERRED", "UNKNOWN"].includes(r.requirementType),
      )
      // Missing = no usable fact mentions it (a related skill does not count as having it).
      .filter((r) => !factTexts.some((t) => textMentionsRequirement(t, r)))
      .map((r) => ({
        requirementId: r.id,
        name: skillName(r),
        requirementType: r.requirementType,
        text: r.text,
      }))
      .filter((m) =>
        seen.has(m.name.toLowerCase()) ? false : (seen.add(m.name.toLowerCase()), true),
      )
      .sort(
        (a, b) =>
          (a.requirementType === "REQUIRED" ? -1 : 0) - (b.requirementType === "REQUIRED" ? -1 : 0),
      )
  );
}

/**
 * The candidate confirms they HAVE these skills. Only skills the job actually lists (by requirement
 * id) are accepted; each becomes a USER_PROVIDED skill fact in the candidate profile (audited as a
 * normal manual entry), so tailoring can include it. Never called without an explicit user action.
 */
export async function confirmSkillsForJob(
  actor: ActorRef,
  jobId: string,
  requirementIds: string[],
) {
  const missing = await missingSkillsForJob(actor, jobId);
  const chosen = missing.filter((m) => requirementIds.includes(m.requirementId));
  if (!chosen.length)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Select at least one skill from this job's requirements that you have.",
    });
  const created: string[] = [];
  for (const m of chosen) {
    await createFact(actor, "skill", { name: m.name.slice(0, 80) });
    created.push(m.name);
  }
  return created;
}

export interface Readiness {
  applicable: boolean;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export async function getReadiness(actor: ActorRef, versionId: string): Promise<Readiness> {
  const version = await withUserContext(actor.userId, (t) =>
    t.resumeVersion.findFirst({
      where: { id: versionId, userId: actor.userId },
      select: { id: true, content: true, targetJobId: true },
    }),
  );
  if (!version) throw new AppError("NOT_FOUND");
  if (!version.targetJobId) return { applicable: false, ready: true, blockers: [], warnings: [] };
  const jobId = version.targetJobId;
  const doc = parseResumeDocument(version.content);
  const blockers: string[] = [];
  const warnings: string[] = [];

  // 1. Requirements vs your profile (Phase 4 deterministic engine; idempotent).
  try {
    await matchCandidateToJob(actor, null, jobId, { source: "MANUAL" });
    const detail = await getMatchDetail(actor, jobId);
    for (const r of detail.match?.requirementResults ?? []) {
      if (r.requirement.requirementType !== "REQUIRED") continue;
      if (r.status === "BLOCKED")
        blockers.push(`Hard requirement not met: ${r.requirement.text} — ${r.explanation}`);
      else if (r.status === "GAP" && r.gapKind === "REQUIRED")
        blockers.push(`Required: ${r.requirement.text} — ${r.explanation}`);
      else if (["UNKNOWN", "UNVERIFIED", "CONFLICT"].includes(r.status))
        warnings.push(`Unconfirmed: ${r.requirement.text} — ${r.explanation}`);
    }
  } catch (error) {
    blockers.push(
      error instanceof AppError && error.publicMessage
        ? error.publicMessage
        : "The job's requirements could not be compared with your profile.",
    );
  }

  // 2. Required requirements your profile supports must be visible in THIS resume.
  const ctx = await loadJobContext(actor, jobId);
  const facts = await withUserContext(actor.userId, (t) => loadUsableFacts(actor, t));
  const alignment = alignRequirements(
    ctx.requirements.filter((r) => !r.id.startsWith("research:")),
    facts,
    doc,
  );
  for (const a of alignment) {
    if (a.requirementType !== "REQUIRED") continue;
    if (a.status === "PARTIALLY_MATCHED" && a.factRefs.length && a.category === "SKILL")
      blockers.push(`Your profile has "${a.text}", but this resume does not show it.`);
    if (a.status === "UNSUPPORTED")
      blockers.push(`"${a.text}" appears in the resume but no fact of yours supports it.`);
  }

  // 3. Resume Check for this exact content.
  const report = await runVersionCheck(actor, version.id, { jobId });
  for (const f of report.check.findings.filter((x) => x.severity === "ISSUE"))
    blockers.push(`Resume Check: ${f.message}`);

  // 4. Unsupported statements.
  const unsupported = blockingClaims(doc);
  if (unsupported.length)
    blockers.push(`${unsupported.length} statement(s) are not supported by your facts.`);

  return {
    applicable: true,
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)],
    warnings,
  };
}

/** True when a required skill requirement is already expressed by the given text (UI helper). */
export { textMentionsRequirement };
