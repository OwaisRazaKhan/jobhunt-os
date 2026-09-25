import "server-only";
import { extractVisaWording, normalizeEmploymentType } from "../../normalize/fields";
import { htmlToText } from "../../normalize/html";
import { normalizeLocation } from "../../normalize/location";
import { fetchJson } from "../http";
import { NOT_STATED } from "./ashby";
import { date, str, type SourceAdapter } from "./types";

/**
 * Greenhouse — official Job Board API ("job board data is publicly available,
 * so authentication is not required for any GET endpoints"):
 *   GET https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true&pay_transparency=true
 * Docs: https://docs.greenhouse.io/job-board.html
 * One response per board (no pagination).
 */

const API = "https://boards-api.greenhouse.io/v1/boards";
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

export const greenhouseAdapter: SourceAdapter = {
  key: "GREENHOUSE",

  async fetchBoard(board, ctx) {
    const endpoint = `${API}/${encodeURIComponent(board.id)}/jobs?content=true&pay_transparency=true`;
    const body = obj(
      await fetchJson(endpoint, {
        timeoutMs: ctx.limits.timeoutMs,
        beforeRequest: ctx.beforeRequest,
        signal: ctx.signal,
        fetchImpl: ctx.fetchImpl,
        sleep: ctx.sleep,
      }),
    );
    const jobs = arr(body.jobs).filter((j) => typeof j.id === "number" || typeof j.id === "string");
    const postings = jobs
      .slice(0, ctx.limits.maxJobs)
      .map((raw) => ({ externalId: String(raw.id), raw }));
    return { postings, truncated: jobs.length > postings.length, requests: 1, endpoint };
  },

  toCanonical({ externalId, raw }, board) {
    const locationName = str(obj(raw.location).name);
    const location = normalizeLocation(locationName);
    const description = (str(raw.content) ? htmlToText(String(raw.content)) : null) ?? NOT_STATED;

    // Employment type only when the board exposes it explicitly as metadata.
    const employmentMeta = arr(raw.metadata).find((m) =>
      /employment\s*type|commitment/i.test(String(m.name ?? "")),
    );
    const employmentRaw = typeof employmentMeta?.value === "string" ? employmentMeta.value : null;

    // Pay transparency ranges are in cents. Greenhouse does not state the period, so it stays unknown.
    const pay = arr(raw.pay_input_ranges).find(
      (p) =>
        (typeof p.min_cents === "number" || typeof p.max_cents === "number") &&
        str(p.currency_type),
    );
    const cents = (v: unknown) => (typeof v === "number" ? Math.round(v / 100) : null);

    return {
      sourceKey: "GREENHOUSE",
      board: board.id,
      externalJobId: externalId,
      title: str(raw.title) ?? "",
      companyName: board.name ?? str(raw.company_name) ?? board.id,
      description: description.slice(0, 50_000),
      locationRaw: (locationName ?? NOT_STATED).slice(0, 200),
      city: location.city,
      region: location.region,
      countryCode: location.countryCode,
      employmentType: normalizeEmploymentType(employmentRaw),
      employmentTypeRaw: employmentRaw,
      remoteStatus: location.remoteWord ?? "UNKNOWN",
      remoteStatusRaw: location.remoteWord && locationName ? locationName.slice(0, 100) : null,
      salaryMin: pay ? cents(pay.min_cents) : null,
      salaryMax: pay ? cents(pay.max_cents) : null,
      salaryCurrency: pay ? String(pay.currency_type).toUpperCase() : null,
      salaryPeriod: null,
      salaryRaw: pay ? (str(pay.title)?.slice(0, 500) ?? null) : null,
      postedAt: date(raw.first_published),
      sourceUpdatedAt: date(raw.updated_at),
      jobUrl: str(raw.absolute_url) ?? "",
      applicationUrl: null,
      sourceUrl: `${API}/${encodeURIComponent(board.id)}/jobs/${encodeURIComponent(externalId)}`,
      department: str(arr(raw.departments)[0]?.name),
      team: null,
      visaTextRaw: extractVisaWording(description),
      raw: { ...raw, content: undefined },
    };
  },
};
