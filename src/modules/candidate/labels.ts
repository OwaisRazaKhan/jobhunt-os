import type { Comparable, DuplicateKind } from "./duplicates";
import { optionLabel } from "./options";
import type { SectionKind } from "./schemas";

/** Human-readable one-line labels for facts. Pure; used by UI, review and knowledge retrieval. */

type Loose = Record<string, unknown>;
const s = (value: unknown) => (typeof value === "string" ? value : "");

let regionNames: Intl.DisplayNames | undefined;
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function truncate(value: string, max = 120) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function factLabel(kind: SectionKind | "profile", input: object): string {
  const record = input as Loose;
  switch (kind) {
    case "education": {
      const degree = [s(record.degree), s(record.fieldOfStudy)].filter(Boolean).join(" in ");
      return degree ? `${degree} — ${s(record.institution)}` : s(record.institution);
    }
    case "experience":
      return `${s(record.title)} — ${s(record.organization)}`;
    case "achievement":
      return truncate(s(record.statement));
    case "project":
      return s(record.name);
    case "skill":
      return s(record.name);
    case "certification":
      return record.issuer ? `${s(record.name)} — ${s(record.issuer)}` : s(record.name);
    case "portfolio":
      return s(record.title) || s(record.url);
    case "language":
      return record.proficiency
        ? `${s(record.language)} (${optionLabel(s(record.proficiency))})`
        : s(record.language);
    case "authorization":
      return `${countryName(s(record.countryCode))} — ${optionLabel(s(record.status))}`;
    case "profile":
      return `${optionLabel(profileFieldKey(s(record.field)))}: ${truncate(s(record.value), 80)}`;
  }
}

function profileFieldKey(field: string) {
  return field.replace(/([A-Z])/g, "_$1").toUpperCase();
}

const DUPLICATE_KINDS: ReadonlySet<string> = new Set([
  "education",
  "experience",
  "skill",
  "project",
  "portfolio",
  "certification",
  "language",
]);

/** Identity used for duplicate detection, or null for kinds that are not de-duplicated. */
export function toComparable(
  kind: SectionKind | "profile",
  id: string,
  input: object,
): Comparable | null {
  const record = input as Loose;
  if (!DUPLICATE_KINDS.has(kind)) return null;
  const dk = kind as DuplicateKind;
  const label = factLabel(kind, record);
  switch (dk) {
    case "education":
      return {
        id,
        kind: dk,
        label,
        primary: s(record.institution),
        secondary: s(record.degree) || undefined,
      };
    case "experience":
      return {
        id,
        kind: dk,
        label,
        primary: s(record.organization),
        secondary: s(record.title) || undefined,
      };
    case "skill":
      return { id, kind: dk, label, primary: s(record.name) };
    case "project":
      return { id, kind: dk, label, primary: s(record.name) };
    case "portfolio":
      return {
        id,
        kind: dk,
        label,
        primary:
          s(record.url)
            .replace(/^https?:\/\/(www\.)?/, "")
            .replace(/\/$/, "") || s(record.title),
      };
    case "certification":
      return {
        id,
        kind: dk,
        label,
        primary: s(record.name),
        secondary: s(record.issuer) || undefined,
      };
    case "language":
      return { id, kind: dk, label, primary: s(record.language) };
  }
}
