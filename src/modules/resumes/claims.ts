/**
 * Factual claim validator (deterministic). A proposed resume statement is compared with the
 * text of the candidate facts it cites (plus the original wording it rewrites):
 *
 *   SUPPORTED            every number, known skill/tool, leadership claim and named entity is
 *                        found in the supporting facts, and most content words overlap
 *   PARTIALLY_SUPPORTED  grounded facts exist but wording drifts (low overlap or unknown names)
 *                        → needs review / safer wording, never auto-accepted into a final resume
 *   UNSUPPORTED          invented metric, skill, leadership/seniority or no usable support
 *                        → rejected
 *   UNKNOWN              nothing to compare against (no cited facts)
 */
import { findSkills, skillByKey } from "@/modules/matching/skills";
import { foldText } from "@/modules/search-profiles/criteria";
import type { ClaimStatus } from "./document";

export interface ClaimCheck {
  status: ClaimStatus;
  reasons: string[];
  /** Offending fragments (numbers, skills, names) */
  unsupported: string[];
  overlap: number;
}

const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were with within across over under via using used use per our your my we i you they he she them his her very more most also both each such than then".split(
    " ",
  ),
);
/** Verbs/adjectives a rewrite may add without creating a new factual claim. */
const NEUTRAL = new Set(
  "created built developed designed delivered supported worked produced prepared implemented maintained improved organized organised coordinated handled contributed completed wrote documented analyzed analysed researched planned tracked reviewed assisted collaborated communicated presented executed ran set up setup launched shipped drafted edited updated tested configured automated streamlined content multiple several various client clients campaign campaigns project projects team teams work tasks responsible responsibilities including include includes related relevant key core end daily weekly monthly clear clearer".split(
    " ",
  ),
);
/** "lead" alone is not leadership ("lead routing", "lead generation"). */
const LEADERSHIP =
  /\b(led|leading (?:a|the)\b|headed|head of|directed|supervised|supervising|managed a team|managing a team|mentored|mentoring|oversaw|overseeing|spearheaded|chief|principal|senior|team lead|manager of)\b/i;
const LEADERSHIP_SUPPORT =
  /\b(led|leading (?:a|the)\b|team lead|head of|headed|directed|director|supervis\w*|managed (?:a )?team|managing (?:a )?team|manager|mentor\w*|oversaw|oversee\w*|founder|co-?founder|owner|captain|president|coordinator)\b/i;
/** Metrics: numbers with optional unit/currency, percentages, multipliers, "10k", "1.5M". */
const NUMBER =
  /(?:[$€£₹]\s?)?\d[\d,.]*\s?(?:%|percent|x\b|k\b|m\b|mn\b|million|billion|lakh|lakhs|crore|crores|\+)?/gi;

function normNumber(s: string) {
  return s
    .toLowerCase()
    .replace(/[\s,$€£₹]/g, "")
    .replace(/percent/, "%");
}

function contentWords(text: string): string[] {
  return foldText(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP.has(w) && !NEUTRAL.has(w) && !/^\d/.test(w));
}

function stem(w: string) {
  return w.replace(/(ing|ed|es|s|ly)$/, "");
}

/** Capitalised tokens that are not sentence-initial (candidate named entities). */
function namedTokens(text: string): string[] {
  const out: string[] = [];
  const sentences = text.split(/(?<=[.!?;:])\s+|\n+/);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^\p{L}\d]+|[^\p{L}\d.+#]+$/gu, "");
      if (
        i > 0 &&
        /^\p{Lu}[\p{L}\d.+#&-]{1,}$/u.test(clean) &&
        !/^(I|A|An|The|And|For|With|To|Of|In|On|At|By)$/.test(clean)
      )
        out.push(clean);
    });
  }
  return out;
}

export function validateClaim(
  proposed: string,
  support: { texts: string[]; original?: string | null },
): ClaimCheck {
  const corpus = [...support.texts, support.original ?? ""].join(" \n ");
  if (!support.texts.length || !corpus.trim()) {
    return {
      status: "UNKNOWN",
      reasons: ["No candidate fact is cited for this statement."],
      unsupported: [],
      overlap: 0,
    };
  }
  const reasons: string[] = [];
  const unsupported: string[] = [];
  let hard = false;
  let soft = false;

  // 1. Metrics: every number in the proposal must exist in the supporting facts.
  const corpusNumbers = new Set(
    (corpus.match(NUMBER) ?? [])
      .map(normNumber)
      .map((n) => n.replace(/[%x+kmn]|million|billion|lakhs?|crores?/g, "")),
  );
  for (const raw of proposed.match(NUMBER) ?? []) {
    const n = normNumber(raw).replace(/[%x+kmn]|million|billion|lakhs?|crores?/g, "");
    if (!n || (/^\d{4}$/.test(n) && corpus.includes(n))) continue;
    if (!corpusNumbers.has(n)) {
      hard = true;
      unsupported.push(raw.trim());
    }
  }
  if (unsupported.length)
    reasons.push(`Numbers not found in your facts: ${unsupported.join(", ")}.`);

  // 2. Skills / tools: every known skill in the proposal must appear in the supporting facts.
  const supportSkills = new Set(findSkills(corpus).map((s) => s.key));
  const newSkills = findSkills(proposed).filter((s) => !supportSkills.has(s.key));
  if (newSkills.length) {
    hard = true;
    const names = newSkills.map((s) => skillByKey(s.key)?.name ?? s.matched);
    unsupported.push(...names);
    reasons.push(`Skills/tools not in your facts: ${names.join(", ")}.`);
  }

  // 3. Leadership / seniority must be grounded.
  if (LEADERSHIP.test(proposed) && !LEADERSHIP_SUPPORT.test(corpus)) {
    hard = true;
    unsupported.push(proposed.match(LEADERSHIP)![0]);
    reasons.push("Leadership or seniority wording is not supported by your facts.");
  }

  // 4. Named entities (companies, products, clients) must appear in the support.
  const foldedCorpus = ` ${foldText(corpus)} `;
  const unknownNames = namedTokens(proposed).filter(
    (n) => !foldedCorpus.includes(` ${foldText(n)} `) && !findSkills(n).length,
  );
  if (unknownNames.length) {
    soft = true;
    unsupported.push(...unknownNames);
    reasons.push(`Names not found in your facts: ${[...new Set(unknownNames)].join(", ")}.`);
  }

  // 5. Content overlap: most meaningful words should come from the facts.
  const words = contentWords(proposed);
  const supportStems = new Set(contentWords(corpus).map(stem));
  const overlap = words.length
    ? words.filter((w) => supportStems.has(stem(w))).length / words.length
    : 1;
  if (overlap < 0.5) {
    soft = true;
    reasons.push(
      `Only ${Math.round(overlap * 100)}% of the meaningful wording comes from your facts.`,
    );
  }

  const status: ClaimStatus = hard ? "UNSUPPORTED" : soft ? "PARTIALLY_SUPPORTED" : "SUPPORTED";
  if (status === "SUPPORTED") reasons.push("Every number, skill and name is found in your facts.");
  return {
    status,
    reasons,
    unsupported: [...new Set(unsupported)],
    overlap: Math.round(overlap * 100) / 100,
  };
}
