import { z } from "zod";
import {
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  PROFILE_SALARY_PERIODS,
  WORK_MODES,
} from "@/modules/search-profiles/types";
import { JOB_STATUSES } from "../types";

/**
 * /jobs search + filter state (client-safe). One definition drives URL parsing, the
 * filter form, active-filter chips, saved searches and the server query. Invalid values
 * are dropped (and reported), never passed to the database.
 */

export const SORTS = ["newest", "discovered", "seen", "salary", "company", "title"] as const;
export type SortKey = (typeof SORTS)[number];
export const SORT_LABELS: Record<SortKey, string> = {
  newest: "Newest posted",
  discovered: "Recently discovered",
  seen: "Recently seen",
  salary: "Salary (same currency)",
  company: "Company A–Z",
  title: "Title A–Z",
};

export const FRESHNESS_DAYS = [1, 3, 7, 14, 30, 90] as const;
export const JOB_VIEWS = ["all", "bookmarked", "hidden"] as const;
export type JobView = (typeof JOB_VIEWS)[number];

/** Match filter values: current match status of the job for this user, or NONE (not matched yet). */
export const MATCH_FILTERS = [
  "STRONG_MATCH",
  "GOOD_MATCH",
  "PARTIAL_MATCH",
  "LOW_MATCH",
  "BLOCKED",
  "INSUFFICIENT_DATA",
  "NONE",
] as const;
export const MATCH_FILTER_LABELS: Record<string, string> = {
  STRONG_MATCH: "Strong match",
  GOOD_MATCH: "Good match",
  PARTIAL_MATCH: "Partial match",
  LOW_MATCH: "Low match",
  BLOCKED: "Blocked",
  INSUFFICIENT_DATA: "Insufficient data",
  NONE: "Not matched yet",
};

export const PAGE_SIZE = 25;
export const MAX_PAGE = 400;
export const MAX_QUERY_LENGTH = 200;

const uuid = z.uuid();
const iso2 = z.string().regex(/^[A-Z]{2}$/);
const sourceKey = z.string().regex(/^[A-Z][A-Z0-9_]{1,29}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

export interface JobSearchParams {
  q: string;
  country: string[];
  loc: string[];
  cat: string[];
  mode: string[];
  type: string[];
  exp: string[];
  salMin: number | null;
  salMax: number | null;
  cur: string | null;
  per: string | null;
  /** Only jobs whose salary is comparable (same currency/period) and in range */
  salOnly: boolean;
  src: string[];
  status: string[];
  posted: number | null;
  disc: number | null;
  seen: number | null;
  profile: string | null;
  /** Current match status filter (only jobs you matched explicitly have one) */
  match: string[];
  sort: SortKey;
  page: number;
}

export const EMPTY_SEARCH: JobSearchParams = {
  q: "",
  country: [],
  loc: [],
  cat: [],
  mode: [],
  type: [],
  exp: [],
  salMin: null,
  salMax: null,
  cur: null,
  per: null,
  salOnly: false,
  src: [],
  status: [],
  posted: null,
  disc: null,
  seen: null,
  profile: null,
  match: [],
  sort: "newest",
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

const LIST_LIMITS: Record<string, number> = {
  country: 30,
  loc: 50,
  cat: 30,
  mode: 4,
  type: 8,
  exp: 8,
  src: 10,
  status: 4,
  match: 7,
};

function values(raw: RawParams, key: string): string[] {
  const v = raw[key];
  const arr = Array.isArray(v) ? v : v === undefined ? [] : [v];
  // "a,b" is accepted too (hand-written URLs); every value is trimmed.
  return arr
    .flatMap((x) => String(x).split(","))
    .map((x) => x.trim())
    .filter(Boolean);
}

export interface ParsedSearch {
  params: JobSearchParams;
  /** Parameter names that contained invalid values (those values were ignored) */
  invalid: string[];
}

/** Lenient, safe parser for URL search params or stored saved-search params. */
export function parseSearchParams(raw: RawParams): ParsedSearch {
  const invalid = new Set<string>();
  const list = (key: keyof JobSearchParams, check: (v: string) => boolean, upper = false) => {
    const out: string[] = [];
    for (const v of values(raw, key)) {
      const value = upper ? v.toUpperCase() : v;
      if (check(value) && !out.includes(value)) out.push(value);
      else invalid.add(key);
    }
    if (out.length > (LIST_LIMITS[key] ?? 20)) invalid.add(key);
    return out.slice(0, LIST_LIMITS[key] ?? 20);
  };
  const one = (key: string) => values(raw, key)[0];
  const int = (key: string, min: number, max: number) => {
    const v = one(key);
    if (v === undefined) return null;
    const n = Number(v);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    invalid.add(key);
    return null;
  };
  const days = (key: string) => {
    const n = int(key, 1, 365);
    if (n !== null && !(FRESHNESS_DAYS as readonly number[]).includes(n)) {
      invalid.add(key);
      return null;
    }
    return n;
  };
  const inEnum = (set: readonly string[]) => (v: string) => set.includes(v);

  let q = (one("q") ?? "").replace(/\s+/g, " ").trim();
  if (q.length > MAX_QUERY_LENGTH) {
    invalid.add("q");
    q = q.slice(0, MAX_QUERY_LENGTH);
  }

  const params: JobSearchParams = {
    q,
    country: list("country", (v) => iso2.safeParse(v).success, true),
    loc: list("loc", (v) => uuid.safeParse(v).success),
    cat: list("cat", (v) => uuid.safeParse(v).success),
    mode: list("mode", inEnum(WORK_MODES), true),
    type: list("type", inEnum(JOB_TYPES), true),
    exp: list("exp", inEnum(EXPERIENCE_LEVELS), true),
    salMin: int("salMin", 0, 1_000_000_000),
    salMax: int("salMax", 0, 1_000_000_000),
    cur: null,
    per: null,
    salOnly: one("salOnly") === "1",
    src: list("src", (v) => sourceKey.safeParse(v).success, true),
    status: list("status", inEnum(JOB_STATUSES), true),
    posted: days("posted"),
    disc: days("disc"),
    seen: days("seen"),
    profile: null,
    match: list("match", inEnum(MATCH_FILTERS), true),
    sort: "newest",
    page: 1,
  };

  const cur = one("cur")?.toUpperCase();
  if (cur) {
    if (currency.safeParse(cur).success) params.cur = cur;
    else invalid.add("cur");
  }
  const per = one("per")?.toUpperCase();
  if (per) {
    if ((PROFILE_SALARY_PERIODS as readonly string[]).includes(per)) params.per = per;
    else invalid.add("per");
  }
  // A salary range without a currency is never applied: amounts in different currencies
  // are not comparable and no exchange rate is ever invented.
  if ((params.salMin !== null || params.salMax !== null) && !params.cur) {
    invalid.add("cur");
    params.salMin = null;
    params.salMax = null;
    params.salOnly = false;
  }
  if (params.salMin !== null && params.salMax !== null && params.salMin > params.salMax) {
    invalid.add("salMax");
    params.salMax = null;
  }
  if (params.salMin === null && params.salMax === null) params.salOnly = false;

  const profile = one("profile");
  if (profile) {
    if (uuid.safeParse(profile).success) params.profile = profile;
    else invalid.add("profile");
  }
  const sort = one("sort");
  if (sort) {
    if ((SORTS as readonly string[]).includes(sort)) params.sort = sort as SortKey;
    else invalid.add("sort");
  }
  params.page = int("page", 1, MAX_PAGE) ?? 1;
  return { params, invalid: [...invalid] };
}

/** Serialise to URL params (defaults omitted) so every search is a shareable, reproducible URL. */
export function toSearchParams(
  p: JobSearchParams,
  overrides: Partial<JobSearchParams> = {},
): URLSearchParams {
  const v = { ...p, ...overrides };
  const out = new URLSearchParams();
  if (v.q) out.set("q", v.q);
  for (const key of [
    "country",
    "loc",
    "cat",
    "mode",
    "type",
    "exp",
    "src",
    "status",
    "match",
  ] as const)
    for (const item of v[key]) out.append(key, item);
  if (v.salMin !== null) out.set("salMin", String(v.salMin));
  if (v.salMax !== null) out.set("salMax", String(v.salMax));
  if (v.cur) out.set("cur", v.cur);
  if (v.per) out.set("per", v.per);
  if (v.salOnly) out.set("salOnly", "1");
  if (v.posted) out.set("posted", String(v.posted));
  if (v.disc) out.set("disc", String(v.disc));
  if (v.seen) out.set("seen", String(v.seen));
  if (v.profile) out.set("profile", v.profile);
  if (v.sort !== "newest") out.set("sort", v.sort);
  if (v.page > 1) out.set("page", String(v.page));
  return out;
}

export function searchHref(
  base: string,
  p: JobSearchParams,
  overrides: Partial<JobSearchParams> = {},
) {
  const qs = toSearchParams(p, overrides).toString();
  return qs ? `${base}?${qs}` : base;
}

/** The filter part only (no page) — what a saved search stores. */
export function savedParams(p: JobSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of toSearchParams(p, { page: 1 })) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

export function hasFilters(p: JobSearchParams): boolean {
  return toSearchParams(p, { page: 1, sort: "newest" }).toString() !== "";
}

/** Search text → safe prefix tokens (letters/digits, optional inner dots, e.g. "make.com"). */
export function searchTokens(q: string): string[] {
  const tokens = q
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((t) => t.replace(/^\.+|\.+$/g, "").slice(0, 40))
    .filter((t) => t.length > 0);
  return [...new Set(tokens)].slice(0, 8);
}
