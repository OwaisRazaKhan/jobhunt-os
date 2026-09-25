/**
 * Closed option sets for candidate data. Client-safe (no server imports).
 * Values are stored as-is; labels are derived for display.
 */

export const SKILL_CATEGORIES = [
  "TECHNICAL",
  "WEB",
  "AI",
  "AUTOMATION",
  "TOOLS",
  "DESIGN",
  "CREATIVE",
  "CONTENT",
  "MARKETING",
  "SALES",
  "BUSINESS",
  "SOFT_SKILLS",
  "LANGUAGES",
  "OTHER",
] as const;

export const EMPLOYMENT_TYPES = [
  "FULL_TIME",
  "PART_TIME",
  "CONTRACT",
  "FREELANCE",
  "INTERNSHIP",
  "SELF_EMPLOYED",
  "TEMPORARY",
  "VOLUNTEER",
] as const;

export const PROJECT_TYPES = [
  "PERSONAL",
  "CLIENT",
  "PROFESSIONAL",
  "BUSINESS",
  "ACADEMIC",
  "OPEN_SOURCE",
  "HACKATHON",
  "OTHER",
] as const;

export const PORTFOLIO_TYPES = [
  "WEBSITE",
  "GITHUB_REPOSITORY",
  "CASE_STUDY",
  "CAMPAIGN",
  "VIDEO",
  "DESIGN",
  "PROJECT",
  "BUSINESS",
  "PUBLICATION",
  "OTHER",
] as const;

export const LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "NATIVE"] as const;

export const WORK_AUTHORIZATION_STATUSES = [
  "AUTHORIZED",
  "NOT_AUTHORIZED",
  "SPONSORSHIP_REQUIRED",
  "UNKNOWN",
  "NEEDS_REVIEW",
] as const;

export const WORK_MODES = ["REMOTE", "HYBRID", "ONSITE"] as const;

export const SENIORITY_LEVELS = [
  "INTERNSHIP",
  "GRADUATE",
  "ENTRY_LEVEL",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "EXECUTIVE",
] as const;

export const COMPANY_SIZES = ["STARTUP", "SMALL", "MEDIUM", "LARGE", "ENTERPRISE"] as const;

export const COMPANY_TYPES = [
  "STARTUP",
  "SCALE_UP",
  "AGENCY",
  "CONSULTANCY",
  "CORPORATE",
  "NON_PROFIT",
  "GOVERNMENT",
] as const;

export const RELOCATION_OPTIONS = ["YES", "NO", "OPEN"] as const;
export const SPONSORSHIP_NEEDS = ["YES", "NO", "DEPENDS_ON_COUNTRY"] as const;
export const SALARY_PERIODS = ["YEAR", "MONTH", "HOUR"] as const;

export const AVAILABILITY_OPTIONS = [
  "IMMEDIATELY",
  "WITHIN_1_MONTH",
  "WITHIN_3_MONTHS",
  "FROM_DATE",
  "OPEN_TO_OFFERS",
] as const;

export const DOCUMENT_TYPES = [
  "CV_RESUME",
  "PORTFOLIO",
  "COVER_LETTER",
  "EXPERIENCE_NOTES",
  "CERTIFICATE",
  "OTHER",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const LABEL_OVERRIDES: Record<string, string> = {
  CV_RESUME: "CV / Resume",
  SOFT_SKILLS: "Soft skills",
  AI: "AI",
  GITHUB_REPOSITORY: "GitHub repository",
  ONSITE: "On-site",
  SCALE_UP: "Scale-up",
  NON_PROFIT: "Non-profit",
  WITHIN_1_MONTH: "Within 1 month",
  WITHIN_3_MONTHS: "Within 3 months",
  DEPENDS_ON_COUNTRY: "Depends on country",
  NATIVE: "Native",
  YEAR: "per year",
  MONTH: "per month",
  HOUR: "per hour",
  USER_APPROVED_AI_EXTRACTION: "AI extraction (approved)",
  CV_IMPORT: "CV import",
  MANUAL_ENTRY: "Manual entry",
};

/** "FULL_TIME" -> "Full time"; CEFR codes stay as-is. */
export function optionLabel(value: string | null | undefined): string {
  if (!value) return "";
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  if (/^[ABC][12]$/.test(value)) return value;
  const words = value.toLowerCase().split("_");
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(" ");
}

export function toOptions(values: readonly string[]) {
  return values.map((value) => ({ value, label: optionLabel(value) }));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2021-03" -> "Mar 2021", "2021" -> "2021". */
export function formatPartialDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month] = value.split("-");
  return month ? `${MONTHS[Number(month) - 1]} ${year}` : (year ?? "");
}

export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  isCurrent?: boolean,
): string {
  const from = formatPartialDate(start);
  const to = isCurrent ? "Present" : formatPartialDate(end);
  if (!from && !to) return "";
  if (!from) return `Until ${to}`;
  return to ? `${from} – ${to}` : from;
}
