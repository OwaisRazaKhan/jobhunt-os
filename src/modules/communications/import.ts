/**
 * Import of an existing email draft / cover letter (pasted text). Imported content is DATA:
 * HTML is reduced to text (never rendered or executed), control characters are removed, and the
 * result is structured into the canonical document. It is marked IMPORTED and must pass the same
 * claim validation and quality checks before approval.
 */
import { parseCommunicationDocument, type CommunicationDocument } from "./document";

export const IMPORT_MAX_CHARS = 20_000;

/** HTML/markup → plain text (tags dropped, common entities decoded, scripts/styles removed). */
export function toSafePlainText(input: string): string {
  return input
    .slice(0, IMPORT_MAX_CHARS)
    .replace(/<(script|style|iframe|object|embed|template)[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, "\n\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const GREETING = /^(dear|hi|hello|good (morning|afternoon|evening)|to whom)\b[^\n]{0,80},?$/i;
const CLOSING =
  /^(kind regards|best regards|warm regards|regards|best|sincerely|yours sincerely|yours faithfully|thank you|thanks|many thanks|cheers|respectfully)[,!.]?$/i;

export function parseImportedText(
  raw: string,
  kind: "EMAIL" | "COVER_LETTER",
  fallback: { greeting: string; signature: string; subject?: string },
): CommunicationDocument {
  const text = toSafePlainText(raw);
  let lines = text.split("\n").map((l) => l.trim());
  let subject = fallback.subject ?? "";
  const subjectIndex = lines.findIndex((l) => /^subject\s*:/i.test(l));
  if (subjectIndex >= 0) {
    subject = lines[subjectIndex]!.replace(/^subject\s*:\s*/i, "");
    lines.splice(subjectIndex, 1);
  }
  let greeting = fallback.greeting;
  const gi = lines.findIndex((l) => GREETING.test(l));
  let bodyStart = 0;
  if (gi >= 0 && gi < 12) {
    greeting = lines[gi]!;
    bodyStart = gi + 1;
  }
  let closing = "Kind regards,";
  let signature = fallback.signature;
  let bodyEnd = lines.length;
  for (let i = lines.length - 1; i > bodyStart; i--) {
    if (CLOSING.test(lines[i]!)) {
      closing = lines[i]!;
      const sig = lines
        .slice(i + 1)
        .filter(Boolean)
        .join("\n");
      if (sig) signature = sig;
      bodyEnd = i;
      break;
    }
  }
  lines = lines.slice(bodyStart, bodyEnd);
  const paragraphs = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\n/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, kind === "EMAIL" ? 20 : 12);
  return parseCommunicationDocument(
    kind === "EMAIL"
      ? {
          kind,
          subject: subject.slice(0, 200),
          greeting: greeting.slice(0, 200),
          bodyParagraphs: paragraphs.map((p) => p.slice(0, 3000)),
          closing: closing.slice(0, 120),
          signature: signature.slice(0, 1000),
        }
      : {
          kind,
          greeting: greeting.slice(0, 200),
          paragraphs: paragraphs.map((p) => p.slice(0, 4000)),
          closing: closing.slice(0, 120),
          signature: signature.slice(0, 1000),
        },
  );
}
