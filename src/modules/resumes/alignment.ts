/**
 * Job requirement ↔ candidate evidence ↔ resume statement alignment (pure).
 *
 *   REQUIREMENT → candidate facts that support it → resume items that express it
 *
 * Statuses: MATCHED (evidence + expressed in the resume) · PARTIALLY_MATCHED (evidence exists
 * but the resume does not show it, or only a related skill is shown) · MISSING (no candidate
 * evidence) · UNSUPPORTED (the resume states it but no usable fact supports it) ·
 * NOT_RELEVANT (logistics such as salary, location, work mode — not resume content).
 * A missing keyword is reported, NEVER added to the resume.
 */
import {
  areRelatedSkills,
  findSkills,
  skillByKey,
  skillCompareKey,
} from "@/modules/matching/skills";
import { foldText, termRegex } from "@/modules/search-profiles/criteria";
import { documentText, visibleSections, type ResumeDocument } from "./document";

export interface AlignRequirement {
  id: string;
  category: string;
  requirementType: string;
  text: string;
  normalizedValue: Record<string, unknown>;
}

export interface AlignFact {
  ref: string;
  kind: string;
  value: Record<string, unknown>;
}

export type AlignmentStatus =
  "MATCHED" | "PARTIALLY_MATCHED" | "MISSING" | "UNSUPPORTED" | "NOT_RELEVANT";

export interface RequirementAlignment {
  requirementId: string;
  category: string;
  requirementType: string;
  text: string;
  status: AlignmentStatus;
  /** Usable candidate facts that support the requirement */
  factRefs: string[];
  /** Visible resume items whose text expresses it */
  itemIds: string[];
  note: string;
}

const LOGISTICS = new Set(["LOCATION", "WORK_MODE", "EMPLOYMENT", "SALARY", "AUTHORIZATION"]);

/** All text of a fact, for evidence search. */
export function factText(f: AlignFact): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  for (const [k, v] of Object.entries(f.value)) {
    if (/url|id$|Id$|date|Date|type$|Type$/.test(k) && !/skills|technologies/i.test(k)) continue;
    walk(v);
  }
  return out.join(" \n ");
}

interface ResumeItemText {
  id: string;
  text: string;
  factRefs: string[];
}

/** Visible resume items with their printed text (bullets separately). */
export function resumeItems(doc: ResumeDocument): ResumeItemText[] {
  const vis = new Set(visibleSections(doc));
  const items: ResumeItemText[] = [];
  if (vis.has("summary") && doc.summary && !doc.summary.hidden)
    items.push({ id: doc.summary.id, text: doc.summary.text, factRefs: doc.summary.factRefs });
  if (vis.has("experience"))
    for (const e of doc.experience.filter((x) => !x.hidden)) {
      items.push({
        id: e.id,
        text: [e.title, e.organization, e.description ?? "", e.technologies.join(", ")].join(
          " \n ",
        ),
        factRefs: e.factRefs,
      });
      for (const b of e.bullets.filter((x) => !x.hidden))
        items.push({ id: b.id, text: b.text, factRefs: b.factRefs });
    }
  if (vis.has("projects"))
    for (const p of doc.projects.filter((x) => !x.hidden)) {
      items.push({
        id: p.id,
        text: [p.name, p.role ?? "", p.description ?? "", p.technologies.join(", ")].join(" \n "),
        factRefs: p.factRefs,
      });
      for (const b of p.bullets.filter((x) => !x.hidden))
        items.push({ id: b.id, text: b.text, factRefs: b.factRefs });
    }
  if (vis.has("education"))
    for (const e of doc.education.filter((x) => !x.hidden))
      items.push({
        id: e.id,
        text: [e.institution, e.degree ?? "", e.fieldOfStudy ?? "", e.details ?? ""].join(" \n "),
        factRefs: e.factRefs,
      });
  if (vis.has("skills"))
    for (const g of doc.skills.filter((x) => !x.hidden))
      for (const s of g.skills.filter((x) => !x.hidden))
        items.push({ id: s.id, text: s.name, factRefs: s.factRefs });
  if (vis.has("certifications"))
    for (const c of doc.certifications.filter((x) => !x.hidden))
      items.push({ id: c.id, text: [c.name, c.issuer ?? ""].join(" \n "), factRefs: c.factRefs });
  if (vis.has("languages"))
    for (const l of doc.languages.filter((x) => !x.hidden))
      items.push({
        id: l.id,
        text: [l.language, l.proficiency ?? ""].join(" "),
        factRefs: l.factRefs,
      });
  if (vis.has("additional"))
    for (const a of doc.additional.filter((x) => !x.hidden))
      for (const b of a.bullets.filter((x) => !x.hidden))
        items.push({ id: b.id, text: b.text, factRefs: b.factRefs });
  return items;
}

/** Terms that identify a requirement in text: the lexicon spellings for skills, else its own wording. */
export function requirementTerms(r: AlignRequirement): {
  skillKey: string | null;
  terms: string[];
} {
  const skillKey = typeof r.normalizedValue.skill === "string" ? r.normalizedValue.skill : null;
  if (skillKey) {
    const def = skillByKey(skillKey);
    return {
      skillKey,
      terms: def ? [def.name, ...(def.aliases ?? []), ...(def.nameOnly ?? [])] : [r.text],
    };
  }
  const v = r.normalizedValue;
  const named = [v.name, v.certification, v.language, v.domain, v.field].filter(
    (x): x is string => typeof x === "string" && x.length > 1,
  );
  return { skillKey: null, terms: named.length ? named : [r.text] };
}

function mentions(text: string, skillKey: string | null, terms: string[]): boolean {
  if (skillKey) {
    if (findSkills(text).some((s) => s.key === skillKey)) return true;
  }
  const folded = ` ${foldText(text)} `;
  return terms.some((t) => {
    const re = termRegex(t);
    return re ? re.test(folded) : false;
  });
}

function relatedMention(text: string, skillKey: string | null): boolean {
  if (!skillKey) return false;
  return findSkills(text).some((s) => areRelatedSkills(s.key, skillKey));
}

export function alignRequirements(
  requirements: AlignRequirement[],
  facts: AlignFact[],
  doc: ResumeDocument,
): RequirementAlignment[] {
  const items = resumeItems(doc);
  const factTexts = facts.map((f) => ({ ref: f.ref, text: factText(f) }));
  const usableRefs = new Set(facts.map((f) => f.ref));

  return requirements.map((r) => {
    const base = {
      requirementId: r.id,
      category: r.category,
      requirementType: r.requirementType,
      text: r.text,
    };
    if (LOGISTICS.has(r.category)) {
      return {
        ...base,
        status: "NOT_RELEVANT" as const,
        factRefs: [],
        itemIds: [],
        note: "Job logistics (checked by matching), not resume content.",
      };
    }
    const { skillKey, terms } = requirementTerms(r);
    const factRefs = factTexts.filter((f) => mentions(f.text, skillKey, terms)).map((f) => f.ref);
    const expressed = items.filter((i) => mentions(i.text, skillKey, terms));
    const itemIds = expressed.map((i) => i.id);
    // An expressing item is grounded when it cites a usable fact (or the text itself is found in facts).
    const grounded =
      expressed.some((i) => i.factRefs.some((ref) => usableRefs.has(ref))) || factRefs.length > 0;

    if (expressed.length && factRefs.length)
      return {
        ...base,
        status: "MATCHED" as const,
        factRefs,
        itemIds,
        note: "Supported by your facts and shown in the resume.",
      };
    if (expressed.length && !grounded) {
      return {
        ...base,
        status: "UNSUPPORTED" as const,
        factRefs: [],
        itemIds,
        note: "The resume mentions this, but no verified candidate fact supports it.",
      };
    }
    if (expressed.length)
      return {
        ...base,
        status: "MATCHED" as const,
        factRefs,
        itemIds,
        note: "Shown in the resume by an item that cites your facts.",
      };
    if (factRefs.length)
      return {
        ...base,
        status: "PARTIALLY_MATCHED" as const,
        factRefs,
        itemIds: [],
        note: "Your facts support this, but the resume does not show it yet.",
      };
    const relatedItems = items.filter((i) => relatedMention(i.text, skillKey)).map((i) => i.id);
    if (relatedItems.length)
      return {
        ...base,
        status: "PARTIALLY_MATCHED" as const,
        factRefs: [],
        itemIds: relatedItems,
        note: "Only a related skill appears; the exact requirement is not evidenced.",
      };
    return {
      ...base,
      status: "MISSING" as const,
      factRefs: [],
      itemIds: [],
      note: "Not present in your verified candidate profile — it will not be added.",
    };
  });
}

export type KeywordStatus =
  "MATCHED" | "PARTIALLY_MATCHED" | "MISSING" | "NOT_RELEVANT" | "UNSUPPORTED";

export interface KeywordResult {
  keyword: string;
  skillKey: string | null;
  source: "requirement" | "description" | "title";
  requirementType: string | null;
  status: KeywordStatus;
  inResume: boolean;
  inFacts: boolean;
}

/**
 * Keyword analysis: skills/tools/terms from the job (requirements first, then known skills in the
 * title and description) compared with the resume text and the candidate's usable facts.
 */
export function analyzeKeywords(
  job: { title: string; description: string },
  requirements: AlignRequirement[],
  facts: AlignFact[],
  doc: ResumeDocument,
): KeywordResult[] {
  const resumeText = documentText(doc);
  const factCorpus = facts.map(factText).join(" \n ");
  const results = new Map<string, KeywordResult>();
  const add = (
    keyword: string,
    skillKey: string | null,
    source: KeywordResult["source"],
    requirementType: string | null,
    terms: string[],
  ) => {
    const key = skillKey ?? `t:${foldText(keyword)}`;
    if (results.has(key)) return;
    const inResume = mentions(resumeText, skillKey, terms);
    const inFacts = mentions(factCorpus, skillKey, terms);
    const status: KeywordStatus =
      inResume && inFacts
        ? "MATCHED"
        : inResume
          ? "UNSUPPORTED"
          : inFacts
            ? "PARTIALLY_MATCHED"
            : relatedMention(resumeText, skillKey)
              ? "PARTIALLY_MATCHED"
              : "MISSING";
    results.set(key, { keyword, skillKey, source, requirementType, status, inResume, inFacts });
  };
  for (const r of requirements) {
    if (LOGISTICS.has(r.category)) continue;
    if (!["SKILL", "CERTIFICATION", "DOMAIN", "LANGUAGE", "PORTFOLIO"].includes(r.category))
      continue;
    const { skillKey, terms } = requirementTerms(r);
    add(
      skillKey ? (skillByKey(skillKey)?.name ?? r.text) : r.text,
      skillKey,
      "requirement",
      r.requirementType,
      terms,
    );
  }
  for (const s of findSkills(job.title))
    add(skillByKey(s.key)?.name ?? s.matched, s.key, "title", null, [s.matched]);
  for (const s of findSkills(job.description))
    add(skillByKey(s.key)?.name ?? s.matched, s.key, "description", null, [s.matched]);
  return [...results.values()];
}

// --- Relevance (deterministic, explainable) ------------------------------------------

export interface RelevanceInput {
  id: string;
  text: string;
  endDate: string | null;
  isCurrent: boolean;
}

export interface Relevance {
  id: string;
  score: number;
  requirementIds: string[];
  requiredHits: number;
  preferredHits: number;
  reason: string;
}

/** Scores items by overlap with required (3) / preferred (1) requirements plus a small recency bonus. */
export function scoreRelevance(
  items: RelevanceInput[],
  requirements: AlignRequirement[],
  now = new Date(),
): Relevance[] {
  const content = requirements.filter((r) => !LOGISTICS.has(r.category));
  return items.map((item) => {
    const hits = content.filter((r) => {
      const { skillKey, terms } = requirementTerms(r);
      return mentions(item.text, skillKey, terms);
    });
    const requiredHits = hits.filter((h) => h.requirementType === "REQUIRED").length;
    const preferredHits = hits.length - requiredHits;
    const year = item.isCurrent ? now.getFullYear() : Number((item.endDate ?? "0").slice(0, 4));
    const recency = year ? Math.max(0, 3 - Math.max(0, now.getFullYear() - year)) * 0.5 : 0;
    const score = requiredHits * 3 + preferredHits + recency;
    const reason = hits.length
      ? `Overlaps with ${hits.length} target job requirement${hits.length === 1 ? "" : "s"} (${hits
          .slice(0, 4)
          .map((h) => h.text)
          .join(", ")}${hits.length > 4 ? ", …" : ""})${item.isCurrent ? " and is current" : ""}.`
      : item.isCurrent
        ? "Current role or project; no direct overlap with the job's stated requirements."
        : "No direct overlap with the job's stated requirements.";
    return {
      id: item.id,
      score,
      requirementIds: hits.map((h) => h.id),
      requiredHits,
      preferredHits,
      reason,
    };
  });
}

export { skillCompareKey };
