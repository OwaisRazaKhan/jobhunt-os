import { z } from "zod";

/**
 * ResumeDocument — the canonical, renderer-independent resume content (schema v1).
 * A resume is a PRESENTATION of candidate facts: every factual item keeps `factRefs`
 * ("<kind>:<uuid>") pointing at Phase 1 candidate facts, plus how its text was produced.
 * Renderers (HTML preview, PDF, DOCX) only read this structure — content never depends on HTML.
 */

export const RESUME_SCHEMA_VERSION = 1;

export const SECTION_KEYS = [
  "summary",
  "experience",
  "projects",
  "education",
  "skills",
  "certifications",
  "languages",
  "links",
  "additional",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

export const SECTION_TITLES: Record<SectionKey, string> = {
  summary: "Summary",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  skills: "Skills",
  certifications: "Certifications",
  languages: "Languages",
  links: "Links",
  additional: "Additional",
};

/** How an item's text came to be. FACT = copied from facts; AI_REWRITE = validated AI wording; MANUAL = typed by the user. */
export const ORIGINS = ["FACT", "PROFILE", "AI_REWRITE", "MANUAL"] as const;
export type Origin = (typeof ORIGINS)[number];

/** Claim validation status (src/modules/resumes/claims.ts). */
export const CLAIM_STATUSES = [
  "SUPPORTED",
  "PARTIALLY_SUPPORTED",
  "UNSUPPORTED",
  "UNKNOWN",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const FACT_REF = /^[a-z]+:[0-9a-f-]{36}$/;
const itemId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const safeUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((v) => /^https?:\/\/[^\s<>"']+$/i.test(v), "Use a full http(s) link");
const optUrl = safeUrl.nullish().transform((v) => v ?? null);
/** Partial dates as stored by Phase 1: "YYYY" or "YYYY-MM". */
const partialDate = z
  .string()
  .regex(/^\d{4}(-\d{2})?$/, "Use YYYY or YYYY-MM")
  .nullish()
  .transform((v) => v ?? null);

const provenance = {
  id: itemId,
  hidden: z.boolean().default(false),
  factRefs: z.array(z.string().regex(FACT_REF)).max(20).default([]),
  origin: z.enum(ORIGINS).default("FACT"),
  claimStatus: z.enum(CLAIM_STATUSES).default("SUPPORTED"),
  /** Set when the user edited text that came from facts or AI */
  editedAt: z
    .string()
    .datetime()
    .nullish()
    .transform((v) => v ?? null),
};

export const bulletSchema = z.object({ ...provenance, text: text(600).min(1) });
export type ResumeBullet = z.infer<typeof bulletSchema>;

export const experienceSchema = z.object({
  ...provenance,
  title: text(200).min(1),
  organization: text(200).min(1),
  location: optText(200),
  startDate: partialDate,
  endDate: partialDate,
  isCurrent: z.boolean().default(false),
  description: optText(2000),
  bullets: z.array(bulletSchema).max(30).default([]),
  technologies: z.array(text(80).min(1)).max(40).default([]),
});
export type ResumeExperience = z.infer<typeof experienceSchema>;

export const projectSchema = z.object({
  ...provenance,
  name: text(200).min(1),
  role: optText(200),
  description: optText(2000),
  startDate: partialDate,
  endDate: partialDate,
  isCurrent: z.boolean().default(false),
  bullets: z.array(bulletSchema).max(30).default([]),
  technologies: z.array(text(80).min(1)).max(40).default([]),
  url: optUrl,
});
export type ResumeProject = z.infer<typeof projectSchema>;

export const educationSchema = z.object({
  ...provenance,
  institution: text(200).min(1),
  degree: optText(200),
  fieldOfStudy: optText(200),
  location: optText(200),
  startDate: partialDate,
  endDate: partialDate,
  isCurrent: z.boolean().default(false),
  grade: optText(100),
  details: optText(1000),
});
export type ResumeEducation = z.infer<typeof educationSchema>;

export const skillSchema = z.object({ ...provenance, name: text(80).min(1) });
export const skillGroupSchema = z.object({
  id: itemId,
  hidden: z.boolean().default(false),
  label: text(80).min(1),
  skills: z.array(skillSchema).max(80).default([]),
});
export type ResumeSkillGroup = z.infer<typeof skillGroupSchema>;

export const certificationSchema = z.object({
  ...provenance,
  name: text(200).min(1),
  issuer: optText(200),
  issueDate: partialDate,
  expiryDate: partialDate,
  credentialId: optText(200),
  url: optUrl,
});
export type ResumeCertification = z.infer<typeof certificationSchema>;

export const languageSchema = z.object({
  ...provenance,
  language: text(80).min(1),
  proficiency: optText(80),
});
export type ResumeLanguage = z.infer<typeof languageSchema>;

export const linkSchema = z.object({ ...provenance, label: text(80).min(1), url: safeUrl });
export type ResumeLink = z.infer<typeof linkSchema>;

export const additionalSectionSchema = z.object({
  id: itemId,
  hidden: z.boolean().default(false),
  title: text(80).min(1),
  bullets: z.array(bulletSchema).max(30).default([]),
});
export type ResumeAdditionalSection = z.infer<typeof additionalSectionSchema>;

export const summarySchema = z.object({ ...provenance, text: text(1500).min(1) });
export type ResumeSummary = z.infer<typeof summarySchema>;

export const headerSchema = z.object({
  name: text(120),
  headline: optText(200),
  email: z
    .string()
    .trim()
    .max(254)
    .email("Enter a valid email")
    .nullish()
    .or(z.literal(""))
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+()\d\s.-]{5,40}$/, "Enter a valid phone number")
    .nullish()
    .or(z.literal(""))
    .transform((v) => v || null),
  location: optText(200),
});
export type ResumeHeader = z.infer<typeof headerSchema>;

export const sectionStateSchema = z.object({
  key: z.enum(SECTION_KEYS),
  visible: z.boolean().default(true),
  title: optText(60),
});

export const resumeDocumentSchema = z
  .object({
    schemaVersion: z.literal(RESUME_SCHEMA_VERSION).default(RESUME_SCHEMA_VERSION),
    header: headerSchema,
    summary: summarySchema.nullish().transform((v) => v ?? null),
    /** Alternate summaries the user keeps (only one is printed: `summary`) */
    summaryVariants: z.array(summarySchema).max(5).default([]),
    experience: z.array(experienceSchema).max(40).default([]),
    projects: z.array(projectSchema).max(40).default([]),
    education: z.array(educationSchema).max(20).default([]),
    skills: z.array(skillGroupSchema).max(20).default([]),
    certifications: z.array(certificationSchema).max(40).default([]),
    languages: z.array(languageSchema).max(20).default([]),
    links: z.array(linkSchema).max(12).default([]),
    additional: z.array(additionalSectionSchema).max(10).default([]),
    /** Section order and visibility */
    sections: z.array(sectionStateSchema).max(SECTION_KEYS.length),
  })
  .superRefine((doc, ctx) => {
    const seen = new Set<string>();
    for (const s of doc.sections) {
      if (seen.has(s.key))
        ctx.addIssue({ code: "custom", path: ["sections"], message: `Duplicate section ${s.key}` });
      seen.add(s.key);
    }
    const ids = new Set<string>();
    for (const id of allItemIds(doc as ResumeDocument)) {
      if (ids.has(id))
        ctx.addIssue({ code: "custom", path: ["items"], message: `Duplicate item id ${id}` });
      ids.add(id);
    }
  });
export type ResumeDocument = z.output<typeof resumeDocumentSchema>;
export type ResumeDocumentInput = z.input<typeof resumeDocumentSchema>;

export function allItemIds(doc: ResumeDocument): string[] {
  const ids: string[] = [];
  const push = (items: { id: string; bullets?: { id: string }[] }[]) => {
    for (const i of items) {
      ids.push(i.id);
      for (const b of i.bullets ?? []) ids.push(b.id);
    }
  };
  if (doc.summary) ids.push(doc.summary.id);
  for (const s of doc.summaryVariants) ids.push(s.id);
  push(doc.experience);
  push(doc.projects);
  push(doc.education);
  for (const g of doc.skills) {
    ids.push(g.id);
    for (const s of g.skills) ids.push(s.id);
  }
  push(doc.certifications);
  push(doc.languages);
  push(doc.links);
  push(doc.additional);
  return ids;
}

/** Every (itemId, factRef) pair — persisted to resume_fact_references. */
export function factReferences(doc: ResumeDocument): { itemId: string; factRef: string }[] {
  const out: { itemId: string; factRef: string }[] = [];
  const visit = (item: {
    id: string;
    factRefs?: string[];
    bullets?: { id: string; factRefs: string[] }[];
  }) => {
    for (const ref of item.factRefs ?? []) out.push({ itemId: item.id, factRef: ref });
    for (const b of item.bullets ?? [])
      for (const ref of b.factRefs) out.push({ itemId: b.id, factRef: ref });
  };
  if (doc.summary) visit(doc.summary);
  doc.experience.forEach(visit);
  doc.projects.forEach(visit);
  doc.education.forEach(visit);
  doc.skills.forEach((g) => g.skills.forEach(visit));
  doc.certifications.forEach(visit);
  doc.languages.forEach(visit);
  doc.links.forEach(visit);
  doc.additional.forEach((a) => a.bullets.forEach(visit));
  const seen = new Set<string>();
  return out.filter((r) => {
    const key = `${r.itemId}|${r.factRef}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function defaultSections(): ResumeDocument["sections"] {
  return SECTION_KEYS.map((key) => ({ key, visible: true, title: null }));
}

export function parseResumeDocument(value: unknown): ResumeDocument {
  return resumeDocumentSchema.parse(value);
}

let counter = 0;
/** Short unique item id (not a fact id; stable within the document). */
export function newItemId(prefix = "i"): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** Visible items only, in section order — what renderers and checks look at. */
export function visibleSections(doc: ResumeDocument): SectionKey[] {
  return doc.sections.filter((s) => s.visible).map((s) => s.key);
}

export function sectionTitle(doc: ResumeDocument, key: SectionKey): string {
  return doc.sections.find((s) => s.key === key)?.title || SECTION_TITLES[key];
}

/** All printed text of a document (visible items), for checks and keyword analysis. */
export function documentText(doc: ResumeDocument): string {
  const parts: string[] = [doc.header.name, doc.header.headline ?? ""];
  const vis = new Set(visibleSections(doc));
  if (vis.has("summary") && doc.summary && !doc.summary.hidden) parts.push(doc.summary.text);
  if (vis.has("experience"))
    for (const e of doc.experience.filter((x) => !x.hidden)) {
      parts.push(e.title, e.organization, e.description ?? "", ...e.technologies);
      parts.push(...e.bullets.filter((b) => !b.hidden).map((b) => b.text));
    }
  if (vis.has("projects"))
    for (const p of doc.projects.filter((x) => !x.hidden)) {
      parts.push(p.name, p.role ?? "", p.description ?? "", ...p.technologies);
      parts.push(...p.bullets.filter((b) => !b.hidden).map((b) => b.text));
    }
  if (vis.has("education"))
    for (const e of doc.education.filter((x) => !x.hidden))
      parts.push(e.institution, e.degree ?? "", e.fieldOfStudy ?? "", e.details ?? "");
  if (vis.has("skills"))
    for (const g of doc.skills.filter((x) => !x.hidden))
      parts.push(...g.skills.filter((s) => !s.hidden).map((s) => s.name));
  if (vis.has("certifications"))
    for (const c of doc.certifications.filter((x) => !x.hidden)) parts.push(c.name, c.issuer ?? "");
  if (vis.has("languages"))
    for (const l of doc.languages.filter((x) => !x.hidden)) parts.push(l.language);
  if (vis.has("additional"))
    for (const a of doc.additional.filter((x) => !x.hidden))
      parts.push(a.title, ...a.bullets.filter((b) => !b.hidden).map((b) => b.text));
  return parts.filter(Boolean).join("\n");
}
