import { createHash } from "node:crypto";
import { parseCommunicationDocument, type CommunicationDocument } from "./document";

/**
 * Content identity (approval hash): SHA-256 over the normalized content fields.
 *   email:        subject + greeting + body + closing + signature
 *   cover letter: header + recipient + date + greeting + body + closing + signature
 * Whitespace inside lines is collapsed and line endings normalized, so cosmetic whitespace
 * differences never change the hash; any wording change does.
 */
function norm(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .trim();
}

export function communicationContentHash(input: CommunicationDocument): string {
  const doc = parseCommunicationDocument(input);
  const fields =
    doc.kind === "EMAIL"
      ? [
          "EMAIL",
          norm(doc.subject),
          norm(doc.greeting),
          ...doc.bodyParagraphs.map(norm),
          norm(doc.closing),
          norm(doc.signature),
        ]
      : [
          "COVER_LETTER",
          norm(doc.header.name),
          norm(doc.header.email),
          norm(doc.header.phone),
          norm(doc.header.location),
          ...doc.header.links.map(norm),
          norm(doc.date),
          norm(doc.recipient.name),
          norm(doc.recipient.title),
          norm(doc.recipient.company),
          norm(doc.greeting),
          ...doc.paragraphs.map(norm),
          norm(doc.closing),
          norm(doc.signature),
        ];
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** Generation-context hash: did the inputs behind a version materially change? */
export function contextHash(parts: Record<string, unknown>): string {
  const keys = Object.keys(parts).sort();
  return createHash("sha256")
    .update(JSON.stringify(keys.map((k) => [k, parts[k] ?? null])))
    .digest("hex");
}
