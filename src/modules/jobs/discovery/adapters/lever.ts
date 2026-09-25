import "server-only";
import {
  extractVisaWording,
  normalizeEmploymentType,
  normalizeInterval,
  normalizeWorkplace,
} from "../../normalize/fields";
import { htmlToText } from "../../normalize/html";
import { normalizeLocation } from "../../normalize/location";
import { joinLocations } from "../../normalize/text";
import { fetchJson } from "../http";
import { NOT_STATED } from "./ashby";
import { date, str, type SourceAdapter } from "./types";

/**
 * Lever — official Postings API (published postings, GET needs no auth):
 *   GET https://api.lever.co/v0/postings/{site}?mode=json&skip=&limit=   (EU: api.eu.lever.co)
 * Docs: https://github.com/lever/postings-api
 * Paginated with skip/limit; bounded by maxPages / maxJobs.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);

function baseUrl(options?: Record<string, unknown>) {
  return options?.region === "EU"
    ? "https://api.eu.lever.co/v0/postings"
    : "https://api.lever.co/v0/postings";
}

export const leverAdapter: SourceAdapter = {
  key: "LEVER",

  async fetchBoard(board, ctx) {
    const base = `${baseUrl(ctx.options)}/${encodeURIComponent(board.id)}`;
    const pageSize = Math.min(100, ctx.limits.maxJobs);
    const postings: { externalId: string; raw: Obj }[] = [];
    let requests = 0;
    let truncated = false;
    for (let page = 0; ; page++) {
      if (page >= ctx.limits.maxPages) {
        truncated = true;
        break;
      }
      const url = `${base}?mode=json&skip=${page * pageSize}&limit=${pageSize}`;
      const body = await fetchJson(url, {
        timeoutMs: ctx.limits.timeoutMs,
        beforeRequest: ctx.beforeRequest,
        signal: ctx.signal,
        fetchImpl: ctx.fetchImpl,
        sleep: ctx.sleep,
      });
      requests++;
      const items = arr(body).filter((p) => typeof p.id === "string");
      for (const raw of items) {
        if (postings.length >= ctx.limits.maxJobs) {
          truncated = true;
          break;
        }
        postings.push({ externalId: String(raw.id), raw });
      }
      if (truncated || items.length < pageSize) break;
    }
    return { postings, truncated, requests, endpoint: `${base}?mode=json` };
  },

  toCanonical({ externalId, raw }, board, ctx) {
    const categories = obj(raw.categories);
    const primary = str(categories.location);
    const all = (Array.isArray(categories.allLocations) ? categories.allLocations : [])
      .map(String)
      .filter(Boolean);
    const locationRaw = joinLocations(all.length ? all : [primary]) || NOT_STATED;
    const location = normalizeLocation(primary ?? all[0], { countryCode: str(raw.country) });

    const workplace = str(raw.workplaceType);
    let remoteStatus = normalizeWorkplace(workplace);
    if (remoteStatus === "UNKNOWN" && location.remoteWord) remoteStatus = location.remoteWord;

    const lists = arr(raw.lists)
      .map((l) =>
        [str(l.text), str(l.content) ? htmlToText(String(l.content)) : null]
          .filter(Boolean)
          .join("\n"),
      )
      .filter(Boolean);
    const description =
      [
        str(raw.descriptionPlain) ??
          (str(raw.description) ? htmlToText(String(raw.description)) : null),
        ...lists,
        str(raw.additionalPlain),
      ]
        .filter(Boolean)
        .join("\n\n") || NOT_STATED;

    const salary = obj(raw.salaryRange);
    const hasSalary =
      (typeof salary.min === "number" || typeof salary.max === "number") && str(salary.currency);

    return {
      sourceKey: "LEVER",
      board: board.id,
      externalJobId: externalId,
      title: str(raw.text) ?? "",
      companyName: board.name ?? board.id,
      description: description.slice(0, 50_000),
      locationRaw,
      city: location.city,
      region: location.region,
      countryCode: location.countryCode,
      employmentType: normalizeEmploymentType(str(categories.commitment)),
      employmentTypeRaw: str(categories.commitment),
      remoteStatus,
      remoteStatusRaw: workplace,
      salaryMin: hasSalary && typeof salary.min === "number" ? Math.round(salary.min) : null,
      salaryMax: hasSalary && typeof salary.max === "number" ? Math.round(salary.max) : null,
      salaryCurrency: hasSalary ? String(salary.currency).toUpperCase() : null,
      salaryPeriod: hasSalary ? normalizeInterval(str(salary.interval)) : null,
      salaryRaw: str(raw.salaryDescriptionPlain)?.slice(0, 500) ?? null,
      postedAt: date(raw.createdAt),
      sourceUpdatedAt: null,
      jobUrl: str(raw.hostedUrl) ?? "",
      applicationUrl: str(raw.applyUrl),
      sourceUrl: `${baseUrl(ctx.options)}/${encodeURIComponent(board.id)}/${encodeURIComponent(externalId)}`,
      department: str(categories.department),
      team: str(categories.team),
      visaTextRaw: extractVisaWording(description),
      raw: {
        ...raw,
        description: undefined,
        descriptionPlain: undefined,
        descriptionBody: undefined,
        descriptionBodyPlain: undefined,
        lists: undefined,
        additional: undefined,
        additionalPlain: undefined,
        opening: undefined,
        openingPlain: undefined,
      },
    };
  },
};
