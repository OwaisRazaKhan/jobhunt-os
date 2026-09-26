import { foldText } from "@/modules/search-profiles/criteria";
import { degreeLevel } from "../requirements/extract";
import { areRelatedSkills, findSkills, skillByKey, skillCompareKey } from "../skills";
import {
  formatYears,
  mergedMonths,
  monthIndex,
  parseMonth,
  PROFESSIONAL_TYPES,
  rolePeriod,
  type Period,
} from "./experience";
import {
  EVIDENCE_RANK,
  isUsable,
  type CandidateEvidence,
  type EvidenceItem,
  type GapKind,
  type MatchingSettings,
  type RequirementLike,
  type RequirementResult,
  type ResultStatus,
  type Verification,
} from "./types";

/**
 * Per-requirement deterministic evaluators (pure). Rules:
 *  - Only VERIFIED / USER_PROVIDED facts can satisfy a requirement. Facts that still need
 *    review make the result UNVERIFIED, never MATCHED.
 *  - Nothing recorded → UNKNOWN (never assumed compatible or incompatible).
 *  - Hard blocks only for explicit incompatibilities (authorization / sponsorship) or a
 *    preference the user marked as mandatory. Every block cites the job requirement and
 *    the candidate evidence.
 *  - Related ≠ exact; in-progress degree ≠ completed; projects ≠ professional experience.
 */

export interface EvalContext {
  candidate: CandidateEvidence;
  settings: MatchingSettings;
  now: Date;
  jobCountryCode: string | null;
}

const EU = new Set([
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
]);

const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ev(
  kind: string,
  fact: { id: string; verification: Verification },
  label: string,
  excerpt?: string | null,
): EvidenceItem {
  return {
    ref: `${kind}:${fact.id}`,
    kind,
    label,
    ...(excerpt ? { excerpt: clip(excerpt) } : {}),
    verification: fact.verification,
  };
}

function strongest(items: EvidenceItem[], max = 3): EvidenceItem[] {
  const seen = new Set<string>();
  return [...items]
    .sort((a, b) => EVIDENCE_RANK[b.verification] - EVIDENCE_RANK[a.verification])
    .filter((e) => (seen.has(e.ref) ? false : (seen.add(e.ref), true)))
    .slice(0, max);
}

function gapKind(req: RequirementLike): GapKind {
  return req.requirementType === "REQUIRED" ? "REQUIRED" : "PREFERRED";
}

function result(
  req: RequirementLike,
  status: ResultStatus,
  explanation: string,
  extra: Partial<Omit<RequirementResult, "requirementId" | "status" | "explanation">> = {},
): RequirementResult {
  return {
    requirementId: req.id,
    status,
    relationship: extra.relationship ?? null,
    gapKind: status === "GAP" ? (extra.gapKind ?? gapKind(req)) : null,
    isHardBlock: status === "BLOCKED",
    evidence: extra.evidence ?? [],
    explanation: clip(explanation, 1000),
    method: extra.method ?? "RULE",
  };
}

const importanceNote = (req: RequirementLike) =>
  req.requirementType === "UNKNOWN" ? " (the job does not say whether this is required)" : "";

// --- Skills -----------------------------------------------------------------------------

interface SkillSource {
  key: string;
  evidence: EvidenceItem;
}

/** Every place the candidate's facts name a skill. Text mentions only use the curated lexicon. */
export function candidateSkillSources(c: CandidateEvidence): SkillSource[] {
  const out: SkillSource[] = [];
  for (const s of c.skills)
    out.push({ key: skillCompareKey(s.name), evidence: ev("skill", s, `Skill: ${s.name}`) });
  for (const e of c.experiences) {
    const label = `Experience: ${e.title} — ${e.organization}`;
    for (const name of e.skillsUsed)
      out.push({
        key: skillCompareKey(name),
        evidence: ev("experience", e, label, `Skills used: ${e.skillsUsed.join(", ")}`),
      });
    for (const line of [e.title, ...e.responsibilities, e.description ?? ""]) {
      for (const hit of findSkills(line))
        out.push({ key: hit.key, evidence: ev("experience", e, label, line) });
    }
  }
  for (const p of c.projects) {
    const label = `Project: ${p.name}`;
    for (const name of [...p.skills, ...p.technologies])
      out.push({
        key: skillCompareKey(name),
        evidence: ev(
          "project",
          p,
          label,
          `Skills/technologies: ${[...p.skills, ...p.technologies].join(", ")}`,
        ),
      });
    for (const hit of findSkills(`${p.name} ${p.description ?? ""}`))
      out.push({ key: hit.key, evidence: ev("project", p, label, p.description) });
  }
  return out;
}

function requirementSkillKey(req: RequirementLike): string {
  const raw = String(req.normalizedValue.skill ?? req.text);
  return skillByKey(raw) ? raw : skillCompareKey(raw);
}

function skillName(key: string) {
  return skillByKey(key)?.name ?? key.replace(/^name:/, "");
}

export function evaluateSkill(
  req: RequirementLike,
  ctx: EvalContext,
  sources: SkillSource[],
): RequirementResult {
  const key = requirementSkillKey(req);
  const anyOf = Array.isArray(req.normalizedValue.anyOf)
    ? (req.normalizedValue.anyOf as string[])
    : [];
  // "HubSpot or CRM": the group is assessed once, on its first alternative.
  if (anyOf.length > 1 && anyOf.includes(key) && anyOf[0] !== key)
    return result(
      req,
      "NOT_APPLICABLE",
      `Alternative to ${skillName(anyOf[0]!)} — the job accepts either, so they are assessed together.`,
    );
  const exact = sources.filter((s) => s.key === key);
  const usableExact = exact.filter((s) => isUsable(s.evidence.verification));
  if (usableExact.length)
    return result(
      req,
      "MATCHED",
      `Matches the stated requirement: ${skillName(key)} appears in your recorded facts.`,
      {
        relationship: "EXACT",
        evidence: strongest(usableExact.map((s) => s.evidence)),
      },
    );
  for (const alt of anyOf.filter((k) => k !== key)) {
    const hits = sources.filter((s) => s.key === alt && isUsable(s.evidence.verification));
    if (hits.length)
      return result(
        req,
        "MATCHED",
        `The job accepts alternatives (${anyOf.map(skillName).join(" or ")}); your facts show ${skillName(alt)}.`,
        {
          relationship: "EXACT",
          evidence: strongest(hits.map((s) => s.evidence)),
        },
      );
  }
  if (exact.length)
    return result(
      req,
      "UNVERIFIED",
      `${skillName(key)} appears only in facts that still need your review, so it does not count yet.`,
      {
        relationship: "EXACT",
        evidence: strongest(exact.map((s) => s.evidence)),
      },
    );
  const related = sources.filter(
    (s) => areRelatedSkills(s.key, key) && isUsable(s.evidence.verification),
  );
  if (related.length) {
    const names = [...new Set(related.map((s) => skillName(s.key)))].join(", ");
    return result(
      req,
      "RELATED",
      `Related, not identical: you have ${names}; the job asks for ${skillName(key)}.`,
      {
        relationship: "RELATED",
        evidence: strongest(related.map((s) => s.evidence)),
      },
    );
  }
  const c = ctx.candidate;
  if (c.skills.length === 0 && c.experiences.length === 0 && c.projects.length === 0)
    return result(
      req,
      "UNKNOWN",
      "No skills, experience or projects are recorded yet, so this cannot be assessed.",
      { relationship: "NONE" },
    );
  return result(
    req,
    "GAP",
    `No supporting candidate evidence is currently recorded for ${skillName(key)}${importanceNote(req)}.`,
    {
      relationship: "NONE",
    },
  );
}

// --- Experience -----------------------------------------------------------------------------

/** "Marketing, Business or a related field" → ["marketing", "business", "a related field"] (split BEFORE folding: folding drops commas). */
export function splitAlternatives(text: string): string[] {
  return text
    .split(/,|\/|;|\bor\b|\band\b|&/i)
    .map((t) => foldText(t))
    .filter(Boolean);
}

function domainTerms(domain: string | null): string[] {
  if (!domain) return [];
  return splitAlternatives(domain).filter((t) => t.length >= 4);
}

export function evaluateExperience(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const v = req.normalizedValue;
  if (typeof v.minYears !== "number")
    return result(
      req,
      "NOT_APPLICABLE",
      "Seniority wording in the job title — shown for information, not assessed.",
    );
  const minMonths = v.minYears * 12;
  const professional = v.professional === true;
  const domain = typeof v.domain === "string" ? v.domain : null;
  const terms = domainTerms(domain);
  const domainSkills = Array.isArray(v.domainSkills) ? (v.domainSkills as string[]) : [];
  const exps = ctx.candidate.experiences;
  if (exps.length === 0)
    return result(
      req,
      "UNKNOWN",
      "No work experience is recorded yet, so the stated experience requirement cannot be assessed.",
    );

  const relevant = exps.filter((e) => {
    if (professional && e.employmentType && !PROFESSIONAL_TYPES.has(e.employmentType)) return false;
    if (!terms.length && !domainSkills.length) return true;
    const text = foldText([e.title, e.description ?? "", ...e.responsibilities].join(" "));
    const keys = new Set([
      ...e.skillsUsed.map(skillCompareKey),
      ...findSkills([e.title, e.description ?? "", ...e.responsibilities].join(" ")).map(
        (s) => s.key,
      ),
    ]);
    return terms.some((t) => text.includes(t)) || domainSkills.some((k) => keys.has(k));
  });
  const dated = (list: typeof exps) =>
    list
      .map((e) => ({ e, p: rolePeriod(e, ctx.now) }))
      .filter((x): x is { e: (typeof exps)[number]; p: Period } => x.p !== null);
  const usable = dated(relevant.filter((e) => isUsable(e.verification)));
  const unusable = dated(relevant.filter((e) => !isUsable(e.verification)));
  const months = mergedMonths(usable.map((x) => x.p));
  const need = `${v.minYears}+ years${professional ? " of professional experience" : " of experience"}${domain ? ` (${domain})` : ""}`;
  const evidence = strongest(
    usable.map((x) =>
      ev(
        "experience",
        x.e,
        `Experience: ${x.e.title} — ${x.e.organization}`,
        `${x.e.startDate ?? "?"} → ${x.e.isCurrent ? "present" : (x.e.endDate ?? "?")}`,
      ),
    ),
    5,
  );
  if (usable.length === 0) {
    if (unusable.length)
      return result(
        req,
        "UNVERIFIED",
        `Relevant roles exist but still need your review, so they do not count yet. The job states ${need}.`,
        {
          evidence: strongest(
            unusable.map((x) =>
              ev("experience", x.e, `Experience: ${x.e.title} — ${x.e.organization}`),
            ),
            5,
          ),
        },
      );
    if (relevant.length && dated(relevant).length === 0)
      return result(
        req,
        "UNKNOWN",
        `Relevant roles are recorded without start/end dates, so their duration cannot be calculated. The job states ${need}.`,
      );
    return result(
      req,
      "GAP",
      `No relevant dated experience is recorded. The job states ${need}${importanceNote(req)}.`,
    );
  }
  const internship = usable.some((x) => x.e.employmentType === "INTERNSHIP")
    ? " Includes internship time."
    : "";
  const have = `About ${formatYears(months)} of relevant experience recorded (overlapping roles counted once).${internship}`;
  if (months >= minMonths)
    return result(req, "MATCHED", `${have} The job states ${need}.`, { evidence });
  if (months >= minMonths * 0.5)
    return result(req, "PARTIAL", `${have} Partially meets the stated ${need}.`, { evidence });
  return result(
    req,
    "GAP",
    `${have} Does not currently meet the stated ${need}${importanceNote(req)}.`,
    { evidence },
  );
}

// --- Education ------------------------------------------------------------------------------

const LEVEL_ORDER: Record<string, number> = {
  DIPLOMA: 1,
  ASSOCIATE: 2,
  ANY_DEGREE: 2,
  BACHELOR: 3,
  MASTER: 4,
  DOCTORATE: 5,
};
const LEVEL_NAME: Record<string, string> = {
  DIPLOMA: "diploma",
  ASSOCIATE: "associate degree",
  ANY_DEGREE: "degree",
  BACHELOR: "bachelor's degree",
  MASTER: "master's degree",
  DOCTORATE: "doctorate",
};

function fieldMatches(required: string, candidateText: string): boolean {
  const have = foldText(candidateText);
  return splitAlternatives(required)
    .filter((t) => t.length >= 3)
    .some((t) => have.includes(t));
}

export function evaluateEducation(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const v = req.normalizedValue;
  const needLevel = String(v.level ?? "ANY_DEGREE");
  const field = typeof v.field === "string" ? v.field : null;
  const rows = ctx.candidate.education;
  if (rows.length === 0)
    return result(
      req,
      "UNKNOWN",
      "No education is recorded yet, so this requirement cannot be assessed.",
    );
  const nowM = monthIndex(ctx.now);
  const graded = rows.map((e) => {
    const level = degreeLevel(`${e.degree ?? ""} ${e.fieldOfStudy ?? ""}`);
    const end = parseMonth(e.endDate);
    const completed =
      !e.isCurrent && (end === null ? Boolean(e.endDate === null && e.degree) : end <= nowM);
    return {
      e,
      level,
      completed,
      meetsLevel: level !== null && (LEVEL_ORDER[level] ?? 0) >= (LEVEL_ORDER[needLevel] ?? 2),
    };
  });
  const label = (e: (typeof rows)[number]) =>
    `Education: ${[e.degree, e.fieldOfStudy].filter(Boolean).join(", ") || "degree"} — ${e.institution}`;
  const usable = graded.filter((g) => isUsable(g.e.verification));
  const fieldOk = (g: (typeof graded)[number]) =>
    !field || fieldMatches(field, `${g.e.fieldOfStudy ?? ""} ${g.e.degree ?? ""}`);
  const done = usable.filter((g) => g.meetsLevel && g.completed);
  const need = `${LEVEL_NAME[needLevel] ?? "degree"}${field ? ` in ${field}` : ""}`;
  const best = done.find(fieldOk);
  if (best)
    return result(req, "MATCHED", `Matches the stated requirement (${need}).`, {
      evidence: [ev("education", best.e, label(best.e))],
    });
  if (done.length) {
    const g = done[0]!;
    const related = v.relatedFieldsAccepted
      ? " The job also accepts related fields — check whether yours counts."
      : "";
    return result(
      req,
      "PARTIAL",
      `Degree level matches, but the specified field (${field}) does not match your recorded field (${g.e.fieldOfStudy ?? "not recorded"}).${related}`,
      {
        evidence: [ev("education", g.e, label(g.e))],
      },
    );
  }
  const inProgress = usable.find((g) => g.meetsLevel && !g.completed);
  if (inProgress)
    return result(
      req,
      "PARTIAL",
      `Your ${LEVEL_NAME[inProgress.level!] ?? "degree"} is in progress, not completed. The job states ${need}.`,
      {
        evidence: [ev("education", inProgress.e, label(inProgress.e))],
      },
    );
  const pending = graded.filter((g) => !isUsable(g.e.verification) && g.meetsLevel);
  if (pending.length)
    return result(
      req,
      "UNVERIFIED",
      `A matching degree is recorded but still needs your review. The job states ${need}.`,
      {
        evidence: pending.map((g) => ev("education", g.e, label(g.e))),
      },
    );
  if (usable.every((g) => g.level === null))
    return result(
      req,
      "UNKNOWN",
      `Your education records do not state a degree level, so ${need} cannot be assessed.`,
    );
  const equivalent = v.equivalentExperienceAccepted
    ? " The job accepts equivalent experience instead."
    : "";
  return result(
    req,
    "GAP",
    `No completed ${need} is recorded${importanceNote(req)}.${equivalent}`,
    {
      evidence: usable.slice(0, 2).map((g) => ev("education", g.e, label(g.e))),
    },
  );
}

// --- Languages -------------------------------------------------------------------------------

const LANG_ORDER: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6, NATIVE: 7 };
const REQUIRED_LANG_LEVEL: Record<string, number> = {
  NATIVE: 7,
  C2: 6,
  C1: 5,
  FLUENT: 5,
  B2: 4,
  PROFESSIONAL: 4,
  PROFICIENT: 4,
  B1: 3,
};

export function evaluateLanguage(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const lang = String(req.normalizedValue.language ?? "");
  const levelName = req.normalizedValue.level ? String(req.normalizedValue.level) : null;
  const need = levelName ? (REQUIRED_LANG_LEVEL[levelName] ?? 1) : 1;
  const rows = ctx.candidate.languages.filter((l) => foldText(l.language) === foldText(lang));
  const label = (l: (typeof rows)[number]) =>
    `Language: ${l.language}${l.proficiency ? ` (${l.proficiency})` : ""}`;
  if (rows.length === 0)
    return result(
      req,
      "UNKNOWN",
      `No ${lang} proficiency is recorded, so this cannot be assessed (it is never inferred from country or education).`,
    );
  const usable = rows.filter((l) => isUsable(l.verification));
  if (usable.length === 0)
    return result(req, "UNVERIFIED", `${lang} is recorded but still needs your review.`, {
      evidence: rows.map((l) => ev("language", l, label(l))),
    });
  const levels = new Set(usable.map((l) => l.proficiency).filter(Boolean));
  if (levels.size > 1)
    return result(
      req,
      "CONFLICT",
      `Your records disagree about your ${lang} level (${[...levels].join(" vs ")}). Resolve this in your profile.`,
      {
        evidence: usable.map((l) => ev("language", l, label(l))),
      },
    );
  const l = usable[0]!;
  if (!l.proficiency)
    return result(
      req,
      "UNKNOWN",
      `${lang} is recorded without a level; the job asks for ${levelName?.toLowerCase() ?? "it"}.`,
      { evidence: [ev("language", l, label(l))] },
    );
  const have = LANG_ORDER[l.proficiency] ?? 0;
  const want = levelName ? `${levelName.toLowerCase()} ${lang}` : lang;
  if (have >= need)
    return result(req, "MATCHED", `Matches the stated requirement (${want}).`, {
      evidence: [ev("language", l, label(l))],
    });
  if (have === need - 1)
    return result(
      req,
      "PARTIAL",
      `Your recorded level (${l.proficiency}) is one step below the stated ${want}.`,
      { evidence: [ev("language", l, label(l))] },
    );
  return result(
    req,
    "GAP",
    `Your recorded level (${l.proficiency}) is below the stated ${want}${importanceNote(req)}.`,
    { evidence: [ev("language", l, label(l))] },
  );
}

// --- Certification & portfolio ---------------------------------------------------------------

export function evaluateCertification(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const name = String(req.normalizedValue.name ?? req.text);
  const core = foldText(
    name.replace(/\b(certifi(ed|cation|cations|cate)|professional|in|for|as)\b/gi, " "),
  );
  const wantSkills = Array.isArray(req.normalizedValue.skills)
    ? (req.normalizedValue.skills as string[])
    : [];
  const nowM = monthIndex(ctx.now);
  const hits = ctx.candidate.certifications.filter((c) => {
    const text = foldText(`${c.name} ${c.issuer ?? ""}`);
    const keys = findSkills(c.name).map((s) => s.key);
    return (core.length >= 3 && text.includes(core)) || wantSkills.some((k) => keys.includes(k));
  });
  const label = (c: (typeof hits)[number]) =>
    `Certification: ${c.name}${c.issuer ? ` (${c.issuer})` : ""}`;
  const usable = hits.filter((c) => isUsable(c.verification));
  const valid = usable.filter((c) => {
    const exp = parseMonth(c.expiryDate);
    return exp === null || exp >= nowM;
  });
  if (valid.length)
    return result(req, "MATCHED", `Matches the stated certification (${name}).`, {
      evidence: valid.map((c) => ev("certification", c, label(c))),
    });
  if (usable.length)
    return result(req, "PARTIAL", `A matching certification is recorded but has expired.`, {
      evidence: usable.map((c) => ev("certification", c, label(c))),
    });
  if (hits.length)
    return result(
      req,
      "UNVERIFIED",
      `A matching certification is recorded but still needs your review.`,
      { evidence: hits.map((c) => ev("certification", c, label(c))) },
    );
  return result(req, "GAP", `No ${name} is recorded${importanceNote(req)}.`);
}

export function evaluatePortfolio(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const c = ctx.candidate;
  const items = c.portfolio.filter((p) => isUsable(p.verification));
  const evidence = items.map((p) => ev("portfolio", p, `Portfolio: ${p.title}`, p.url));
  if (c.profile.portfolioUrl && isUsable(c.profile.verification))
    evidence.push(ev("profile", c.profile, "Profile: portfolio link", c.profile.portfolioUrl));
  if (evidence.length)
    return result(req, "MATCHED", "A portfolio is recorded in your profile.", {
      evidence: evidence.slice(0, 3),
    });
  if (c.portfolio.length)
    return result(req, "UNVERIFIED", "Portfolio items are recorded but still need your review.", {
      evidence: c.portfolio.map((p) => ev("portfolio", p, `Portfolio: ${p.title}`)),
    });
  return result(
    req,
    "GAP",
    `No portfolio is recorded (a GitHub or LinkedIn link is not treated as a portfolio)${importanceNote(req)}.`,
  );
}

// --- Work authorization ----------------------------------------------------------------------------

export function evaluateAuthorization(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const kind = String(req.normalizedValue.kind ?? "AUTHORIZATION_REQUIRED");
  if (kind === "SPONSORSHIP_AVAILABLE")
    return result(req, "NOT_APPLICABLE", "The job states that visa sponsorship is available.");
  const region = (req.normalizedValue.region as string | null) ?? ctx.jobCountryCode;
  const where = region === "EU" ? "the EU" : (region ?? "the job's country");
  if (!region)
    return result(req, "UNKNOWN", "The job does not state which country this applies to.");
  const inRegion = (cc: string) => (region === "EU" ? EU.has(cc) : cc === region);
  const records = ctx.candidate.authorizations.filter((a) => inRegion(a.countryCode));
  const usable = records.filter((a) => isUsable(a.verification));
  const label = (a: (typeof records)[number]) =>
    `Work authorization: ${a.countryCode} — ${a.status.toLowerCase().replaceAll("_", " ")}`;
  const statuses = new Set(usable.map((a) => a.status));
  if (statuses.size > 1)
    return result(
      req,
      "CONFLICT",
      `Your work authorization records for ${where} disagree (${[...statuses].join(" vs ")}). Resolve this in your profile.`,
      {
        evidence: usable.map((a) => ev("authorization", a, label(a))),
      },
    );
  const a = usable[0];
  const prefs = ctx.candidate.preferences;
  if (kind === "SPONSORSHIP_UNAVAILABLE") {
    if (a?.status === "AUTHORIZED")
      return result(
        req,
        "MATCHED",
        `You are recorded as authorized to work in ${where}, so sponsorship is not needed.`,
        { evidence: [ev("authorization", a, label(a))] },
      );
    if (a && (a.status === "SPONSORSHIP_REQUIRED" || a.status === "NOT_AUTHORIZED"))
      return result(
        req,
        "BLOCKED",
        `The job states visa sponsorship is not available, and you are recorded as needing sponsorship / not authorized for ${where}.`,
        {
          evidence: [ev("authorization", a, label(a))],
        },
      );
    if (!a && prefs?.needsSponsorship === "YES")
      return result(
        req,
        "BLOCKED",
        "The job states visa sponsorship is not available, and your preferences say you need sponsorship.",
        {
          evidence: [
            {
              ref: "preferences:needs_sponsorship",
              kind: "preferences",
              label: "Preference: needs sponsorship = yes",
              verification: "USER_PROVIDED",
            },
          ],
        },
      );
  } else {
    if (a?.status === "AUTHORIZED" && kind === "AUTHORIZATION_REQUIRED")
      return result(req, "MATCHED", `You are recorded as authorized to work in ${where}.`, {
        evidence: [ev("authorization", a, label(a))],
      });
    if (a?.status === "NOT_AUTHORIZED")
      return result(
        req,
        "BLOCKED",
        `The job requires authorization for ${where}, and you are recorded as not authorized there.`,
        { evidence: [ev("authorization", a, label(a))] },
      );
    if (a?.status === "SPONSORSHIP_REQUIRED")
      return result(
        req,
        "UNKNOWN",
        `You would need sponsorship for ${where}; the job does not say whether it sponsors.`,
        { evidence: [ev("authorization", a, label(a))] },
      );
    if (kind === "CITIZENSHIP_REQUIRED")
      return result(
        req,
        "UNKNOWN",
        `The job states a citizenship requirement for ${where}; citizenship is not recorded in your profile.`,
        {
          evidence: a ? [ev("authorization", a, label(a))] : [],
        },
      );
  }
  if (records.length && !usable.length)
    return result(
      req,
      "UNVERIFIED",
      `A work authorization record for ${where} exists but still needs your review.`,
      { evidence: records.map((r) => ev("authorization", r, label(r))) },
    );
  return result(
    req,
    "UNKNOWN",
    `No verified work authorization information for ${where} is stored for you.`,
  );
}

// --- Preferences: work mode, employment, location, salary ----------------------------------------

const MODE: Record<string, string> = { REMOTE: "remote", HYBRID: "hybrid", ONSITE: "on-site" };
const PREF_EVIDENCE = (label: string): EvidenceItem => ({
  ref: "preferences:job_preferences",
  kind: "preferences",
  label,
  verification: "USER_PROVIDED",
});

export function evaluateWorkMode(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const mode = String(req.normalizedValue.mode ?? "");
  const prefs = ctx.candidate.preferences?.workModes ?? [];
  if (!prefs.length) return result(req, "UNKNOWN", "No work-mode preference is recorded.");
  const evidence = [PREF_EVIDENCE(`Preference: ${prefs.map((m) => MODE[m] ?? m).join(" or ")}`)];
  if (prefs.includes(mode))
    return result(
      req,
      "MATCHED",
      `The job is ${MODE[mode] ?? mode}, which is one of your preferred work modes.`,
      { evidence },
    );
  if (ctx.settings.workModeHard)
    return result(
      req,
      "BLOCKED",
      `The job is ${MODE[mode] ?? mode}; you set your preferred work modes (${prefs.map((m) => MODE[m] ?? m).join(", ")}) as mandatory.`,
      { evidence },
    );
  return result(
    req,
    "GAP",
    `The job is ${MODE[mode] ?? mode}; you prefer ${prefs.map((m) => MODE[m] ?? m).join(" or ")}. This is a preference, not a blocker.`,
    {
      gapKind: "PREFERENCE",
      evidence,
    },
  );
}

const EMP: Record<string, string> = {
  FULL_TIME: "full time",
  PART_TIME: "part time",
  CONTRACT: "contract",
  TEMPORARY: "temporary",
  INTERNSHIP: "internship",
  APPRENTICESHIP: "apprenticeship",
  FREELANCE: "freelance",
};

export function evaluateEmployment(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const type = String(req.normalizedValue.type ?? "");
  const prefs = ctx.candidate.preferences?.employmentTypes ?? [];
  if (!prefs.length) return result(req, "UNKNOWN", "No employment-type preference is recorded.");
  const evidence = [
    PREF_EVIDENCE(`Preference: ${prefs.map((t) => EMP[t] ?? t.toLowerCase()).join(" or ")}`),
  ];
  if (prefs.includes(type))
    return result(
      req,
      "MATCHED",
      `The job is ${EMP[type] ?? type}, which matches your preferences.`,
      { evidence },
    );
  if (ctx.settings.employmentTypeHard)
    return result(
      req,
      "BLOCKED",
      `The job is ${EMP[type] ?? type}; you set your employment-type preferences as mandatory.`,
      { evidence },
    );
  return result(
    req,
    "GAP",
    `The job is ${EMP[type] ?? type}; you prefer ${prefs.map((t) => EMP[t] ?? t).join(" or ")}. Preference conflict, not a blocker.`,
    {
      gapKind: "PREFERENCE",
      evidence,
    },
  );
}

export function evaluateLocation(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const v = req.normalizedValue;
  const prefs = ctx.candidate.preferences;
  const relocation = prefs?.relocation ?? null;
  if (v.relocationRequired === true) {
    if (relocation === "YES" || relocation === "OPEN")
      return result(
        req,
        "MATCHED",
        "The job requires relocation; your preferences say you are open to relocating.",
        { evidence: [PREF_EVIDENCE(`Preference: relocation ${relocation.toLowerCase()}`)] },
      );
    if (relocation === "NO")
      return ctx.settings.locationHard
        ? result(
            req,
            "BLOCKED",
            "The job requires relocation; you do not want to relocate and set location as mandatory.",
            { evidence: [PREF_EVIDENCE("Preference: relocation no")] },
          )
        : result(
            req,
            "GAP",
            "The job requires relocation; your preferences say you do not want to relocate.",
            { gapKind: "PREFERENCE", evidence: [PREF_EVIDENCE("Preference: relocation no")] },
          );
    return result(
      req,
      "UNKNOWN",
      "The job requires relocation; your relocation preference is not recorded.",
    );
  }
  if (v.remote === true)
    return result(
      req,
      "NOT_APPLICABLE",
      `Remote job listed for ${v.countryCode ?? "an unstated country"}; the posting does not say whether remote work is limited to it.`,
    );
  const cc = (v.countryCode as string | null) ?? null;
  const city = (v.city as string | null) ?? null;
  if (!cc) return result(req, "UNKNOWN", "The job's country is not stated.");
  const c = ctx.candidate;
  const places: { countryCode: string; city: string | null; evidence: EvidenceItem }[] = [];
  if (c.profile.currentCountryCode && isUsable(c.profile.verification))
    places.push({
      countryCode: c.profile.currentCountryCode,
      city: c.profile.currentCity,
      evidence: ev(
        "profile",
        c.profile,
        `Current location: ${[c.profile.currentCity, c.profile.currentCountryCode].filter(Boolean).join(", ")}`,
      ),
    });
  for (const t of c.targetLocations)
    places.push({
      countryCode: t.countryCode,
      city: t.city,
      evidence: {
        ref: `target_location:${t.id}`,
        kind: "target_location",
        label: `Target location: ${[t.city, t.countryCode].filter(Boolean).join(", ")}`,
        verification: "USER_PROVIDED",
      },
    });
  if (!places.length)
    return result(req, "UNKNOWN", "Your current location and target locations are not recorded.");
  const inCountry = places.filter((p) => p.countryCode === cc);
  const exact = inCountry.filter((p) => !city || !p.city || foldText(p.city) === foldText(city));
  const where = [city, cc].filter(Boolean).join(", ");
  if (exact.length)
    return result(
      req,
      "MATCHED",
      `The job is in ${where}, which matches your current or target locations.`,
      { evidence: exact.map((p) => p.evidence).slice(0, 2) },
    );
  if (inCountry.length)
    return result(
      req,
      "PARTIAL",
      `The job is in ${where}; you are in / targeting ${cc} but not ${city}.`,
      { evidence: inCountry.map((p) => p.evidence).slice(0, 2) },
    );
  if (relocation === "YES" || relocation === "OPEN")
    return result(
      req,
      "PARTIAL",
      `The job is in ${where}, outside your current and target locations; you are open to relocating.`,
      { evidence: [PREF_EVIDENCE(`Preference: relocation ${relocation.toLowerCase()}`)] },
    );
  if (ctx.settings.locationHard)
    return result(
      req,
      "BLOCKED",
      `The job is in ${where}, outside your target locations, and you set location as mandatory.`,
      { evidence: places.map((p) => p.evidence).slice(0, 2) },
    );
  return result(req, "GAP", `The job is in ${where}, outside your current and target locations.`, {
    gapKind: "PREFERENCE",
    evidence: places.map((p) => p.evidence).slice(0, 2),
  });
}

const PER_YEAR: Record<string, number> = { YEAR: 1, MONTH: 12, WEEK: 52 };

export function evaluateSalary(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const v = req.normalizedValue;
  const prefs = ctx.candidate.preferences;
  if (!prefs?.salaryMin || !prefs.salaryCurrency)
    return result(req, "UNKNOWN", "Your minimum salary (with currency) is not recorded.");
  const cur = v.currency as string | null;
  if (!cur || cur !== prefs.salaryCurrency)
    return result(
      req,
      "UNKNOWN",
      `Salary compatibility unknown: the job pays in ${cur ?? "an unstated currency"}, your minimum is in ${prefs.salaryCurrency}. Currencies are never converted.`,
    );
  const jf = PER_YEAR[String(v.period ?? "")];
  const cf = PER_YEAR[prefs.salaryPeriod ?? "YEAR"];
  if (!jf || !cf)
    return result(
      req,
      "UNKNOWN",
      "Salary periods cannot be compared reliably (hourly pay is never converted to annual).",
    );
  const want = prefs.salaryMin * cf;
  const jobMax = typeof v.max === "number" ? v.max * jf : null;
  const jobMin = typeof v.min === "number" ? v.min * jf : null;
  const evidence = [
    PREF_EVIDENCE(
      `Preference: minimum ${prefs.salaryCurrency} ${prefs.salaryMin.toLocaleString("en")}${prefs.salaryPeriod ? ` / ${prefs.salaryPeriod.toLowerCase()}` : ""}`,
    ),
  ];
  if ((jobMax ?? jobMin)! >= want)
    return result(req, "MATCHED", "The stated salary range reaches your minimum.", { evidence });
  if (jobMax === null)
    return result(
      req,
      "UNKNOWN",
      "The job states only a minimum below yours; the top of the range is not stated.",
      { evidence },
    );
  if (ctx.settings.salaryMinHard)
    return result(
      req,
      "BLOCKED",
      "The job's stated maximum is below your minimum salary, which you set as mandatory.",
      { evidence },
    );
  return result(req, "GAP", "The job's stated maximum is below your minimum salary.", {
    gapKind: "PREFERENCE",
    evidence,
  });
}

// --- Domain & other ---------------------------------------------------------------------------

export function evaluateDomain(req: RequirementLike, ctx: EvalContext): RequirementResult {
  const term = foldText(String(req.normalizedValue.domain ?? ""));
  const c = ctx.candidate;
  const hits: EvidenceItem[] = [];
  for (const e of c.experiences) {
    const text = foldText(
      [e.title, e.organization, e.description ?? "", ...e.responsibilities].join(" "),
    );
    if (term && ` ${text} `.includes(` ${term} `))
      hits.push(ev("experience", e, `Experience: ${e.title} — ${e.organization}`, e.description));
  }
  for (const p of c.projects) {
    if (term && ` ${foldText(`${p.name} ${p.description ?? ""}`)} `.includes(` ${term} `))
      hits.push(ev("project", p, `Project: ${p.name}`, p.description));
  }
  const usable = hits.filter((h) => isUsable(h.verification));
  if (usable.length)
    return result(
      req,
      "MATCHED",
      `Your recorded experience mentions ${req.normalizedValue.domain}.`,
      { evidence: strongest(usable) },
    );
  if (hits.length)
    return result(
      req,
      "UNVERIFIED",
      `${req.normalizedValue.domain} appears only in facts that still need review.`,
      { evidence: strongest(hits) },
    );
  if (!c.experiences.length && !c.projects.length)
    return result(req, "UNKNOWN", "No experience or projects recorded yet.");
  return result(
    req,
    "GAP",
    `No recorded experience mentions ${req.normalizedValue.domain}${importanceNote(req)}.`,
  );
}

export function evaluateOther(req: RequirementLike): RequirementResult {
  return result(
    req,
    "UNKNOWN",
    `${req.text}: not recorded in your profile, so it cannot be assessed.`,
  );
}

/** Dispatch one requirement to its evaluator. */
export function evaluateRequirement(
  req: RequirementLike,
  ctx: EvalContext,
  sources: SkillSource[],
): RequirementResult {
  switch (req.category) {
    case "SKILL":
      return evaluateSkill(req, ctx, sources);
    case "EXPERIENCE":
      return evaluateExperience(req, ctx);
    case "EDUCATION":
      return evaluateEducation(req, ctx);
    case "LANGUAGE":
      return evaluateLanguage(req, ctx);
    case "CERTIFICATION":
      return evaluateCertification(req, ctx);
    case "PORTFOLIO":
      return evaluatePortfolio(req, ctx);
    case "AUTHORIZATION":
      return evaluateAuthorization(req, ctx);
    case "WORK_MODE":
      return evaluateWorkMode(req, ctx);
    case "EMPLOYMENT":
      return evaluateEmployment(req, ctx);
    case "LOCATION":
      return evaluateLocation(req, ctx);
    case "SALARY":
      return evaluateSalary(req, ctx);
    case "DOMAIN":
      return evaluateDomain(req, ctx);
    default:
      return evaluateOther(req);
  }
}
