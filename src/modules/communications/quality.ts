/**
 * Communication Quality Engine (deterministic, explainable). No "human score", no AI-detection
 * probability, no detector-evasion advice — concrete findings with recommendations.
 *   PASS · INFO · WARNING · CRITICAL   (CRITICAL blocks approval)
 */
import { paragraphsOf, type CommunicationDocument } from "./document";
import type { ClaimKind, ClaimStatus } from "./types";

export const QUALITY_CHECKER_VERSION = "communication-quality-1";

export type Severity = "PASS" | "INFO" | "WARNING" | "CRITICAL";
export type Category =
  | "ACCURACY"
  | "RELEVANCE"
  | "WRITING"
  | "COMPLETENESS"
  | "LENGTH"
  | "CONSISTENCY"
  | "PERSONALIZATION";

export interface QualityFinding {
  category: Category;
  code: string;
  severity: Severity;
  message: string;
  recommendation: string | null;
  location: string | null;
  evidence: Record<string, unknown>;
}

export interface QualityInput {
  doc: CommunicationDocument;
  context: {
    jobTitle: string | null;
    companyName: string | null;
    candidateName: string | null;
    recipientName: string | null;
    length: "SHORT" | "STANDARD" | "DETAILED";
    /** An attachment is only ever associated in Phase 7, never sent */
    resumeAssociated: boolean;
  };
  claims: { location: string; text: string; claimKind: ClaimKind; status: ClaimStatus }[];
}

const GENERIC_OPENINGS =
  /^(i am writing to (express|apply)|i hope (this|you are|you're)|please find (attached|enclosed)|to whom it may concern|i am excited to apply|my name is)/i;
const FILLER =
  /\b(synerg\w*|leverag(e|ing) my|results[- ]driven|go-getter|world[- ]class|passionate about everything|thinking outside the box|dynamic (individual|professional)|team player|hard[- ]working|detail[- ]oriented individual)\b/i;
const EMPTY_ENTHUSIASM =
  /\b(thrilled|beyond excited|incredibly excited|dream (job|company)|huge fan|absolutely love)\b/i;
const EXAGGERATION =
  /\b(best|perfect fit|ideal candidate|unmatched|exceptional(ly)?|guarantee\w*|never fail\w*|always exceed\w*)\b/i;
const FAKE_FAMILIARITY =
  /\b(following your company for years|long-time admirer|as we discussed|as per our (conversation|call)|great speaking with you|it was (great|nice) (meeting|talking))\b/i;
const ATTACHMENT_SENT =
  /\b(i have attached|i've attached|please find (attached|enclosed)|attached (is|you will find)|enclosed (is|please find))\b/i;
const WORD_LIMITS: Record<string, Record<"SHORT" | "STANDARD" | "DETAILED", [number, number]>> = {
  EMAIL: { SHORT: [40, 140], STANDARD: [80, 260], DETAILED: [150, 400] },
  COVER_LETTER: { SHORT: [150, 300], STANDARD: [250, 450], DETAILED: [350, 650] },
};

const words = (t: string) => t.split(/\s+/).filter(Boolean).length;
const sentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

export function runQualityChecks(input: QualityInput): QualityFinding[] {
  const { doc, context } = input;
  const f: QualityFinding[] = [];
  const add = (
    category: Category,
    code: string,
    severity: Severity,
    message: string,
    recommendation: string | null = null,
    location: string | null = null,
    evidence: Record<string, unknown> = {},
  ) => f.push({ category, code, severity, message, recommendation, location, evidence });
  const body = paragraphsOf(doc).filter((p) => p.trim());
  const text = [doc.kind === "EMAIL" ? doc.subject : "", doc.greeting, ...body, doc.closing].join(
    "\n",
  );

  // --- COMPLETENESS ------------------------------------------------------------------
  if (doc.kind === "EMAIL") {
    if (doc.subject.trim()) add("COMPLETENESS", "subject.present", "PASS", "Subject present.");
    else
      add(
        "COMPLETENESS",
        "subject.missing",
        "CRITICAL",
        "The email has no subject.",
        "Add a short, specific subject such as the role title.",
        "subject",
      );
  }
  if (doc.greeting.trim()) add("COMPLETENESS", "greeting.present", "PASS", "Greeting present.");
  else
    add(
      "COMPLETENESS",
      "greeting.missing",
      "CRITICAL",
      "There is no greeting.",
      "Add a greeting; use a generic one if you don't know the recipient's name.",
      "greeting",
    );
  if (body.length) add("COMPLETENESS", "body.present", "PASS", "Body present.");
  else
    add(
      "COMPLETENESS",
      "body.missing",
      "CRITICAL",
      "The body is empty.",
      "Write the message or generate a draft from your facts.",
      "body",
    );
  if (doc.closing.trim()) add("COMPLETENESS", "closing.present", "PASS", "Closing present.");
  else
    add(
      "COMPLETENESS",
      "closing.missing",
      "WARNING",
      "There is no closing line.",
      "Add a closing such as “Kind regards,”.",
      "closing",
    );
  if (doc.signature.trim()) add("COMPLETENESS", "signature.present", "PASS", "Signature present.");
  else
    add(
      "COMPLETENESS",
      "signature.missing",
      "CRITICAL",
      "There is no signature.",
      "Choose a signature preset or type your name.",
      "signature",
    );

  // --- ACCURACY (claims) --------------------------------------------------------------
  const unsupported = input.claims.filter((c) => c.status === "UNSUPPORTED");
  const partial = input.claims.filter((c) => c.status === "PARTIALLY_SUPPORTED");
  const unknownCompany = input.claims.filter(
    (c) => c.claimKind === "COMPANY" && c.status !== "SUPPORTED",
  );
  for (const c of unsupported)
    add(
      "ACCURACY",
      "claim.unsupported",
      "CRITICAL",
      `Unsupported statement: “${c.text.slice(0, 120)}”.`,
      "Remove it or rewrite it using only your verified facts or sourced company research.",
      c.location,
    );
  for (const c of partial)
    add(
      "ACCURACY",
      "claim.partial",
      "WARNING",
      `Partly supported statement: “${c.text.slice(0, 120)}”.`,
      "Review it against your facts; tone it down to what the facts say.",
      c.location,
    );
  if (!unsupported.length && !partial.length && input.claims.length)
    add(
      "ACCURACY",
      "claims.supported",
      "PASS",
      "Every checked statement is supported by your facts, sourced research or your own context.",
    );
  if (unknownCompany.length)
    add(
      "ACCURACY",
      "company.unsourced",
      "CRITICAL",
      `${unknownCompany.length} company statement${unknownCompany.length === 1 ? " is" : "s are"} not backed by a research source.`,
      "Remove company claims that no research source supports.",
    );
  if (ATTACHMENT_SENT.test(text)) {
    add(
      "ACCURACY",
      "attachment.claim",
      context.resumeAssociated ? "WARNING" : "CRITICAL",
      "The text says a file is attached, but Phase 7 never sends or attaches anything.",
      "Say the resume is available or refer to it without claiming an attachment was sent.",
      null,
    );
  }
  if (FAKE_FAMILIARITY.test(text))
    add(
      "ACCURACY",
      "relationship.claim",
      "CRITICAL",
      "The text implies a prior conversation or relationship.",
      "Only mention contact that actually happened — add it as your own context first.",
    );

  // --- CONSISTENCY ---------------------------------------------------------------------
  const greetName = doc.greeting.match(/^(?:dear|hi|hello)\s+([^,]+),?$/i)?.[1]?.trim();
  const generic = /^(hiring (team|manager)|recruiter|hr team|team|sir or madam|recruitment team)$/i;
  if (greetName && !generic.test(greetName)) {
    if (
      !context.recipientName ||
      greetName.toLowerCase() !== context.recipientName.trim().toLowerCase()
    ) {
      add(
        "CONSISTENCY",
        "recipient.name_unknown",
        "CRITICAL",
        `The greeting names “${greetName}”, which is not the recipient you entered.`,
        "Use the recipient name you provided, or a generic greeting.",
        "greeting",
      );
    } else
      add("CONSISTENCY", "recipient.name", "PASS", "Greeting matches the recipient you entered.");
  }
  if (context.candidateName) {
    const first = context.candidateName.split(/\s+/)[0]!.toLowerCase();
    if (doc.signature && !doc.signature.toLowerCase().includes(first))
      add(
        "CONSISTENCY",
        "signature.name",
        "WARNING",
        "The signature does not contain your name.",
        "Sign with your name.",
        "signature",
      );
  }
  if (context.companyName) {
    if (text.toLowerCase().includes(context.companyName.toLowerCase()))
      add("RELEVANCE", "company.mentioned", "PASS", `Mentions ${context.companyName}.`);
    else
      add(
        "PERSONALIZATION",
        "company.missing",
        "WARNING",
        `The text never mentions ${context.companyName}.`,
        "Name the company once where it's natural.",
      );
  }
  if (context.jobTitle) {
    const titleWords = context.jobTitle
      .toLowerCase()
      .split(/[^a-z0-9+#]+/)
      .filter((w) => w.length > 3);
    const hits = titleWords.filter((w) => text.toLowerCase().includes(w));
    if (hits.length) add("RELEVANCE", "role.mentioned", "PASS", "Refers to the target role.");
    else
      add(
        "RELEVANCE",
        "role.missing",
        "WARNING",
        `The target role “${context.jobTitle}” is not mentioned.`,
        "State which role you are writing about.",
      );
  }

  // --- WRITING --------------------------------------------------------------------------
  const opening = body[0] ?? "";
  if (opening && GENERIC_OPENINGS.test(opening.trim()))
    add(
      "WRITING",
      "opening.generic",
      "WARNING",
      "The opening is generic.",
      "Start with one concrete reason this role connects to your experience.",
      "body:0",
    );
  else if (opening)
    add("WRITING", "opening.specific", "PASS", "The opening is not a stock phrase.");
  const filler = text.match(FILLER);
  if (filler)
    add(
      "WRITING",
      "filler",
      "WARNING",
      `Filler phrase: “${filler[0]}”.`,
      "Replace it with something specific you did.",
    );
  const enthusiasm = text.match(EMPTY_ENTHUSIASM);
  if (enthusiasm)
    add(
      "WRITING",
      "enthusiasm",
      "INFO",
      `Empty enthusiasm: “${enthusiasm[0]}”.`,
      "Show interest through a specific reason instead.",
    );
  const exaggeration = text.match(EXAGGERATION);
  if (exaggeration)
    add(
      "WRITING",
      "exaggeration",
      "WARNING",
      `Exaggerated claim: “${exaggeration[0]}”.`,
      "Let concrete evidence make the case.",
    );
  body.forEach((p, i) => {
    for (const s of sentences(p))
      if (words(s) > 40)
        add(
          "WRITING",
          "sentence.long",
          "INFO",
          `A sentence in paragraph ${i + 1} has ${words(s)} words.`,
          "Split it into two.",
          `body:${i}`,
        );
  });
  const seen = new Map<string, number>();
  body.forEach((p, i) => {
    for (const s of sentences(p)) {
      const k = s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
      if (k.length > 30 && seen.has(k))
        add(
          "WRITING",
          "repetition",
          "WARNING",
          "A sentence is repeated.",
          "Remove the repetition.",
          `body:${i}`,
        );
      seen.set(k, i);
    }
  });

  // --- LENGTH -----------------------------------------------------------------------------
  const count = words(body.join(" "));
  const [min, max] = WORD_LIMITS[doc.kind]![context.length];
  if (body.length && count < min)
    add(
      "LENGTH",
      "length.short",
      "INFO",
      `The body is ${count} words — short for a ${context.length.toLowerCase()} ${doc.kind === "EMAIL" ? "email" : "cover letter"}.`,
      "Add one piece of relevant evidence if you have it.",
    );
  else if (count > max)
    add(
      "LENGTH",
      "length.long",
      "WARNING",
      `The body is ${count} words — long for a ${context.length.toLowerCase()} ${doc.kind === "EMAIL" ? "email" : "cover letter"}.`,
      "Cut what the reader can find in your resume.",
    );
  else if (body.length)
    add("LENGTH", "length.ok", "PASS", `Length is appropriate (${count} words).`);

  return f;
}

export function summarizeQuality(findings: QualityFinding[]) {
  const s = { passed: 0, critical: 0, warnings: 0, info: 0 };
  for (const x of findings) {
    if (x.severity === "PASS") s.passed++;
    else if (x.severity === "CRITICAL") s.critical++;
    else if (x.severity === "WARNING") s.warnings++;
    else s.info++;
  }
  return s;
}
