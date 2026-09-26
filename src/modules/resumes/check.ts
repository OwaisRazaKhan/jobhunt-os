/**
 * Resume Check engine (deterministic, explainable). Not an ATS score: there is no universal
 * ATS. Each rule produces a finding with a severity and a recommendation:
 *   PASS · INFO · OPPORTUNITY (alignment improvement) · WARNING (review) · ISSUE (fix before use)
 * Preferred requirements that are missing are OPPORTUNITY/INFO, never failures.
 */
import type { KeywordResult, RequirementAlignment } from "./alignment";
import { documentText, visibleSections, type ResumeDocument } from "./document";
import { unsupportedCharacters } from "./render/text";

export const CHECKER_VERSION = "resume-check-1";

export type Severity = "PASS" | "INFO" | "OPPORTUNITY" | "WARNING" | "ISSUE";
export type Category =
  "STRUCTURE" | "CONTENT" | "ALIGNMENT" | "READABILITY" | "FORMATTING" | "PROVENANCE";

export interface Finding {
  category: Category;
  code: string;
  severity: Severity;
  message: string;
  recommendation: string | null;
  itemId: string | null;
  evidence: Record<string, unknown>;
}

export interface CheckInput {
  doc: ResumeDocument;
  /** Pages of the actual rendered PDF (null when rendering was not possible) */
  pages: number | null;
  job?: { title: string; company: string | null } | null;
  alignment?: RequirementAlignment[];
  keywords?: KeywordResult[];
}

export interface CheckSummary {
  passed: number;
  issues: number;
  warnings: number;
  opportunities: number;
  info: number;
  byCategory: Record<Category, { passed: number; attention: number }>;
}

const FIRST_PERSON = /(^|[^a-z])(i|me|my|mine|we|our)([^a-z]|$)/i;
const INFLATED =
  /\b(results[- ]driven|synerg\w*|world[- ]class|visionary|guru|ninja|rockstar|paradigm|groundbreaking|best[- ]in[- ]class|dynamic professional|go-getter|thought leader|game[- ]chang\w*)\b/i;
const VAGUE = /\b(various|etc\.?|stuff|things|helped with|responsible for|worked on)\b/i;
const GUARANTEE = /\b(guarantee\w*|100% ats|ats[- ]proof|pass(es)? (the )?ats)\b/i;
const MAX_BULLET = 220;
const MIN_BULLET = 25;
const STANDARD_TITLES =
  /^(summary|professional summary|profile|experience|work experience|professional experience|employment|projects|education|skills|technical skills|certifications|licenses|languages|links|additional|achievements|awards|publications|volunteer|volunteering|leadership|interests|affiliations)$/i;

interface Bullet {
  id: string;
  text: string;
  parent: string;
}

function bullets(doc: ResumeDocument): Bullet[] {
  const vis = new Set(visibleSections(doc));
  const out: Bullet[] = [];
  if (vis.has("experience"))
    for (const e of doc.experience.filter((x) => !x.hidden))
      for (const b of e.bullets.filter((x) => !x.hidden))
        out.push({ id: b.id, text: b.text, parent: `${e.title} — ${e.organization}` });
  if (vis.has("projects"))
    for (const p of doc.projects.filter((x) => !x.hidden))
      for (const b of p.bullets.filter((x) => !x.hidden))
        out.push({ id: b.id, text: b.text, parent: p.name });
  if (vis.has("additional"))
    for (const a of doc.additional.filter((x) => !x.hidden))
      for (const b of a.bullets.filter((x) => !x.hidden))
        out.push({ id: b.id, text: b.text, parent: a.title });
  return out;
}

function provenanceItems(doc: ResumeDocument) {
  const out: {
    id: string;
    label: string;
    origin: string;
    claimStatus: string;
    factRefs: string[];
  }[] = [];
  const vis = new Set(visibleSections(doc));
  if (vis.has("summary") && doc.summary && !doc.summary.hidden)
    out.push({ ...doc.summary, label: "Summary" });
  for (const e of vis.has("experience") ? doc.experience.filter((x) => !x.hidden) : []) {
    out.push({ ...e, label: `${e.title} — ${e.organization}` });
    for (const b of e.bullets.filter((x) => !x.hidden))
      out.push({ ...b, label: `Bullet in ${e.title}` });
  }
  for (const p of vis.has("projects") ? doc.projects.filter((x) => !x.hidden) : []) {
    out.push({ ...p, label: p.name });
    for (const b of p.bullets.filter((x) => !x.hidden))
      out.push({ ...b, label: `Bullet in ${p.name}` });
  }
  for (const g of vis.has("skills") ? doc.skills.filter((x) => !x.hidden) : [])
    for (const s of g.skills.filter((x) => !x.hidden)) out.push({ ...s, label: `Skill ${s.name}` });
  for (const a of vis.has("additional") ? doc.additional.filter((x) => !x.hidden) : [])
    for (const b of a.bullets.filter((x) => !x.hidden))
      out.push({ ...b, label: `Bullet in ${a.title}` });
  return out;
}

export function runResumeCheck(input: CheckInput): Finding[] {
  const { doc } = input;
  const f: Finding[] = [];
  const add = (
    category: Category,
    code: string,
    severity: Severity,
    message: string,
    recommendation: string | null = null,
    itemId: string | null = null,
    evidence: Record<string, unknown> = {},
  ) => f.push({ category, code, severity, message, recommendation, itemId, evidence });
  const vis = new Set(visibleSections(doc));
  const has = {
    summary: vis.has("summary") && Boolean(doc.summary && !doc.summary.hidden),
    experience: vis.has("experience") && doc.experience.some((e) => !e.hidden),
    projects: vis.has("projects") && doc.projects.some((p) => !p.hidden),
    education: vis.has("education") && doc.education.some((e) => !e.hidden),
    skills:
      vis.has("skills") && doc.skills.some((g) => !g.hidden && g.skills.some((s) => !s.hidden)),
  };

  // --- STRUCTURE -------------------------------------------------------------------
  if (doc.header.name.trim()) add("STRUCTURE", "header.name", "PASS", "Name is present.");
  else
    add(
      "STRUCTURE",
      "header.name",
      "ISSUE",
      "The resume has no name.",
      "Add your full name in the header.",
    );
  if (doc.header.email || doc.header.phone)
    add("STRUCTURE", "header.contact", "PASS", "Contact information detected.");
  else
    add(
      "STRUCTURE",
      "header.contact",
      "ISSUE",
      "No email or phone number.",
      "Add at least one contact method (email preferred).",
    );
  if (!doc.header.headline && !has.summary)
    add(
      "STRUCTURE",
      "header.target",
      "WARNING",
      "No headline or summary gives the reader your target role.",
      "Add a short headline such as the role you are applying for — only if it reflects your real direction.",
    );
  else add("STRUCTURE", "header.target", "PASS", "Target role context is present.");
  if (!has.experience && !has.projects)
    add(
      "STRUCTURE",
      "sections.core",
      "ISSUE",
      "Neither experience nor projects are shown.",
      "Add experience or projects to your candidate profile, then rebuild or add them here.",
    );
  else
    add("STRUCTURE", "sections.core", "PASS", "Core sections (experience/projects) are present.");
  if (!has.education)
    add(
      "STRUCTURE",
      "sections.education",
      "INFO",
      "No education section is shown.",
      "Add education if you have it; many employers expect it.",
    );
  if (!has.skills)
    add(
      "STRUCTURE",
      "sections.skills",
      "WARNING",
      "No skills are shown.",
      "Add skills from your verified profile.",
    );
  const empty = doc.sections
    .filter((s) => s.visible)
    .filter((s) => {
      switch (s.key) {
        case "summary":
          return !has.summary;
        case "experience":
          return !has.experience;
        case "projects":
          return !has.projects;
        case "education":
          return !has.education;
        case "skills":
          return !has.skills;
        case "certifications":
          return !doc.certifications.some((x) => !x.hidden);
        case "languages":
          return !doc.languages.some((x) => !x.hidden);
        case "links":
          return !doc.links.some((x) => !x.hidden);
        case "additional":
          return !doc.additional.some((x) => !x.hidden && x.bullets.some((b) => !b.hidden));
      }
    });
  if (empty.length)
    add(
      "STRUCTURE",
      "sections.empty",
      "INFO",
      `Empty sections are not printed: ${empty.map((s) => s.key).join(", ")}.`,
    );
  const customTitles = doc.sections.filter(
    (s) => s.visible && s.title && !STANDARD_TITLES.test(s.title),
  );
  const customAdditional = doc.additional.filter(
    (a) => !a.hidden && !STANDARD_TITLES.test(a.title),
  );
  if (customTitles.length || customAdditional.length) {
    add(
      "FORMATTING",
      "sections.titles",
      "WARNING",
      `Unusual section titles: ${[...customTitles.map((s) => s.title), ...customAdditional.map((a) => a.title)].join(", ")}.`,
      "Standard headings (Experience, Education, Skills) are recognised most reliably by applicant tracking systems.",
    );
  } else add("FORMATTING", "sections.titles", "PASS", "Section headings use standard names.");

  // --- CONTENT ---------------------------------------------------------------------
  for (const e of vis.has("experience") ? doc.experience.filter((x) => !x.hidden) : []) {
    if (!e.startDate && !e.endDate && !e.isCurrent)
      add(
        "CONTENT",
        "dates.missing",
        "WARNING",
        `No dates for "${e.title} — ${e.organization}".`,
        "Add start and end dates to your experience fact.",
        e.id,
      );
    if (e.startDate && e.endDate && e.endDate < e.startDate)
      add(
        "CONTENT",
        "dates.order",
        "ISSUE",
        `End date is before start date for "${e.title}".`,
        "Correct the dates in your candidate profile.",
        e.id,
      );
    if (!e.bullets.some((b) => !b.hidden) && !e.description)
      add(
        "CONTENT",
        "experience.empty",
        "WARNING",
        `"${e.title} — ${e.organization}" has no description or bullets.`,
        "Add responsibilities or achievements to this experience in your profile.",
        e.id,
      );
  }
  const all = bullets(doc);
  const seen = new Map<string, string>();
  let long = 0;
  for (const b of all) {
    const norm = b.text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    if (seen.has(norm))
      add(
        "CONTENT",
        "bullets.duplicate",
        "WARNING",
        `Repeated bullet: "${b.text.slice(0, 80)}".`,
        "Remove or reword duplicates.",
        b.id,
        { duplicateOf: seen.get(norm) },
      );
    else seen.set(norm, b.id);
    if (b.text.length > MAX_BULLET) {
      long++;
      add(
        "READABILITY",
        "bullets.long",
        "WARNING",
        `Long bullet (${b.text.length} characters) in ${b.parent}.`,
        `Keep bullets under about ${MAX_BULLET} characters — split or shorten it.`,
        b.id,
        { length: b.text.length },
      );
    }
    if (b.text.length < MIN_BULLET)
      add(
        "CONTENT",
        "bullets.short",
        "INFO",
        `Very short bullet in ${b.parent}: "${b.text}".`,
        "Add what you did and, if you have it, the result.",
        b.id,
      );
    if (FIRST_PERSON.test(b.text))
      add(
        "CONTENT",
        "bullets.first_person",
        "WARNING",
        `First-person wording in ${b.parent}.`,
        'Resumes usually omit "I/my/we" — start with an action verb.',
        b.id,
      );
    if (VAGUE.test(b.text))
      add(
        "CONTENT",
        "bullets.vague",
        "INFO",
        `Vague wording ("${b.text.match(VAGUE)![0]}") in ${b.parent}.`,
        "Say specifically what you did, using only facts you can support.",
        b.id,
      );
  }
  if (all.length && !long)
    add("READABILITY", "bullets.length", "PASS", "Bullet lengths are readable.");
  const text = documentText(doc);
  const inflated = text.match(INFLATED);
  if (inflated)
    add(
      "CONTENT",
      "language.inflated",
      "WARNING",
      `Inflated wording: "${inflated[0]}".`,
      "Prefer specific, factual language.",
    );
  if (GUARANTEE.test(text))
    add(
      "CONTENT",
      "language.guarantee",
      "ISSUE",
      "The resume contains guarantee-style wording.",
      "Remove claims about ATS or hiring outcomes.",
    );
  if (doc.summary && has.summary && FIRST_PERSON.test(doc.summary.text))
    add(
      "CONTENT",
      "summary.first_person",
      "INFO",
      "The summary uses first-person wording.",
      'Summaries usually omit "I/my".',
      doc.summary.id,
    );
  // Tense consistency: past roles should not start bullets with present-tense verbs.
  for (const e of vis.has("experience")
    ? doc.experience.filter((x) => !x.hidden && !x.isCurrent)
    : []) {
    const present = e.bullets.filter(
      (b) =>
        !b.hidden &&
        /^(manage|lead|create|develop|build|design|handle|coordinate|write|run|support|work)s?\b/i.test(
          b.text.trim(),
        ),
    );
    if (present.length)
      add(
        "READABILITY",
        "tense.past_role",
        "INFO",
        `Present-tense bullets in a past role (${e.title}).`,
        "Use past tense for roles you have left.",
        present[0]!.id,
      );
  }

  // --- FORMATTING --------------------------------------------------------------------
  const bad = unsupportedCharacters(text);
  if (bad.length)
    add(
      "FORMATTING",
      "characters.unsupported",
      "WARNING",
      `Characters the PDF fonts cannot print: ${bad.slice(0, 8).join(" ")}.`,
      "Replace them (the DOCX keeps them; the PDF shows '?').",
      null,
      { characters: bad },
    );
  else
    add("FORMATTING", "characters.supported", "PASS", "All characters are printable in the PDF.");
  add(
    "FORMATTING",
    "layout.single_column",
    "PASS",
    "Single-column, text-only layout (no images, tables or skill meters).",
  );
  const dateFormats = new Set(
    [...doc.experience, ...doc.projects, ...doc.education]
      .flatMap((x) => [x.startDate, x.endDate])
      .filter(Boolean)
      .map((d) => (d!.length === 4 ? "Y" : "YM")),
  );
  if (dateFormats.size > 1)
    add(
      "READABILITY",
      "dates.format",
      "INFO",
      "Some dates show a month and others only a year.",
      "Use the same precision everywhere if you know the months.",
    );
  if (input.pages != null) {
    if (input.pages > 2)
      add(
        "READABILITY",
        "length.pages",
        "WARNING",
        `The PDF is ${input.pages} pages.`,
        "Consider hiding low-relevance items — you decide what stays.",
        null,
        { pages: input.pages },
      );
    else
      add(
        "READABILITY",
        "length.pages",
        "PASS",
        `The PDF is ${input.pages} page${input.pages === 1 ? "" : "s"}.`,
        null,
        null,
        { pages: input.pages },
      );
  }

  // --- PROVENANCE ----------------------------------------------------------------------
  const items = provenanceItems(doc);
  const unsupported = items.filter((i) => i.claimStatus === "UNSUPPORTED");
  const partial = items.filter((i) => i.claimStatus === "PARTIALLY_SUPPORTED");
  const manual = items.filter((i) => i.origin === "MANUAL" && i.factRefs.length === 0);
  for (const i of unsupported)
    add(
      "PROVENANCE",
      "claims.unsupported",
      "ISSUE",
      `Unsupported statement: ${i.label}.`,
      "Remove it or rewrite it using only your verified facts.",
      i.id,
    );
  for (const i of partial)
    add(
      "PROVENANCE",
      "claims.partial",
      "WARNING",
      `Partly supported statement: ${i.label}.`,
      "Review the wording against your facts before approving.",
      i.id,
    );
  if (manual.length)
    add(
      "PROVENANCE",
      "claims.manual",
      "INFO",
      `${manual.length} manually written item${manual.length === 1 ? "" : "s"} not linked to a candidate fact.`,
      "Use “Add as candidate fact” so the information is verified and reusable.",
      manual[0]!.id,
      { itemIds: manual.map((m) => m.id) },
    );
  if (!unsupported.length && !partial.length)
    add(
      "PROVENANCE",
      "claims.grounded",
      "PASS",
      "Every statement is supported by your candidate facts or written by you.",
    );

  // --- ALIGNMENT (only with a target job) ------------------------------------------------
  if (input.job) {
    const title = input.job.title.toLowerCase();
    const headline =
      `${doc.header.headline ?? ""} ${doc.summary?.text ?? ""} ${doc.experience.map((e) => e.title).join(" ")}`.toLowerCase();
    const titleWords = title
      .split(/[^a-z0-9+#]+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !["senior", "junior", "associate", "intern", "lead", "remote", "hybrid"].includes(w),
      );
    const titleHits = titleWords.filter((w) => headline.includes(w));
    if (titleWords.length && titleHits.length)
      add("ALIGNMENT", "job.title", "PASS", `Target role terms appear (${titleHits.join(", ")}).`);
    else
      add(
        "ALIGNMENT",
        "job.title",
        "OPPORTUNITY",
        `The target title "${input.job.title}" is not reflected in your headline, summary or role titles.`,
        "If it truthfully fits, mention the role direction in your headline or summary.",
      );
    const a = input.alignment ?? [];
    const req = a.filter((x) => x.requirementType === "REQUIRED" && x.status !== "NOT_RELEVANT");
    const matched = req.filter((x) => x.status === "MATCHED");
    if (req.length)
      add(
        "ALIGNMENT",
        "requirements.required",
        matched.length === req.length ? "PASS" : "INFO",
        `${matched.length} of ${req.length} required job requirements are shown and supported.`,
        null,
        null,
        { matched: matched.length, total: req.length },
      );
    for (const x of a.filter((y) => y.status === "PARTIALLY_MATCHED" && y.factRefs.length)) {
      add(
        "ALIGNMENT",
        "requirements.not_shown",
        "OPPORTUNITY",
        `Your facts support "${x.text}" but the resume does not show it.`,
        "Consider showing the item that demonstrates it.",
        null,
        { requirementId: x.requirementId, factRefs: x.factRefs },
      );
    }
    for (const x of a.filter((y) => y.status === "MISSING" && y.requirementType === "REQUIRED")) {
      add(
        "ALIGNMENT",
        "requirements.missing_required",
        "WARNING",
        `Required: "${x.text}" is not in your verified candidate profile.`,
        "It will not be added. If you do have it, add it to your candidate profile first.",
        null,
        { requirementId: x.requirementId },
      );
    }
    const preferredMissing = a.filter(
      (y) => y.status === "MISSING" && y.requirementType !== "REQUIRED",
    );
    if (preferredMissing.length)
      add(
        "ALIGNMENT",
        "requirements.missing_preferred",
        "INFO",
        `${preferredMissing.length} preferred or unclassified requirement${preferredMissing.length === 1 ? "" : "s"} not in your profile (not a failure): ${preferredMissing
          .slice(0, 5)
          .map((x) => x.text)
          .join(", ")}.`,
      );
    for (const x of a.filter((y) => y.status === "UNSUPPORTED")) {
      add(
        "ALIGNMENT",
        "requirements.unsupported",
        "ISSUE",
        `The resume mentions "${x.text}" without supporting candidate facts.`,
        "Remove it or add the evidence to your candidate profile.",
        x.itemIds[0] ?? null,
        { requirementId: x.requirementId },
      );
    }
    const kw = input.keywords ?? [];
    const kwMatched = kw.filter((k) => k.status === "MATCHED").length;
    if (kw.length)
      add(
        "ALIGNMENT",
        "keywords.summary",
        "INFO",
        `${kwMatched} of ${kw.length} job terms appear in the resume and are supported by your facts.`,
        null,
        null,
        { matched: kwMatched, total: kw.length },
      );
    const kwUnsupported = kw.filter((k) => k.status === "UNSUPPORTED");
    if (kwUnsupported.length)
      add(
        "ALIGNMENT",
        "keywords.unsupported",
        "ISSUE",
        `Terms in the resume without supporting facts: ${kwUnsupported.map((k) => k.keyword).join(", ")}.`,
        "Remove them or verify them in your candidate profile.",
      );
  }
  return f;
}

export function summarizeFindings(findings: Finding[]): CheckSummary {
  const cats: Category[] = [
    "STRUCTURE",
    "CONTENT",
    "ALIGNMENT",
    "READABILITY",
    "FORMATTING",
    "PROVENANCE",
  ];
  const byCategory = Object.fromEntries(
    cats.map((c) => [c, { passed: 0, attention: 0 }]),
  ) as CheckSummary["byCategory"];
  const s: CheckSummary = {
    passed: 0,
    issues: 0,
    warnings: 0,
    opportunities: 0,
    info: 0,
    byCategory,
  };
  for (const x of findings) {
    if (x.severity === "PASS") {
      s.passed++;
      byCategory[x.category].passed++;
    } else {
      if (x.severity === "ISSUE") s.issues++;
      else if (x.severity === "WARNING") s.warnings++;
      else if (x.severity === "OPPORTUNITY") s.opportunities++;
      else s.info++;
      if (x.severity !== "INFO") byCategory[x.category].attention++;
    }
  }
  return s;
}
