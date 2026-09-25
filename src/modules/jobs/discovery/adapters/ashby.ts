import "server-only";
import { extractVisaWording, normalizeEmploymentType, normalizeInterval, normalizeWorkplace } from "../../normalize/fields";
import { htmlToText } from "../../normalize/html";
import { normalizeLocation } from "../../normalize/location";
import { joinLocations } from "../../normalize/text";
import { fetchJson } from "../http";
import { date, str, type SourceAdapter } from "./types";

/**
 * Ashby — official public Job Posting API (no authentication):
 *   GET https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
 * Docs: https://developers.ashbyhq.com/docs/public-job-posting-api
 * The whole board is returned in one response (no pagination).
 */

const API = "https://api.ashbyhq.com/posting-api/job-board";
export const NOT_STATED = "Not stated by source";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

export const ashbyAdapter: SourceAdapter = {
  key: "ASHBY",

  async fetchBoard(board, ctx) {
    const endpoint = `${API}/${encodeURIComponent(board.id)}?includeCompensation=true`;
    const body = obj(
      await fetchJson(endpoint, {
        timeoutMs: ctx.limits.timeoutMs,
        beforeRequest: ctx.beforeRequest,
        signal: ctx.signal,
        fetchImpl: ctx.fetchImpl,
        sleep: ctx.sleep,
      }),
    );
    const listed = arr(body.jobs).filter((j) => j.isListed !== false && typeof j.id === "string");
    const postings = listed.slice(0, ctx.limits.maxJobs).map((raw) => ({ externalId: String(raw.id), raw }));
    return { postings, truncated: listed.length > postings.length, requests: 1, endpoint };
  },

  toCanonical({ externalId, raw }, board) {
    const address = obj(obj(raw.address).postalAddress);
    const countryName = str(address.addressCountry);
    const region = str(address.addressRegion);
    const locality = str(address.addressLocality);
    const secondary = arr(raw.secondaryLocations).map((s) => str(s.location)).filter(Boolean) as string[];
    const primary = str(raw.location);
    const locationRaw = joinLocations([primary, ...secondary]) || NOT_STATED;
    const location = normalizeLocation(primary, {
      countryName,
      region: region && region !== countryName ? region : null,
      city: locality && locality !== countryName && locality !== region ? locality : null,
    });

    const workplace = str(raw.workplaceType);
    let remoteStatus = normalizeWorkplace(workplace);
    if (remoteStatus === "UNKNOWN" && raw.isRemote === true) remoteStatus = "REMOTE";
    if (remoteStatus === "UNKNOWN" && location.remoteWord) remoteStatus = location.remoteWord;

    const compensation = obj(raw.compensation);
    const salary = arr(compensation.summaryComponents).find(
      (c) => c.compensationType === "Salary" && (typeof c.minValue === "number" || typeof c.maxValue === "number") && str(c.currencyCode),
    );
    const salaryRaw = str(compensation.scrapeableCompensationSalarySummary) ?? str(compensation.compensationTierSummary);

    const description = str(raw.descriptionPlain) ?? (str(raw.descriptionHtml) ? htmlToText(String(raw.descriptionHtml)) : null) ?? NOT_STATED;

    return {
      sourceKey: "ASHBY",
      board: board.id,
      externalJobId: externalId,
      title: str(raw.title) ?? "",
      companyName: board.name ?? board.id,
      description: description.slice(0, 50_000),
      locationRaw,
      city: location.city,
      region: location.region,
      countryCode: location.countryCode,
      employmentType: normalizeEmploymentType(str(raw.employmentType)),
      employmentTypeRaw: str(raw.employmentType),
      remoteStatus,
      remoteStatusRaw: workplace ?? (raw.isRemote === true ? "isRemote" : null),
      salaryMin: typeof salary?.minValue === "number" ? Math.round(salary.minValue) : null,
      salaryMax: typeof salary?.maxValue === "number" ? Math.round(salary.maxValue) : null,
      salaryCurrency: salary ? String(salary.currencyCode).toUpperCase() : null,
      salaryPeriod: salary ? normalizeInterval(str(salary.interval)) : null,
      salaryRaw: salaryRaw?.slice(0, 500) ?? null,
      postedAt: date(raw.publishedAt),
      sourceUpdatedAt: null,
      jobUrl: str(raw.jobUrl) ?? "",
      applicationUrl: str(raw.applyUrl),
      sourceUrl: `${API}/${encodeURIComponent(board.id)}`,
      department: str(raw.department),
      team: str(raw.team),
      visaTextRaw: extractVisaWording(description),
      raw: { ...raw, descriptionHtml: undefined, descriptionPlain: undefined },
    };
  },
};
