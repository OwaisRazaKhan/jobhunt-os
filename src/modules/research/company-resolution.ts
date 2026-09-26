import { checkPublicHttpUrl } from "@/lib/safe-url";
import { normalizeOrganization } from "@/lib/text-normalize";
import { siteDomain } from "./extract/page";

/**
 * Company identity resolution (pure). Never guesses a domain and never merges companies because
 * names look alike. Confidence:
 *  - CONFIRMED  the user set / confirmed the website
 *  - LIKELY     the job's own URL is on a non-job-board domain, or a search result's domain
 *               matches the company name exactly
 *  - UNCERTAIN  a candidate exists but does not clearly match — NOT used for research
 */

export type WebsiteConfidence = "CONFIRMED" | "LIKELY" | "UNCERTAIN" | "UNKNOWN";
export type WebsiteSource = "USER" | "JOB_URL" | "APPLICATION_URL" | "SEARCH" | "CATALOG";

/** Job boards / ATS hosts: their domain is never the employer's website. */
const JOB_BOARD_DOMAINS = new Set([
  "ashbyhq.com",
  "lever.co",
  "greenhouse.io",
  "workable.com",
  "smartrecruiters.com",
  "recruitee.com",
  "bamboohr.com",
  "myworkdayjobs.com",
  "workday.com",
  "icims.com",
  "jobvite.com",
  "teamtailor.com",
  "personio.de",
  "personio.com",
  "breezy.hr",
  "jazzhr.com",
  "applytojob.com",
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "naukri.com",
  "wellfound.com",
  "angel.co",
  "ycombinator.com",
  "monster.com",
  "ziprecruiter.com",
  "google.com",
  "forms.gle",
  "notion.site",
  "example.test",
  "example.com",
]);

export function isJobBoardHost(host: string): boolean {
  return JOB_BOARD_DOMAINS.has(siteDomain(host));
}

export interface WebsiteCandidate {
  url: string;
  confidence: WebsiteConfidence;
  source: WebsiteSource;
}

const origin = (u: URL) => `https://${u.hostname.toLowerCase()}`;

/** Website implied by the job's own URLs (only when they are not on a job board). */
export function websiteFromJob(job: {
  jobUrl: string;
  applicationUrl: string | null;
}): WebsiteCandidate | null {
  for (const [value, source] of [
    [job.jobUrl, "JOB_URL"],
    [job.applicationUrl, "APPLICATION_URL"],
  ] as const) {
    if (!value) continue;
    const check = checkPublicHttpUrl(value);
    if (!check.ok || isJobBoardHost(check.url.hostname)) continue;
    return { url: origin(check.url), confidence: "LIKELY", source };
  }
  return null;
}

/** Does a domain's first label match the company name? ("acme.io" ↔ "Acme Inc.") */
export function domainMatchesName(host: string, companyName: string): "EXACT" | "PARTIAL" | "NONE" {
  const label = siteDomain(host).split(".")[0] ?? "";
  const name = normalizeOrganization(companyName);
  if (!label || !name) return "NONE";
  const l = label.replace(/[^a-z0-9]/g, "");
  if (l === name || l === `${name}hq` || l === `get${name}` || l === `${name}app`) return "EXACT";
  if (name.length >= 4 && (l.includes(name) || name.includes(l))) return "PARTIAL";
  return "NONE";
}

export function websiteFromSearch(
  results: { url: string }[],
  companyName: string,
): WebsiteCandidate | null {
  for (const r of results) {
    const check = checkPublicHttpUrl(r.url);
    if (!check.ok || isJobBoardHost(check.url.hostname)) continue;
    const m = domainMatchesName(check.url.hostname, companyName);
    if (m === "EXACT") return { url: origin(check.url), confidence: "LIKELY", source: "SEARCH" };
    if (m === "PARTIAL")
      return { url: origin(check.url), confidence: "UNCERTAIN", source: "SEARCH" };
  }
  return null;
}

/** Priority: user-confirmed > company catalog (system) > job URL > search. UNCERTAIN is never used. */
export function resolveWebsite(candidates: (WebsiteCandidate | null)[]): WebsiteCandidate | null {
  const usable = candidates.filter(
    (c): c is WebsiteCandidate => Boolean(c) && c!.confidence !== "UNCERTAIN",
  );
  return usable.find((c) => c.confidence === "CONFIRMED") ?? usable[0] ?? null;
}

/**
 * Similar company names that are NOT merged ("Acme" vs "Acme Technologies"): shown as
 * COMPANY_MATCH_UNCERTAIN so the user knows — attachment of jobs is never changed automatically.
 */
export function uncertainMatches<T extends { id: string; name: string }>(
  company: T,
  others: T[],
): T[] {
  const a = normalizeOrganization(company.name);
  const firstA = company.name
    .toLowerCase()
    .split(/\s+/)[0]!
    .replace(/[^a-z0-9]/g, "");
  return others.filter((o) => {
    if (o.id === company.id) return false;
    const b = normalizeOrganization(o.name);
    if (!a || !b || a === b) return false;
    const firstB = o.name
      .toLowerCase()
      .split(/\s+/)[0]!
      .replace(/[^a-z0-9]/g, "");
    return (
      (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a))) ||
      (firstA.length >= 4 && firstA === firstB)
    );
  });
}
