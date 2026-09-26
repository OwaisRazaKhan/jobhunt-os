/**
 * Communication claim auditor (deterministic). Every body sentence of an email / cover letter is
 * inspected; sentences that state something checkable become claims:
 *
 *   CANDIDATE     first-person statements about the candidate → must be grounded in candidate
 *                 facts (numbers, skills/tools, leadership, names all found in the facts)
 *   COMPANY       statements about the company/team/product → must be backed by a verified
 *                 research claim (or, for role statements, by the job posting itself)
 *   USER_CONTEXT  statements that come from the context the user typed (not externally verified)
 *
 * Model-declared claims (with cited fact refs / research claim ids) are used as hints only: the
 * cited evidence is re-checked here, invalid references are ignored, and undeclared sentences are
 * audited against all evidence. The model's own "SUPPORTED" label is never trusted.
 */
import { findSkills, skillByKey } from "@/modules/matching/skills";
import { foldText } from "@/modules/search-profiles/criteria";
import { paragraphsOf, type CommunicationDocument } from "./document";
import type { ClaimKind, ClaimStatus } from "./types";

export interface EvidenceCorpus {
  /** Usable candidate facts (VERIFIED / USER_PROVIDED) and, for approved resumes, the resume text */
  facts: { ref: string; kind: string; text: string }[];
  /** Verified research claims with their source */
  research: { id: string; text: string; sourceUrl: string | null; sourceTitle: string | null }[];
  job: { title: string | null; company: string | null; text: string };
  userContext: string | null;
  candidateName: string | null;
  recipient: { name: string | null; title: string | null; company: string | null };
}

export interface DeclaredClaim {
  text: string;
  factRefs: string[];
  researchClaimIds: string[];
  usesUserContext?: boolean;
  status?: ClaimStatus;
}

export interface AuditedClaim {
  location: string;
  text: string;
  claimKind: ClaimKind;
  status: ClaimStatus;
  reasons: string[];
  factRefs: string[];
  researchClaimIds: string[];
  userContext: boolean;
  /** How support was established */
  basis: "CITED" | "DETECTED" | "JOB_POSTING" | "USER_CONTEXT" | "NONE";
  unsupported: string[];
}

const NUMBER =
  /(?:[$€£₹]\s?)?\d[\d,.]*\s?(?:%|percent|x\b|k\b|m\b|mn\b|million|billion|lakh|lakhs|crore|crores|\+)?/gi;
const LEADERSHIP =
  /\b(led|leading (?:a|the)\b|headed|head of|directed|supervised|supervising|managed a team|managing a team|mentored|mentoring|oversaw|overseeing|spearheaded|team lead|manager of)\b/i;
const LEADERSHIP_SUPPORT =
  /\b(led|leading (?:a|the)\b|team lead|head of|headed|directed|director|supervis\w*|managed (?:a )?team|managing (?:a )?team|manager|mentor\w*|oversaw|oversee\w*|founder|co-?founder|owner|captain|president|coordinator)\b/i;
const FIRST_PERSON = /\b(i|i'm|i’m|i've|i’ve|i'd|i’d|i'll|my|me|mine|myself)\b/i;
const COMPANY_REF =
  /\b(your|you're|you’re) (company|team|teams|organi[sz]ation|organi[sz]ations|product|products|platform|mission|work|approach|customers|users|growth|expansion|recent|focus|culture|values|research|models?|engineering|roadmap)\b/i;
const ROLE_REF = /\b(the|this) (role|team|position|company|product|platform|job|department)\b/i;
const COMPANY_FACT_VERB =
  /\b(recently|announced|launched|raised|funding|expan\w*|acquired|founded|headquartered|partnered|released|introduced|won|award\w*|leader in|market|customers|users|revenue|valuation|series [a-z])\b/i;
const STOP = new Set(
  "a an and are as at be by for from has have in into is it its of on or that the their this to was were with within across over under via using used use per our your my we i you they he she them his her very more most also both each such than then which who whom whose what when where why how would could should will can may might must am being been do does did done not no so if about just only really".split(
    " ",
  ),
);
/** Words that carry no factual content in a letter (tone, intent, generic nouns). */
const GENERIC = new Set(
  "role position opportunity opportunities write writing reaching out apply applying application applications interest interested interesting excited keen eager glad happy pleased hope hoping look looking forward welcome chance discuss discussion conversation talk speak contribute contributing contribution join joining team teams work working company organisation organization candidate experience experienced skills skill background thank thanks consider consideration attached resume attach available time regards sincerely best kind dear hello hi please reach contact learn learning grow growing help helping bring bringing believe think feel make making strong good great well value values valuable relevant relevance fit fits suited suit particular particularly especially specifically directly closely current currently recent recently today year years month months week weeks day days next first new part parts way ways thing things".split(
    " ",
  ),
);
const NEUTRAL_VERBS = new Set(
  "created built developed designed delivered supported worked produced prepared implemented maintained improved organized organised coordinated handled contributed completed wrote documented analyzed analysed researched planned tracked reviewed assisted collaborated communicated presented executed ran launched shipped drafted edited updated tested configured automated streamlined".split(
    " ",
  ),
);
const ALLOWED_NAMES = new Set(
  "i dear hi hello hiring manager team recruiter recruiters hr kind regards best sincerely thank thanks linkedin github resume cv january february march april may june july august september october november december monday tuesday wednesday thursday friday english".split(
    " ",
  ),
);

export function splitSentences(paragraph: string): string[] {
  return paragraph
    .split(/\n+|(?<=[.!?])\s+(?=[\p{Lu}"“(\d])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normNumber(s: string) {
  return s
    .toLowerCase()
    .replace(/[\s,$€£₹]/g, "")
    .replace(/percent/, "%")
    .replace(/[%x+kmn]|million|billion|lakhs?|crores?/g, "")
    .replace(/\.$/, "");
}

const stem = (w: string) => w.replace(/(ing|ed|es|s|ly)$/, "");

function contentWords(text: string): string[] {
  return foldText(text)
    .split(" ")
    .map((w) => w.replace(/\.+$/, ""))
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w));
}

function namedTokens(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?;:])\s+|\n+/)) {
    const words = sentence.split(/\s+/).filter(Boolean);
    words.forEach((w, i) => {
      const clean = w
        .replace(/[’']s$/u, "")
        .replace(/^[^\p{L}\d]+|[^\p{L}\d.+#]+$/gu, "")
        .replace(/\.+$/, "");
      if (
        i > 0 &&
        /^\p{Lu}[\p{L}\d.+#&-]{1,}$/u.test(clean) &&
        !/^(I|A|An|The|And|For|With|To|Of|In|On|At|By|My|Your|This|That|It)$/.test(clean)
      )
        out.push(clean);
    });
  }
  return out;
}

interface MarkerCheck {
  hard: string[];
  soft: string[];
  reasons: string[];
}

/** Numbers, skills/tools, leadership and names in `sentence` must appear in `support`. */
function checkMarkers(sentence: string, support: string, allowNames: Set<string>): MarkerCheck {
  const hard: string[] = [];
  const soft: string[] = [];
  const reasons: string[] = [];
  const supportNumbers = new Set((support.match(NUMBER) ?? []).map(normNumber));
  const badNumbers = (sentence.match(NUMBER) ?? [])
    .map((raw) => raw.trim())
    .filter((raw) => {
      const n = normNumber(raw);
      return n && !supportNumbers.has(n);
    });
  if (badNumbers.length) {
    hard.push(...badNumbers);
    reasons.push(`Numbers not found in the evidence: ${badNumbers.join(", ")}.`);
  }
  const supportSkills = new Set(findSkills(support).map((s) => s.key));
  const newSkills = findSkills(sentence).filter((s) => !supportSkills.has(s.key));
  if (newSkills.length) {
    const names = newSkills.map((s) => skillByKey(s.key)?.name ?? s.matched);
    hard.push(...names);
    reasons.push(`Skills/tools not in the evidence: ${names.join(", ")}.`);
  }
  if (LEADERSHIP.test(sentence) && !LEADERSHIP_SUPPORT.test(support)) {
    hard.push(sentence.match(LEADERSHIP)![0]);
    reasons.push("Leadership or seniority wording is not supported by the evidence.");
  }
  const folded = ` ${foldText(support).replace(/\.+(?=\s|$)/g, "")} `;
  const names = [
    ...new Set(
      namedTokens(sentence).filter(
        (n) =>
          !allowNames.has(foldText(n)) &&
          !folded.includes(` ${foldText(n)} `) &&
          !findSkills(n).length,
      ),
    ),
  ];
  if (names.length) {
    soft.push(...names);
    reasons.push(`Names not found in the evidence: ${names.join(", ")}.`);
  }
  return { hard, soft, reasons };
}

/** Checkable content: numbers, skills, leadership, or names other than the role/company/people. */
function hasMarkers(sentence: string, allow: Set<string>): boolean {
  return (
    (sentence.match(NUMBER) ?? []).length > 0 ||
    findSkills(sentence).length > 0 ||
    LEADERSHIP.test(sentence) ||
    namedTokens(sentence).some((n) => !allow.has(foldText(n)))
  );
}

/** Statements about the message itself (resume availability) are not factual claims. */
const META =
  /\b(my )?(resume|cv)\b[^.]*\b(is |are )?(available|associated|accompan\w*|on request|linked)\b/i;

function similarity(a: string, b: string): number {
  const wa = new Set(contentWords(a).map(stem));
  const wb = new Set(contentWords(b).map(stem));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

function coverage(words: string[], support: string): number {
  if (!words.length) return 1;
  const supportStems = new Set(contentWords(support).map(stem));
  return words.filter((w) => supportStems.has(stem(w))).length / words.length;
}

function allowedNames(corpus: EvidenceCorpus): Set<string> {
  const out = new Set(ALLOWED_NAMES);
  const add = (v: string | null | undefined) => {
    for (const w of foldText(v).split(" ")) if (w) out.add(w.replace(/\.+$/, ""));
  };
  add(corpus.job.title);
  add(corpus.job.company);
  add(corpus.candidateName);
  add(corpus.recipient.name);
  add(corpus.recipient.title);
  add(corpus.recipient.company);
  return out;
}

/** Content words describing the company that are not role/company-name/generic/candidate words. */
function companyContent(sentence: string, corpus: EvidenceCorpus, candidateText: string): string[] {
  const exclude = new Set(
    contentWords(`${corpus.job.title ?? ""} ${corpus.job.company ?? ""}`).map(stem),
  );
  const candidate = new Set(contentWords(candidateText).map(stem));
  return contentWords(sentence).filter((w) => {
    const s = stem(w);
    return (
      !GENERIC.has(w) &&
      !GENERIC.has(s) &&
      !NEUTRAL_VERBS.has(w) &&
      !exclude.has(s) &&
      !candidate.has(s)
    );
  });
}

function mentionsCompany(sentence: string, corpus: EvidenceCorpus): boolean {
  if (COMPANY_REF.test(sentence)) return true;
  const company = foldText(corpus.job.company);
  return Boolean(company) && ` ${foldText(sentence)} `.includes(` ${company} `);
}

function matchDeclared(sentence: string, declared: DeclaredClaim[]): DeclaredClaim | null {
  let best: DeclaredClaim | null = null;
  let bestScore = 0;
  const s = foldText(sentence);
  for (const d of declared) {
    const t = foldText(d.text);
    const score = s.includes(t) || t.includes(s) ? 1 : similarity(sentence, d.text);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return bestScore >= 0.75 ? best : null;
}

/** Audits one sentence. Returns null when the sentence states nothing checkable. */
export function auditSentence(
  sentence: string,
  location: string,
  corpus: EvidenceCorpus,
  declared: DeclaredClaim[] = [],
): AuditedClaim | null {
  const names = allowedNames(corpus);
  const factByRef = new Map(corpus.facts.map((f) => [f.ref, f]));
  const researchById = new Map(corpus.research.map((r) => [r.id, r]));
  const allFacts = [corpus.candidateName ?? "", ...corpus.facts.map((f) => f.text)].join(" \n ");
  const allResearch = corpus.research.map((r) => r.text).join(" \n ");
  const hint = matchDeclared(sentence, declared);
  const citedFacts = (hint?.factRefs ?? []).filter((r) => factByRef.has(r));
  const citedResearch = (hint?.researchClaimIds ?? []).filter((r) => researchById.has(r));
  const base = {
    location,
    text: sentence.slice(0, 2000),
    factRefs: [] as string[],
    researchClaimIds: [] as string[],
    userContext: false,
  };

  // 1. Company statements need a research source (or the job posting for role statements).
  if (mentionsCompany(sentence, corpus)) {
    const words = companyContent(sentence, corpus, allFacts);
    if (words.length) {
      const pool = citedResearch.length
        ? citedResearch.map((id) => researchById.get(id)!)
        : corpus.research;
      const ranked = pool
        .map((r) => ({ r, cov: coverage(words, r.text) }))
        .sort((a, b) => b.cov - a.cov);
      const top = ranked.filter((x) => x.cov > 0).slice(0, 3);
      const researchText = top.map((x) => x.r.text).join(" \n ");
      const researchCov = coverage(words, researchText);
      const researchMarkers = checkMarkers(sentence, `${researchText} \n ${allFacts}`, names);
      if (top.length && researchCov >= 0.6 && !researchMarkers.hard.length) {
        return {
          ...base,
          claimKind: "COMPANY",
          status: researchMarkers.soft.length ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
          reasons: [
            `Backed by ${top.length} research claim${top.length === 1 ? "" : "s"}.`,
            ...researchMarkers.reasons,
          ],
          researchClaimIds: top.map((x) => x.r.id),
          basis: "CITED",
          unsupported: researchMarkers.soft,
        };
      }
      const jobCov = coverage(words, corpus.job.text);
      const jobMarkers = checkMarkers(sentence, `${corpus.job.text} \n ${allFacts}`, names);
      if (jobCov >= 0.6 && !jobMarkers.hard.length && !COMPANY_FACT_VERB.test(sentence)) {
        return {
          ...base,
          claimKind: "COMPANY",
          status: jobMarkers.soft.length ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
          reasons: ["Stated in the job posting.", ...jobMarkers.reasons],
          basis: "JOB_POSTING",
          unsupported: jobMarkers.soft,
        };
      }
      if (corpus.userContext && coverage(words, corpus.userContext) >= 0.6) {
        return {
          ...base,
          claimKind: "USER_CONTEXT",
          status: "SUPPORTED",
          reasons: ["Comes from the context you provided (not externally verified)."],
          userContext: true,
          basis: "USER_CONTEXT",
          unsupported: [],
        };
      }
      return {
        ...base,
        claimKind: "COMPANY",
        status: "UNSUPPORTED",
        reasons: [
          `No verified research source supports this statement about ${corpus.job.company ?? "the company"}.`,
        ],
        basis: "NONE",
        unsupported: words.slice(0, 6),
      };
    }
  }

  // 2. Statements from the user's own context.
  const contextual =
    Boolean(corpus.userContext) &&
    (hint?.usesUserContext ||
      coverage(contentWords(sentence), corpus.userContext!) >= 0.5 ||
      similarity(sentence, corpus.userContext!) >= 0.6);
  if (contextual) {
    const m = checkMarkers(sentence, `${corpus.userContext} \n ${allFacts}`, names);
    return {
      ...base,
      claimKind: "USER_CONTEXT",
      status: m.hard.length ? "UNSUPPORTED" : m.soft.length ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
      reasons: m.hard.length
        ? m.reasons
        : ["Comes from the context you provided (not externally verified).", ...m.reasons],
      userContext: true,
      basis: "USER_CONTEXT",
      unsupported: [...m.hard, ...m.soft],
    };
  }

  const firstPerson = FIRST_PERSON.test(sentence);
  const markers = hasMarkers(sentence, names);
  if (META.test(sentence) && !markers) return null;
  // Pure intent/courtesy ("I am applying for the <role> role at <company>") states no fact.
  const substantive = contentWords(sentence).filter(
    (w) => !GENERIC.has(w) && !GENERIC.has(stem(w)) && !names.has(w) && !NEUTRAL_VERBS.has(w),
  );
  if (!markers && !substantive.length && !citedResearch.length) return null;

  // Descriptive statements about the role/team (no numbers or names) must match the posting.
  if (!firstPerson && !markers && !citedFacts.length && ROLE_REF.test(sentence)) {
    const words = companyContent(sentence, corpus, "");
    if (!words.length) return null;
    const jobCov = coverage(words, corpus.job.text);
    const researchHit = corpus.research
      .map((r) => ({ r, cov: coverage(words, r.text) }))
      .sort((a, b) => b.cov - a.cov)[0];
    if (jobCov >= 0.5)
      return {
        ...base,
        claimKind: "COMPANY",
        status: "SUPPORTED",
        reasons: ["Stated in the job posting."],
        basis: "JOB_POSTING",
        unsupported: [],
      };
    if (researchHit && researchHit.cov >= 0.6)
      return {
        ...base,
        claimKind: "COMPANY",
        status: "SUPPORTED",
        reasons: ["Backed by a research claim."],
        researchClaimIds: [researchHit.r.id],
        basis: "CITED",
        unsupported: [],
      };
    return {
      ...base,
      claimKind: "COMPANY",
      status: "PARTIALLY_SUPPORTED",
      reasons: ["Not found in the job posting or research — make sure it is accurate."],
      basis: "NONE",
      unsupported: words.slice(0, 6),
    };
  }
  if (!hint && !markers) return null; // nothing checkable (tone, intent, courtesy)

  // 3. Candidate statements — grounded in candidate facts.
  if (firstPerson || citedFacts.length) {
    const support = citedFacts.length
      ? [corpus.candidateName ?? "", ...citedFacts.map((r) => factByRef.get(r)!.text)].join(" \n ")
      : allFacts;
    // Names that refer to the job itself (from the posting) are not claims about the candidate;
    // skills, numbers and leadership are still checked against the candidate facts only.
    const jobNames = new Set([
      ...names,
      ...foldText(corpus.job.text)
        .split(" ")
        .map((w) => w.replace(/\.+$/, "")),
    ]);
    let m = checkMarkers(sentence, support, jobNames);
    let refs = citedFacts;
    // A cited subset may miss a marker another fact supports → fall back to all facts.
    if (citedFacts.length && (m.hard.length || m.soft.length)) {
      const all = checkMarkers(sentence, allFacts, jobNames);
      if (all.hard.length + all.soft.length < m.hard.length + m.soft.length) {
        m = all;
        refs = [];
      }
    }
    if (!refs.length && !m.hard.length) refs = bestFacts(sentence, corpus.facts);
    const lowOverlap =
      citedFacts.length > 0 &&
      refs.length > 0 &&
      coverage(
        contentWords(sentence).filter((w) => !GENERIC.has(w)),
        refs.map((r) => factByRef.get(r)?.text ?? "").join(" "),
      ) < 0.3;
    const status: ClaimStatus = m.hard.length
      ? "UNSUPPORTED"
      : m.soft.length || lowOverlap
        ? "PARTIALLY_SUPPORTED"
        : refs.length || !markers
          ? "SUPPORTED"
          : "PARTIALLY_SUPPORTED";
    return {
      ...base,
      claimKind: "CANDIDATE",
      status,
      reasons:
        status === "SUPPORTED"
          ? ["Every number, skill and name is found in your facts."]
          : lowOverlap && !m.reasons.length
            ? ["The wording goes beyond what the cited facts say."]
            : m.reasons,
      factRefs: m.hard.length ? [] : refs,
      basis: citedFacts.length ? "CITED" : "DETECTED",
      unsupported: [...m.hard, ...m.soft],
    };
  }

  // 4. Other factual sentences (e.g. about the role) — job posting, research or facts.
  const m = checkMarkers(sentence, `${corpus.job.text} \n ${allResearch} \n ${allFacts}`, names);
  return {
    ...base,
    claimKind: "COMPANY",
    status: m.hard.length ? "UNSUPPORTED" : m.soft.length ? "PARTIALLY_SUPPORTED" : "SUPPORTED",
    reasons: m.hard.length || m.soft.length ? m.reasons : ["Consistent with the job posting."],
    basis: m.hard.length ? "NONE" : "JOB_POSTING",
    unsupported: [...m.hard, ...m.soft],
  };
}

/** The facts that share the most content with a sentence (for provenance display). */
function bestFacts(sentence: string, facts: EvidenceCorpus["facts"]): string[] {
  const skills = new Set(findSkills(sentence).map((s) => s.key));
  return facts
    .map((f) => {
      const skillHits = findSkills(f.text).filter((s) => skills.has(s.key)).length;
      return { ref: f.ref, score: skillHits * 2 + similarity(sentence, f.text) };
    })
    .filter((x) => x.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.ref);
}

/** Audits every body sentence of a document. */
export function auditDocument(
  doc: CommunicationDocument,
  corpus: EvidenceCorpus,
  declared: DeclaredClaim[] = [],
): AuditedClaim[] {
  const out: AuditedClaim[] = [];
  paragraphsOf(doc).forEach((p, i) => {
    for (const sentence of splitSentences(p)) {
      const claim = auditSentence(sentence, `body:${i}`, corpus, declared);
      if (claim) out.push(claim);
    }
  });
  return out;
}

/** Stable hash input describing the evidence (facts/research/context) a check ran against. */
export function corpusFingerprint(corpus: EvidenceCorpus): string {
  return JSON.stringify([
    corpus.facts.map((f) => [f.ref, f.text]).sort(),
    corpus.research.map((r) => [r.id, r.text]).sort(),
    corpus.userContext,
    corpus.job.title,
    corpus.job.company,
    corpus.recipient,
  ]);
}
