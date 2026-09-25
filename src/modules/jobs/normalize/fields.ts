/**
 * Field normalisers (pure). Unknown or ambiguous input maps to UNKNOWN / null.
 */

export type EmploymentType =
  | "FULL_TIME"
  | "PART_TIME"
  | "CONTRACT"
  | "TEMPORARY"
  | "INTERNSHIP"
  | "APPRENTICESHIP"
  | "FREELANCE"
  | "UNKNOWN";
export type RemoteStatus = "REMOTE" | "HYBRID" | "ONSITE" | "UNKNOWN";
export type SalaryPeriod = "YEAR" | "MONTH" | "WEEK" | "HOUR";

export function normalizeEmploymentType(raw: string | null | undefined): EmploymentType {
  if (!raw) return "UNKNOWN";
  const v = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (/apprentice/.test(v)) return "APPRENTICESHIP";
  if (/intern|trainee|werkstudent|working ?student/.test(v)) return "INTERNSHIP";
  if (/freelance/.test(v)) return "FREELANCE";
  if (/temp|seasonal|fixedterm/.test(v)) return "TEMPORARY";
  if (/contract|contractor/.test(v)) return "CONTRACT";
  if (/parttime/.test(v)) return "PART_TIME";
  if (/fulltime|permanent/.test(v)) return "FULL_TIME";
  return "UNKNOWN";
}

/** Structured workplace fields from sources (authoritative when present). */
export function normalizeWorkplace(raw: string | null | undefined): RemoteStatus {
  if (!raw) return "UNKNOWN";
  const v = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (v === "remote") return "REMOTE";
  if (v === "hybrid") return "HYBRID";
  if (v === "onsite" || v === "inoffice" || v === "office") return "ONSITE";
  return "UNKNOWN";
}

export interface ParsedSalary {
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

const SYMBOLS: Record<string, string> = {
  "€": "EUR",
  "£": "GBP",
  $: "USD",
  "¥": "JPY",
  "₹": "INR",
};
const CODE = "(EUR|USD|GBP|CHF|CAD|AUD|AED|QAR|SAR|SEK|DKK|NOK|PLN|CZK|INR|SGD|JPY|NZD|ZAR)";

function amount(value: string, k: string | undefined): number | null {
  const n = Number(value.replace(/[,\s](?=\d{3}\b)/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(k ? n * 1000 : n);
}

function periodOf(text: string): SalaryPeriod | null {
  if (/(\/|per |a |an |each )\s*(year|yr|annum)|annual(ly)?|\bp\.?a\.?\b|yearly/i.test(text))
    return "YEAR";
  if (/(\/|per |a |each )\s*(month|mo)\b|monthly/i.test(text)) return "MONTH";
  if (/(\/|per |a |each )\s*(week|wk)\b|weekly/i.test(text)) return "WEEK";
  if (/(\/|per |an |each )\s*(hour|hr)\b|hourly/i.test(text)) return "HOUR";
  return null;
}

/**
 * Parse an EXPLICIT salary statement such as "€50,000–€65,000/year" or
 * "AED 12,000 per month". Returns null when no unambiguous amount + currency
 * is present. No conversion, no estimation. "$" alone is read as USD only
 * because it is the literal symbol used; other dollar currencies must be explicit.
 */
export function parseSalaryText(text: string | null | undefined): ParsedSalary | null {
  if (!text) return null;
  const t = text.replace(/ | /g, " ");
  const num = "(\\d{1,3}(?:[,\\s]\\d{3})+|\\d+(?:\\.\\d+)?)\\s*([kK])?";
  const cur = `(?:([€£$¥₹])|${CODE})`;
  const range = new RegExp(
    `${cur}\\s?${num}(?:\\s*(?:-|–|—|to)\\s*${cur}?\\s?${num})?(?:\\s*${CODE})?`,
    "i",
  );
  const m = t.match(range);
  if (!m) {
    // "50,000 - 65,000 EUR"
    const trailing = new RegExp(`${num}\\s*(?:-|–|—|to)\\s*${num}\\s*${CODE}`, "i").exec(t);
    if (!trailing) return null;
    const min = amount(trailing[1]!, trailing[2]);
    const max = amount(trailing[3]!, trailing[4]);
    if (min == null || max == null || min > max) return null;
    return { min, max, currency: trailing[5]!.toUpperCase(), period: periodOf(t) };
  }
  const currency =
    (m[1] ? SYMBOLS[m[1]] : m[2]?.toUpperCase()) ?? (m[9] ? m[9].toUpperCase() : null);
  if (!currency) return null;
  const min = amount(m[3]!, m[4]);
  const max = m[7] ? amount(m[7], m[8]) : null;
  if (min == null) return null;
  if (max != null && max < min) return null;
  return { min, max, currency, period: periodOf(t) };
}

/** Map interval strings from structured sources ("1 YEAR", "per-year-salary", "hourly"). */
export function normalizeInterval(raw: string | null | undefined): SalaryPeriod | null {
  if (!raw) return null;
  const v = raw.toLowerCase();
  if (/year|annual/.test(v)) return "YEAR";
  if (/month/.test(v)) return "MONTH";
  if (/week/.test(v)) return "WEEK";
  if (/hour/.test(v)) return "HOUR";
  return null;
}

/**
 * Capture explicit visa / work-authorisation wording verbatim (max 3 sentences).
 * This is evidence only — no interpretation or eligibility decision.
 */
export function extractVisaWording(text: string | null | undefined): string | null {
  if (!text) return null;
  const sentences = text.split(/(?<=[.!?])\s+|\n+/);
  const hits = sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 10 && s.length <= 500)
    .filter((s) =>
      /\b(visa|sponsor(ship|ed|ing)?|work authori[sz]ation|authori[sz]ed to work|right to work|work permit|residence permit|blue card|eligible to work)\b/i.test(
        s,
      ),
    );
  if (hits.length === 0) return null;
  return Array.from(new Set(hits)).slice(0, 3).join(" ").slice(0, 2000);
}
