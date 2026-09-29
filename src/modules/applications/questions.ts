/**
 * Application question engine — classification and answer shaping (pure).
 * Legal, demographic, preference and availability questions always need the candidate. Motivation,
 * experience, project, behavioural and role/company-interest questions may get a generated,
 * fact-validated draft. Technical questions are generated only when the skill is in the facts.
 */
import { findSkills } from "@/modules/matching/skills";
import {
  auditSentence,
  splitSentences,
  type DeclaredClaim,
  type EvidenceCorpus,
} from "@/modules/communications/claims";

export type QuestionClassification =
  | "FACTUAL"
  | "EXPERIENCE"
  | "PREFERENCE"
  | "MOTIVATION"
  | "BEHAVIORAL"
  | "TECHNICAL"
  | "LEGAL"
  | "DEMOGRAPHIC"
  | "OTHER";
export type AnswerType =
  | "CANDIDATE_FACT"
  | "EXPERIENCE"
  | "PROJECT"
  | "MOTIVATION"
  | "COMPANY_INTEREST"
  | "ROLE_INTEREST"
  | "BEHAVIORAL"
  | "TECHNICAL"
  | "PREFERENCES"
  | "AVAILABILITY"
  | "OTHER";

export interface QuestionClass {
  classification: QuestionClassification;
  answerType: AnswerType;
  generatable: boolean;
  reason: string;
}

export function classifyQuestion(text: string, candidateSkills: string[] = []): QuestionClass {
  const q = text.toLowerCase();
  const gen = (
    classification: QuestionClassification,
    answerType: AnswerType,
    reason: string,
  ): QuestionClass => ({ classification, answerType, generatable: true, reason });
  const user = (
    classification: QuestionClassification,
    answerType: AnswerType,
    reason: string,
  ): QuestionClass => ({ classification, answerType, generatable: false, reason });
  if (
    /\b(gender|race|ethnic|veteran|disabilit|sexual orientation|pronoun|religion|caste|date of birth)\b/.test(
      q,
    )
  )
    return user("DEMOGRAPHIC", "OTHER", "Voluntary self-identification — only you can answer.");
  if (
    /\b(authori[sz]ed to work|work authori[sz]ation|right to work|visa|sponsor|work permit|citizenship|criminal|background check|convicted)\b/.test(
      q,
    )
  )
    return user(
      "LEGAL",
      "OTHER",
      "Legal / work authorization — only your explicit answer is used.",
    );
  if (/\b(salary|compensation|ctc|pay expectation|remuneration)\b/.test(q))
    return user("PREFERENCE", "PREFERENCES", "Salary — only your own figure is used.");
  if (/\b(start date|notice period|when can you start|availability|available to start)\b/.test(q))
    return user("PREFERENCE", "AVAILABILITY", "Availability — only your own answer is used.");
  if (/\b(relocat|remote|on-?site|hybrid|willing to travel|shift)\b/.test(q) && !/\bwhy\b/.test(q))
    return user("PREFERENCE", "PREFERENCES", "Work preference — only your own answer is used.");
  if (/\b(rate your|proficiency|how many years|years of experience|level of expertise)\b/.test(q)) {
    const asked = findSkills(text);
    const have = new Set(candidateSkills.flatMap((s) => findSkills(s).map((x) => x.key)));
    return asked.length && asked.every((s) => have.has(s.key))
      ? user(
          "TECHNICAL",
          "TECHNICAL",
          "A self-rating or duration — only you can give it (the skill is in your facts).",
        )
      : user(
          "TECHNICAL",
          "TECHNICAL",
          "Not supported by your facts — no level or duration is invented.",
        );
  }
  if (
    /\b(why (do you want|are you interested|this (role|position|job))|what (interests|excites|attracts|draws) you (about|to) (this|the) (role|position|job)|interest in this (role|position))\b/.test(
      q,
    )
  )
    return gen(
      "MOTIVATION",
      "ROLE_INTEREST",
      "Role motivation — drafted from your facts and the job.",
    );
  if (
    /\bwhy (do you want to (join|work (at|for|with))|us\b|our company|this company)|what do you know about (us|our company)|why (?!do you want)[a-z]+\??$/.test(
      q,
    )
  )
    return gen(
      "MOTIVATION",
      "COMPANY_INTEREST",
      "Company motivation — only sourced research and your own context are used.",
    );
  if (/\b(project|something you (built|are proud|created))\b/.test(q))
    return gen("EXPERIENCE", "PROJECT", "Project — drafted only from projects in your facts.");
  if (
    /\b(tell us about a time|describe a (time|situation)|give an example|when have you|how do you handle|conflict|challenge you faced|failure|mistake)\b/.test(
      q,
    )
  )
    return gen(
      "BEHAVIORAL",
      "BEHAVIORAL",
      "Behavioural — drafted only from experiences in your facts.",
    );
  if (
    /\b(experience|background|relevant|qualif|why should we hire|what makes you|what would you bring|skills)\b/.test(
      q,
    )
  )
    return gen(
      "EXPERIENCE",
      "EXPERIENCE",
      "Experience — drafted from your facts; no superiority claims.",
    );
  if (
    /\b(technical|architecture|how would you (build|design|implement)|stack|code|technology)\b/.test(
      q,
    )
  )
    return gen(
      "TECHNICAL",
      "TECHNICAL",
      "Technical — drafted only from skills and work in your facts.",
    );
  if (
    /\b(anything else|additional information|cover letter|message to the (team|hiring))\b/.test(q)
  )
    return gen("OTHER", "OTHER", "Optional free text — drafted from your facts.");
  return user(
    "OTHER",
    "OTHER",
    "Not a question type JOBHUNT OS drafts automatically — please answer it yourself.",
  );
}

/**
 * Fits an answer into a character limit at a sentence boundary — never cuts a sentence in half.
 * Returns null when even the first sentence is too long (a concise rewrite is needed).
 */
export function fitToLimit(text: string, maxLength: number | null): string | null {
  const t = text.trim();
  if (!maxLength || t.length <= maxLength) return t;
  const sentences = splitSentences(t.replace(/\n+/g, " "));
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > maxLength) break;
    out = next;
  }
  return out || null;
}

export interface AuditedAnswer {
  text: string;
  status: "SUPPORTED" | "PARTIALLY_SUPPORTED" | "UNSUPPORTED" | "NEEDS_USER_INPUT";
  factRefs: string[];
  researchClaimIds: string[];
  /** Sentences removed because the facts don't support them */
  dropped: { text: string; reasons: string[] }[];
  warnings: string[];
}

/**
 * Audits an answer sentence by sentence with the communication claim auditor. With `drop`
 * (generated drafts), unsupported sentences are removed; for user-written answers they are kept
 * and reported. The result is then fitted to the character limit at a sentence boundary.
 */
export function auditAnswer(
  text: string,
  corpus: EvidenceCorpus,
  opts: { maxLength?: number | null; drop: boolean; declared?: DeclaredClaim[] },
): AuditedAnswer {
  const kept: string[] = [];
  const dropped: AuditedAnswer["dropped"] = [];
  const factRefs = new Set<string>();
  const researchClaimIds = new Set<string>();
  let partial = false;
  let unsupported = false;
  const sentences = text
    .split(/\n+/)
    .flatMap((p) => splitSentences(p.trim()))
    .filter(Boolean);
  sentences.forEach((s, i) => {
    const audit = auditSentence(s, `answer.${i}`, corpus, opts.declared ?? []);
    if (audit?.status === "UNSUPPORTED" || audit?.status === "UNKNOWN") {
      if (opts.drop) {
        dropped.push({ text: s, reasons: audit.reasons.slice(0, 3) });
        return;
      }
      unsupported = true;
    }
    if (audit?.status === "PARTIALLY_SUPPORTED") partial = true;
    audit?.factRefs.forEach((r) => factRefs.add(r));
    audit?.researchClaimIds.forEach((r) => researchClaimIds.add(r));
    kept.push(s);
  });
  const warnings: string[] = [];
  let out = kept.join(" ").trim();
  if (opts.maxLength && out.length > opts.maxLength) {
    const fitted = fitToLimit(out, opts.maxLength);
    if (fitted) {
      warnings.push(`Shortened to ${opts.maxLength} characters at a sentence boundary.`);
      out = fitted;
    } else {
      warnings.push(
        `The answer is longer than the ${opts.maxLength}-character limit — shorten it.`,
      );
    }
  }
  if (dropped.length)
    warnings.push(
      `${dropped.length} statement(s) removed: not supported by your facts or sourced research.`,
    );
  const status: AuditedAnswer["status"] = !out
    ? "NEEDS_USER_INPUT"
    : unsupported
      ? "UNSUPPORTED"
      : partial
        ? "PARTIALLY_SUPPORTED"
        : "SUPPORTED";
  return {
    text: out,
    status,
    factRefs: [...factRefs],
    researchClaimIds: [...researchClaimIds],
    dropped,
    warnings,
  };
}
