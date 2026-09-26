import { z } from "zod";

/**
 * Canonical communication content (schema v1). Structured — never stored as HTML only.
 * Drafts may be incomplete (empty subject/body); the quality engine reports what is missing
 * and approval requires completeness. Every string is plain text (rendered escaped).
 */

export const COMMUNICATION_SCHEMA_VERSION = 1;

/** Plain text: control characters removed (except newlines/tabs), trimmed at the ends. */
const plain = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) =>
      v
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
        .replace(/\r\n?/g, "\n")
        .trim(),
    );

const optPlain = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => {
      const t = v?.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
      return t ? t : null;
    });

export const emailDocumentSchema = z.object({
  schemaVersion: z.literal(COMMUNICATION_SCHEMA_VERSION).default(COMMUNICATION_SCHEMA_VERSION),
  kind: z.literal("EMAIL"),
  subject: plain(200),
  greeting: plain(200),
  bodyParagraphs: z.array(plain(3000)).max(20).default([]),
  closing: plain(120),
  signature: plain(1000),
});
export type EmailDocument = z.output<typeof emailDocumentSchema>;

export const coverLetterDocumentSchema = z.object({
  schemaVersion: z.literal(COMMUNICATION_SCHEMA_VERSION).default(COMMUNICATION_SCHEMA_VERSION),
  kind: z.literal("COVER_LETTER"),
  header: z
    .object({
      name: optPlain(120),
      email: optPlain(254),
      phone: optPlain(40),
      location: optPlain(200),
      links: z
        .array(
          z
            .string()
            .trim()
            .max(2048)
            .refine((v) => /^https?:\/\/[^\s<>"']+$/i.test(v), "Use a full http(s) link"),
        )
        .max(4)
        .default([]),
    })
    .default({ name: null, email: null, phone: null, location: null, links: [] }),
  /** ISO date (YYYY-MM-DD) or null */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish()
    .transform((v) => v ?? null),
  recipient: z
    .object({ name: optPlain(200), title: optPlain(200), company: optPlain(200) })
    .default({ name: null, title: null, company: null }),
  greeting: plain(200),
  paragraphs: z.array(plain(4000)).max(12).default([]),
  closing: plain(120),
  signature: plain(1000),
});
export type CoverLetterDocument = z.output<typeof coverLetterDocumentSchema>;

export const communicationDocumentSchema = z.discriminatedUnion("kind", [
  emailDocumentSchema,
  coverLetterDocumentSchema,
]);
export type CommunicationDocument = z.output<typeof communicationDocumentSchema>;
export type CommunicationDocumentInput = z.input<typeof communicationDocumentSchema>;

export function parseCommunicationDocument(value: unknown): CommunicationDocument {
  return communicationDocumentSchema.parse(value);
}

/** Clean plain-text rendering (copy/export, and later Phase 8/10). Never HTML. */
export function toPlainText(
  doc: CommunicationDocument,
  opts: { includeSubject?: boolean } = {},
): string {
  const blocks: string[] = [];
  if (doc.kind === "EMAIL") {
    if (opts.includeSubject !== false && doc.subject) blocks.push(`Subject: ${doc.subject}`);
    if (doc.greeting) blocks.push(doc.greeting);
    blocks.push(...doc.bodyParagraphs.filter(Boolean));
  } else {
    const head = [
      doc.header.name,
      doc.header.email,
      doc.header.phone,
      doc.header.location,
      ...doc.header.links,
    ]
      .filter(Boolean)
      .join(" | ");
    if (head) blocks.push(head);
    if (doc.date) blocks.push(doc.date);
    const to = [doc.recipient.name, doc.recipient.title, doc.recipient.company]
      .filter(Boolean)
      .join("\n");
    if (to) blocks.push(to);
    if (doc.greeting) blocks.push(doc.greeting);
    blocks.push(...doc.paragraphs.filter(Boolean));
  }
  const sign = [doc.closing, doc.signature].filter(Boolean).join("\n");
  if (sign) blocks.push(sign);
  return blocks.join("\n\n");
}

/** Body paragraphs regardless of kind. */
export function paragraphsOf(doc: CommunicationDocument): string[] {
  return doc.kind === "EMAIL" ? doc.bodyParagraphs : doc.paragraphs;
}
