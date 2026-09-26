import "server-only";
import { compareSalary, foldText, type SalaryComparison } from "@/modules/search-profiles/criteria";
import { withUserContext, type Tx } from "@/server/db";
import type { JobStatus, RemoteStatus, SalaryPeriod } from "../types";
import { MAX_PAGE, PAGE_SIZE, type JobSearchParams, type JobView } from "./params";
import {
  countBySource,
  loadResultRows,
  searchJobIds,
  type LocationRule,
} from "./search.repository";

/**
 * JobSearchService — the server-side catalog query used by /jobs, saved searches and
 * (later) workflow nodes. Pure data in, plain data out; no UI assumptions.
 * Filtering, counting and paging all happen in Postgres; the browser only ever receives
 * one page of results.
 */

type ActorRef = { userId: string };

export interface JobSearchItem {
  id: string;
  title: string;
  companyName: string;
  locationRaw: string;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  remoteStatus: RemoteStatus;
  remoteStatusRaw: string | null;
  employmentType: string;
  experienceLevel: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  salaryRaw: string | null;
  /** Only set when a salary filter is active: how this job's salary relates to it */
  salaryComparison: SalaryComparison | null;
  sourceKey: string;
  sourceName: string;
  postedAt: Date | null;
  discoveredAt: Date;
  lastSeenAt: Date;
  status: JobStatus;
  bookmarked: boolean;
  hidden: boolean;
  categories: { id: string; name: string }[];
}

export interface JobSearchResult {
  items: JobSearchItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Distinct matching jobs per source key, computed with every filter except the source filter */
  sourceCounts: Map<string, number>;
  /** Set when "salary" sort was requested without a currency (sorting across currencies is meaningless) */
  sortNote: string | null;
}

export const SOURCE_LABELS: Record<string, string> = {
  ASHBY: "Ashby",
  LEVER: "Lever",
  GREENHOUSE: "Greenhouse",
  MANUAL: "Manual Entry",
};

/** Location filter rules from the user's visible market locations (system + own). */
async function locationRules(t: Tx, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await t.marketLocation.findMany({
    where: { id: { in: ids }, OR: [{ userId: null }, { userId }] },
    select: { countryCode: true, kind: true, name: true, aliases: true },
  });
  return rows.map<LocationRule>((l) => ({
    countryCode: l.countryCode,
    kind: l.kind,
    names: [
      ...new Set(
        [l.name, ...l.aliases]
          .flatMap((n) => [n.trim().toLowerCase(), foldText(n)])
          .filter(Boolean),
      ),
    ],
  }));
}

export async function searchJobs(
  actor: ActorRef,
  params: JobSearchParams,
  opts: { view?: JobView; now?: Date } = {},
): Promise<JobSearchResult> {
  const view = opts.view ?? "all";
  const now = opts.now ?? new Date();
  const page = Math.min(Math.max(1, params.page), MAX_PAGE);
  const p = { ...params, page };
  return withUserContext(actor.userId, async (t) => {
    const ctx = {
      userId: actor.userId,
      view,
      now,
      locations: await locationRules(t, actor.userId, p.loc),
    };
    const { ids, total } = await searchJobIds(t, p, ctx);
    const rows = await loadResultRows(t, actor.userId, ids);
    const sourceCounts = await countBySource(t, p, ctx);
    const salaryActive = Boolean(p.cur && (p.salMin !== null || p.salMax !== null));
    const items = rows.map<JobSearchItem>((r) => {
      const state = r.userStates[0];
      const categories = new Map(r.categoryAssignments.map((a) => [a.category.id, a.category]));
      return {
        id: r.id,
        title: r.title,
        companyName: r.company.name,
        locationRaw: r.locationRaw,
        city: r.city,
        region: r.region,
        countryCode: r.countryCode,
        remoteStatus: r.remoteStatus as RemoteStatus,
        remoteStatusRaw: r.remoteStatusRaw,
        employmentType: r.employmentType,
        experienceLevel: r.experienceLevel,
        salaryMin: r.salaryMin,
        salaryMax: r.salaryMax,
        salaryCurrency: r.salaryCurrency,
        salaryPeriod: (r.salaryPeriod as SalaryPeriod | null) ?? null,
        salaryRaw: r.salaryRaw,
        salaryComparison: salaryActive
          ? compareSalary(
              {
                salaryMin: p.salMin,
                salaryMax: p.salMax,
                salaryCurrency: p.cur,
                salaryPeriod: p.per,
              },
              r,
            )
          : null,
        sourceKey: r.sourceKey,
        sourceName: r.source?.sourceName ?? SOURCE_LABELS[r.sourceKey] ?? r.sourceKey,
        postedAt: r.postedAt,
        discoveredAt: r.discoveredAt,
        lastSeenAt: r.lastSeenAt,
        status: r.status as JobStatus,
        bookmarked: Boolean(state?.bookmarkedAt),
        hidden: Boolean(state?.hiddenAt),
        categories: [...categories.values()],
      };
    });
    return {
      items,
      total,
      page,
      pageSize: PAGE_SIZE,
      pageCount: Math.max(1, Math.min(MAX_PAGE, Math.ceil(total / PAGE_SIZE))),
      sourceCounts,
      sortNote:
        p.sort === "salary" && !p.cur
          ? "Salary sorting needs a currency — amounts in different currencies are never ranked together. Showing newest instead."
          : null,
    };
  });
}

/** Filter options for the /jobs form, all read from the database. */
export async function loadSearchOptions(actor: ActorRef) {
  return withUserContext(actor.userId, async (t) => {
    const countries = await t.country.findMany({
      where: { isEnabled: true },
      select: { code: true, name: true, isTargetMarket: true },
      orderBy: [{ isTargetMarket: "desc" }, { name: "asc" }],
    });
    const locations = await t.marketLocation.findMany({
      where: { OR: [{ userId: null }, { userId: actor.userId }] },
      select: { id: true, countryCode: true, name: true, kind: true, userId: true },
      orderBy: [{ countryCode: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const categories = await t.jobCategory.findMany({
      where: { OR: [{ userId: null }, { userId: actor.userId }] },
      select: { id: true, name: true, userId: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    const profiles = await t.searchProfile.findMany({
      where: { userId: actor.userId },
      select: { id: true, name: true, enabled: true },
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
    });
    // Countries that actually occur in the visible catalog are listed first in the picker.
    const inCatalog = await t.job.groupBy({
      by: ["countryCode"],
      where: {
        deletedAt: null,
        countryCode: { not: null },
        OR: [{ visibility: "PUBLIC" }, { createdByUserId: actor.userId }],
      },
      _count: { _all: true },
    });
    return {
      countries: countries.map((c) => ({
        ...c,
        jobs: inCatalog.find((x) => x.countryCode === c.code)?._count._all ?? 0,
      })),
      locations: locations.map(({ userId, ...l }) => ({ ...l, own: userId === actor.userId })),
      categories: categories.map(({ userId, ...c }) => ({ ...c, own: userId === actor.userId })),
      profiles,
    };
  });
}

export type SearchOptions = Awaited<ReturnType<typeof loadSearchOptions>>;
