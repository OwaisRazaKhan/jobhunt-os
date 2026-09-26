import { createHash } from "node:crypto";
import { parseResumeDocument, type ResumeDocument } from "./document";

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * Content identity: SHA-256 of the canonical normalized document. Edit timestamps are
 * excluded so identical wording hashes identically; ids and order are included.
 */
export function resumeContentHash(doc: ResumeDocument): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== "editedAt")
          .map(([k, x]) => [k, strip(x)]),
      );
    }
    return typeof v === "string" ? v.normalize("NFC") : v;
  };
  return createHash("sha256")
    .update(canonicalJson(strip(parseResumeDocument(doc))))
    .digest("hex");
}
