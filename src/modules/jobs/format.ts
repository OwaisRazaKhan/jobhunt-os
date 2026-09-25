import type { JobListItem } from "./types";

/** Display helpers. Pure and client-safe. They never fabricate missing values. */

const PERIOD_LABEL: Record<string, string> = {
  YEAR: "/yr",
  MONTH: "/mo",
  WEEK: "/wk",
  HOUR: "/hr",
};

function compact(amount: number): string {
  return amount >= 1000 && amount % 100 === 0 ? `${amount / 1000}k` : amount.toLocaleString("en");
}

/** "EUR 50k–65k /yr"; falls back to the raw text; null when nothing is known. */
export function formatSalary(
  job: Pick<
    JobListItem,
    "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod" | "salaryRaw"
  >,
): string | null {
  const { salaryMin: min, salaryMax: max, salaryCurrency: currency, salaryPeriod: period } = job;
  if (min == null && max == null) return job.salaryRaw?.trim() || null;
  const range =
    min != null && max != null && min !== max
      ? `${compact(min)}–${compact(max)}`
      : compact((min ?? max)!);
  return [currency, range, period ? PERIOD_LABEL[period] : null].filter(Boolean).join(" ");
}

let regionNames: Intl.DisplayNames | undefined;

/** "Dubai, United Arab Emirates"; falls back to the raw location; null when unknown. */
export function formatLocation(
  job: Pick<JobListItem, "city" | "countryCode" | "locationRaw">,
): string | null {
  let country: string | null = null;
  if (job.countryCode) {
    try {
      regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
      country = regionNames.of(job.countryCode) ?? job.countryCode;
    } catch {
      country = job.countryCode;
    }
  }
  // Prefer normalized city + country; otherwise show the location exactly as provided.
  if (job.city) return [job.city, country].filter(Boolean).join(", ");
  return job.locationRaw?.trim() || country || null;
}

/** Relative age for posting dates: "today", "3d ago", "5w ago", or an ISO date beyond a year. */
export function formatAge(date: Date | null, now: Date = new Date()): string | null {
  if (!date) return null;
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 0) return date.toISOString().slice(0, 10);
  if (days === 0) return "today";
  if (days < 14) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 7)}w ago`;
  return date.toISOString().slice(0, 10);
}
