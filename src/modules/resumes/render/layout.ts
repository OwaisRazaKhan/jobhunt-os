/**
 * Render model: ResumeDocument → ordered, visible blocks. The HTML preview, the PDF renderer
 * and the DOCX renderer all consume this one model, so what you preview is what you export.
 * Only visible sections/items with content are included; nothing decorative is added.
 */
import { sectionTitle, visibleSections, type ResumeDocument, type SectionKey } from "../document";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPartialDate(value: string | null): string | null {
  if (!value) return null;
  const [y, m] = value.split("-");
  const month = m ? MONTHS[Number(m) - 1] : undefined;
  return month ? `${month} ${y}` : (y ?? null);
}

export function formatRange(
  start: string | null,
  end: string | null,
  current: boolean,
): string | null {
  const a = formatPartialDate(start);
  const b = current ? "Present" : formatPartialDate(end);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a ?? b ?? null;
}

export interface RenderLink {
  label: string;
  url: string;
}

export interface RenderEntry {
  id: string;
  /** Primary line, e.g. job title or institution */
  title: string;
  /** Secondary line, e.g. organization or degree */
  subtitle: string | null;
  dates: string | null;
  location: string | null;
  description: string | null;
  bullets: { id: string; text: string }[];
  /** e.g. "Technologies: React, Node.js" */
  meta: string | null;
  link: RenderLink | null;
}

export interface RenderSection {
  key: SectionKey;
  title: string;
  /** "entries" (experience, projects, …), "paragraph" (summary), "inline" (skills/languages groups) */
  kind: "entries" | "paragraph" | "inline";
  paragraph?: string;
  inline?: { label: string | null; text: string }[];
  entries?: RenderEntry[];
}

export interface RenderModel {
  name: string;
  headline: string | null;
  contact: string[];
  links: RenderLink[];
  sections: RenderSection[];
}

const visible = <T extends { hidden: boolean }>(items: T[]) => items.filter((i) => !i.hidden);

export function buildRenderModel(doc: ResumeDocument): RenderModel {
  const shown = new Set(visibleSections(doc));
  const sections: RenderSection[] = [];
  const links = shown.has("links")
    ? visible(doc.links).map((l) => ({ label: l.label, url: l.url }))
    : [];

  for (const key of visibleSections(doc)) {
    const title = sectionTitle(doc, key);
    switch (key) {
      case "summary":
        if (doc.summary && !doc.summary.hidden)
          sections.push({ key, title, kind: "paragraph", paragraph: doc.summary.text });
        break;
      case "experience": {
        const entries = visible(doc.experience).map((e) => ({
          id: e.id,
          title: e.title,
          subtitle: e.organization,
          dates: formatRange(e.startDate, e.endDate, e.isCurrent),
          location: e.location,
          description: e.description,
          bullets: visible(e.bullets).map((b) => ({ id: b.id, text: b.text })),
          meta: e.technologies.length ? `Technologies: ${e.technologies.join(", ")}` : null,
          link: null,
        }));
        if (entries.length) sections.push({ key, title, kind: "entries", entries });
        break;
      }
      case "projects": {
        const entries = visible(doc.projects).map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: p.role,
          dates: formatRange(p.startDate, p.endDate, p.isCurrent),
          location: null,
          description: p.description,
          bullets: visible(p.bullets).map((b) => ({ id: b.id, text: b.text })),
          meta: p.technologies.length ? `Technologies: ${p.technologies.join(", ")}` : null,
          link: p.url
            ? { label: p.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), url: p.url }
            : null,
        }));
        if (entries.length) sections.push({ key, title, kind: "entries", entries });
        break;
      }
      case "education": {
        const entries = visible(doc.education).map((e) => ({
          id: e.id,
          title: e.institution,
          subtitle: [e.degree, e.fieldOfStudy].filter(Boolean).join(", ") || null,
          dates: formatRange(e.startDate, e.endDate, e.isCurrent),
          location: e.location,
          description: e.details,
          bullets: [],
          meta: e.grade ? `Grade: ${e.grade}` : null,
          link: null,
        }));
        if (entries.length) sections.push({ key, title, kind: "entries", entries });
        break;
      }
      case "skills": {
        const inline = visible(doc.skills)
          .map((g) => ({
            label: g.label,
            text: visible(g.skills)
              .map((s) => s.name)
              .join(", "),
          }))
          .filter((g) => g.text);
        if (inline.length) sections.push({ key, title, kind: "inline", inline });
        break;
      }
      case "certifications": {
        const entries = visible(doc.certifications).map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: c.issuer,
          dates:
            formatPartialDate(c.issueDate) && c.expiryDate
              ? `${formatPartialDate(c.issueDate)} – ${formatPartialDate(c.expiryDate)}`
              : formatPartialDate(c.issueDate),
          location: null,
          description: null,
          bullets: [],
          meta: c.credentialId ? `Credential ID: ${c.credentialId}` : null,
          link: c.url ? { label: "Credential", url: c.url } : null,
        }));
        if (entries.length) sections.push({ key, title, kind: "entries", entries });
        break;
      }
      case "languages": {
        const text = visible(doc.languages)
          .map((l) => (l.proficiency ? `${l.language} (${l.proficiency})` : l.language))
          .join(", ");
        if (text) sections.push({ key, title, kind: "inline", inline: [{ label: null, text }] });
        break;
      }
      case "links":
        // Rendered in the header contact block.
        break;
      case "additional":
        for (const a of visible(doc.additional)) {
          const bullets = visible(a.bullets).map((b) => ({ id: b.id, text: b.text }));
          if (bullets.length) {
            sections.push({
              key,
              title: a.title,
              kind: "entries",
              entries: [
                {
                  id: a.id,
                  title: "",
                  subtitle: null,
                  dates: null,
                  location: null,
                  description: null,
                  bullets,
                  meta: null,
                  link: null,
                },
              ],
            });
          }
        }
        break;
    }
  }

  return {
    name: doc.header.name,
    headline: doc.header.headline,
    contact: [doc.header.email, doc.header.phone, doc.header.location].filter((x): x is string =>
      Boolean(x),
    ),
    links,
    sections,
  };
}

/** Plain-text rendering (used for checks, keyword analysis and export content verification). */
export function renderPlainText(model: RenderModel): string {
  const lines: string[] = [model.name];
  if (model.headline) lines.push(model.headline);
  lines.push([...model.contact, ...model.links.map((l) => l.url)].join(" | "));
  for (const s of model.sections) {
    lines.push("", s.title.toUpperCase());
    if (s.paragraph) lines.push(s.paragraph);
    for (const i of s.inline ?? []) lines.push(i.label ? `${i.label}: ${i.text}` : i.text);
    for (const e of s.entries ?? []) {
      const head = [e.title, e.subtitle].filter(Boolean).join(" — ");
      if (head) lines.push([head, e.location, e.dates].filter(Boolean).join(" | "));
      if (e.description) lines.push(e.description);
      for (const b of e.bullets) lines.push(`- ${b.text}`);
      if (e.meta) lines.push(e.meta);
      if (e.link) lines.push(e.link.url);
    }
  }
  return lines.join("\n");
}
