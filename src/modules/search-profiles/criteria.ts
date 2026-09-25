/**
 * Pure search-profile logic (no I/O): experience wording, category classification and
 * profile evaluation. Every decision records WHY, and anything the source does not state
 * stays UNKNOWN — it is only included when the profile explicitly asks for UNKNOWN.
 */
import type { ExperienceLevel, LocationKind, VisaPreference } from "./types";

export const CLASSIFIER_VERSION = "rules-v1";

// --- Text helpers ---------------------------------------------------------------

export function foldText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-word/phrase match on folded text ("SEO" never matches "seoul"). */
export function termRegex(term: string): RegExp | null {
  const folded = foldText(term);
  if (!folded) return null;
  const words = folded.split(" ");
  // Long single words also match split spellings ("frontend" ~ "front-end", "e commerce").
  const body =
    words.length === 1 && folded.length >= 6
      ? [...folded].map(escapeRegExp).join("[\\s-]?")
      : words.map(escapeRegExp).join("[\\s-]*");
  return new RegExp(`(?:^|[^a-z0-9])${body}(?:$|[^a-z0-9])`);
}

export function matchTerms(text: string, terms: readonly string[]): string[] {
  const folded = ` ${foldText(text)} `;
  const hits: string[] = [];
  for (const term of terms) {
    const re = termRegex(term);
    if (re && re.test(folded) && !hits.includes(term)) hits.push(term);
  }
  return hits;
}

// --- Experience level (explicit wording only) -------------------------------------

const EXPERIENCE_RULES: { level: ExperienceLevel; re: RegExp }[] = [
  {
    level: "INTERNSHIP",
    re: /\b(intern|internship|werkstudent|working student|stagiaire|praktikum|praktikant(?:in)?)\b/i,
  },
  {
    level: "GRADUATE",
    re: /\b(graduate|new grad|trainee|management trainee|graduate programme|graduate program)\b/i,
  },
  { level: "ENTRY_LEVEL", re: /\b(entry[\s-]?level|fresher|freshers)\b/i },
  { level: "JUNIOR", re: /\b(junior|jr\.?)\b/i },
  {
    level: "LEAD",
    re: /\b(lead(?![\s-]*gen)|head of|principal|staff|director|vp|vice president)\b/i,
  },
  { level: "SENIOR", re: /\b(senior|sr\.?)\b/i },
  { level: "MID_LEVEL", re: /\b(mid[\s-]?level|intermediate)\b/i },
];

/** Experience level from explicit wording in the job title (else UNKNOWN). */
export function experienceFromTitle(title: string): { level: ExperienceLevel; raw: string | null } {
  for (const rule of EXPERIENCE_RULES) {
    const m = title.match(rule.re);
    if (m) return { level: rule.level, raw: m[0].slice(0, 100) };
  }
  return { level: "UNKNOWN", raw: null };
}

// --- Category classification ------------------------------------------------------

export interface CategoryTerms {
  id: string;
  terms: readonly string[];
}

export interface CategoryHit {
  categoryId: string;
  matchedTerms: string[];
  confidence: number;
}

/**
 * Rule classification from the job title (strong) and department/team (weaker).
 * A job may legitimately belong to several categories; none is forced.
 */
export function classifyJob(
  job: { title: string; department?: string | null; team?: string | null },
  categories: readonly CategoryTerms[],
): CategoryHit[] {
  const side = [job.department, job.team].filter(Boolean).join(" ");
  const hits: CategoryHit[] = [];
  for (const category of categories) {
    const inTitle = matchTerms(job.title, category.terms);
    const inSide = side ? matchTerms(side, category.terms).filter((t) => !inTitle.includes(t)) : [];
    if (inTitle.length === 0 && inSide.length === 0) continue;
    hits.push({
      categoryId: category.id,
      matchedTerms: [...inTitle, ...inSide].slice(0, 20),
      confidence: inTitle.length > 0 ? 0.9 : 0.6,
    });
  }
  return hits;
}

// --- Profile evaluation -------------------------------------------------------------

export interface ProfileLocation {
  id: string;
  countryCode: string;
  name: string;
  kind: LocationKind;
  aliases: readonly string[];
}

export interface ProfileCriteria {
  countryCodes: readonly string[];
  locations: readonly ProfileLocation[];
  /** Union of the selected categories' terms (system + user) and the profile's own terms */
  categoryIds: readonly string[];
  terms: readonly string[];
  workModes: readonly string[];
  employmentTypes: readonly string[];
  experienceLevels: readonly string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  visaPreference: VisaPreference;
}

export interface EvaluableJob {
  title: string;
  department?: string | null;
  team?: string | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  locationRaw: string;
  remoteStatus: string;
  employmentType: string;
  experienceLevel: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  visaTextRaw?: string | null;
  /** Category ids this job is classified into (system + the user's own) */
  categoryIds: readonly string[];
}

export type SalaryComparison =
  | "WITHIN_RANGE"
  | "BELOW_MINIMUM"
  | "ABOVE_MAXIMUM"
  | "NOT_STATED"
  | "CURRENCY_NOT_COMPARABLE"
  | "PERIOD_NOT_COMPARABLE"
  | "NOT_REQUESTED";

export interface EvaluationReasons {
  country?: string;
  location?: string;
  category?: { categoryIds: string[]; terms: string[] };
  workMode?: string;
  employmentType?: string;
  experienceLevel?: string;
  salary: SalaryComparison;
  visa?: string;
}

export interface Evaluation {
  matched: boolean;
  /** First criterion that excluded the job (null when matched) */
  failed: keyof EvaluationReasons | null;
  reasons: EvaluationReasons;
}

function inSet(set: readonly string[], value: string) {
  return set.length === 0 || set.includes(value);
}

function locationMatches(job: EvaluableJob, loc: ProfileLocation): boolean {
  if (loc.kind === "REMOTE_COUNTRY")
    return job.remoteStatus === "REMOTE" && job.countryCode === loc.countryCode;
  if (job.countryCode !== loc.countryCode) return false;
  const names = [loc.name, ...loc.aliases].map(foldText).filter(Boolean);
  const places = [job.city, job.region].map(foldText).filter(Boolean);
  if (places.some((p) => names.includes(p))) return true;
  // Fall back to the verbatim location text (e.g. "Bengaluru, Karnataka, India").
  const raw = ` ${foldText(job.locationRaw)} `;
  return names.some((n) => termRegex(n)?.test(raw));
}

export function compareSalary(
  criteria: Pick<ProfileCriteria, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">,
  job: Pick<EvaluableJob, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod">,
): SalaryComparison {
  if (criteria.salaryMin == null && criteria.salaryMax == null) return "NOT_REQUESTED";
  if (job.salaryMin == null && job.salaryMax == null) return "NOT_STATED";
  // Never compare different currencies and never invent an exchange rate.
  if (!job.salaryCurrency || job.salaryCurrency !== criteria.salaryCurrency)
    return "CURRENCY_NOT_COMPARABLE";
  if (criteria.salaryPeriod && job.salaryPeriod !== criteria.salaryPeriod)
    return "PERIOD_NOT_COMPARABLE";
  const jobTop = job.salaryMax ?? job.salaryMin!;
  const jobBottom = job.salaryMin ?? job.salaryMax!;
  if (criteria.salaryMin != null && jobTop < criteria.salaryMin) return "BELOW_MINIMUM";
  if (criteria.salaryMax != null && jobBottom > criteria.salaryMax) return "ABOVE_MAXIMUM";
  return "WITHIN_RANGE";
}

/**
 * Does a job satisfy a search profile? Rules:
 *  - empty selection = any value; UNKNOWN is only included when explicitly selected
 *  - a country filter needs a known country (unknown stays unknown, never assumed)
 *  - locations constrain only jobs in the location's own country
 *  - salary excludes only a comparable (same currency + period) out-of-range salary;
 *    missing or non-comparable salary is kept and labelled
 *  - visa is informational (eligibility is a later matching concern), never a filter
 */
export function evaluateJob(criteria: ProfileCriteria, job: EvaluableJob): Evaluation {
  const reasons: EvaluationReasons = { salary: "NOT_REQUESTED" };
  const fail = (key: keyof EvaluationReasons): Evaluation => ({
    matched: false,
    failed: key,
    reasons,
  });

  if (criteria.countryCodes.length > 0) {
    if (!job.countryCode) {
      reasons.country = "Country not stated by source";
      return fail("country");
    }
    if (!criteria.countryCodes.includes(job.countryCode)) {
      reasons.country = `${job.countryCode} not in profile`;
      return fail("country");
    }
    reasons.country = job.countryCode;
  }

  const locationsHere = criteria.locations.filter((l) => l.countryCode === job.countryCode);
  if (locationsHere.length > 0) {
    const hit = locationsHere.find((l) => locationMatches(job, l));
    if (!hit) {
      reasons.location = `Not in ${locationsHere.map((l) => l.name).join(", ")}`;
      return fail("location");
    }
    reasons.location = hit.name;
  }

  if (!inSet(criteria.workModes, job.remoteStatus)) {
    reasons.workMode = `${job.remoteStatus} not selected`;
    return fail("workMode");
  }
  if (criteria.workModes.length) reasons.workMode = job.remoteStatus;

  if (!inSet(criteria.employmentTypes, job.employmentType)) {
    reasons.employmentType = `${job.employmentType} not selected`;
    return fail("employmentType");
  }
  if (criteria.employmentTypes.length) reasons.employmentType = job.employmentType;

  if (!inSet(criteria.experienceLevels, job.experienceLevel)) {
    reasons.experienceLevel = `${job.experienceLevel} not selected`;
    return fail("experienceLevel");
  }
  if (criteria.experienceLevels.length) reasons.experienceLevel = job.experienceLevel;

  if (criteria.categoryIds.length > 0 || criteria.terms.length > 0) {
    const categoryIds = job.categoryIds.filter((id) => criteria.categoryIds.includes(id));
    const text = [job.title, job.department, job.team].filter(Boolean).join(" ");
    const terms = matchTerms(text, criteria.terms).slice(0, 10);
    if (categoryIds.length === 0 && terms.length === 0) {
      reasons.category = { categoryIds: [], terms: [] };
      return fail("category");
    }
    reasons.category = { categoryIds, terms };
  }

  reasons.salary = compareSalary(criteria, job);
  if (reasons.salary === "BELOW_MINIMUM" || reasons.salary === "ABOVE_MAXIMUM")
    return fail("salary");

  if (criteria.visaPreference !== "UNKNOWN") {
    reasons.visa = job.visaTextRaw
      ? "Source mentions visa/sponsorship — review wording"
      : "Not stated by source";
  }
  return { matched: true, failed: null, reasons };
}
