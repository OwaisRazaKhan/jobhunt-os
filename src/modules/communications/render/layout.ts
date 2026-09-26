/**
 * Cover-letter render model. The HTML preview, the PDF renderer and the DOCX renderer all consume
 * this one model (and the Phase 6 template tokens), so the preview shows what is exported.
 */
import { getTemplate, type ResumeTemplate } from "@/modules/resumes/templates";
import type { CoverLetterDocument } from "../document";
import type { CoverLetterTemplate } from "../types";

export interface LetterModel {
  name: string | null;
  contact: { text: string; link: string | null }[];
  date: string | null;
  recipient: string[];
  greeting: string;
  paragraphs: string[];
  closing: string;
  signature: string[];
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatLetterDate(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || !MONTHS[m - 1]) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function buildLetterModel(doc: CoverLetterDocument): LetterModel {
  const contact: LetterModel["contact"] = [];
  if (doc.header.email)
    contact.push({ text: doc.header.email, link: `mailto:${doc.header.email}` });
  if (doc.header.phone) contact.push({ text: doc.header.phone, link: null });
  if (doc.header.location) contact.push({ text: doc.header.location, link: null });
  for (const url of doc.header.links)
    contact.push({ text: url.replace(/^https?:\/\//, "").replace(/\/$/, ""), link: url });
  return {
    name: doc.header.name,
    contact,
    date: formatLetterDate(doc.date),
    recipient: [doc.recipient.name, doc.recipient.title, doc.recipient.company].filter(
      (v): v is string => Boolean(v),
    ),
    greeting: doc.greeting,
    paragraphs: doc.paragraphs.filter((p) => p.trim()),
    closing: doc.closing,
    signature: doc.signature
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  };
}

/** Restrained letter templates built on the Phase 6 tokens (no graphics, logos or bars). */
export function letterTemplate(
  key: CoverLetterTemplate | string,
): ResumeTemplate & { letterBody: number; paragraphGap: number } {
  switch (key) {
    case "MODERN":
      return { ...getTemplate("MODERN"), letterBody: 10.5, paragraphGap: 9 };
    case "MINIMAL":
      return {
        ...getTemplate("TECHNICAL"),
        accent: "#111111",
        sectionStyle: "plain",
        nameAlign: "left",
        nameSize: 16,
        margin: 60,
        letterBody: 10.5,
        paragraphGap: 9,
      };
    case "EDITORIAL":
      return { ...getTemplate("EDITORIAL"), letterBody: 11, paragraphGap: 10 };
    default:
      return { ...getTemplate("CLASSIC"), letterBody: 11, paragraphGap: 9 };
  }
}

export function renderLetterPlainText(model: LetterModel): string {
  const blocks: string[] = [];
  const head = [model.name, model.contact.map((c) => c.text).join(" | ")]
    .filter(Boolean)
    .join("\n");
  if (head) blocks.push(head);
  if (model.date) blocks.push(model.date);
  if (model.recipient.length) blocks.push(model.recipient.join("\n"));
  if (model.greeting) blocks.push(model.greeting);
  blocks.push(...model.paragraphs);
  blocks.push([model.closing, ...model.signature].filter(Boolean).join("\n"));
  return blocks.join("\n\n");
}
