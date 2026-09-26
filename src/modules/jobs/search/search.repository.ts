import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type { Tx } from "@/server/db";
import type { JobSearchParams, JobView, SortKey } from "./params";
import { PAGE_SIZE, searchTokens } from "./params";

/**
 * Catalog search SQL. Every user value is a bound parameter (Prisma.sql); only fixed
 * fragments from this file are ever concatenated. Sorting uses an allowlist. The query
 * runs inside withUserContext, so RLS applies on top of the explicit visibility rule.
 */

export interface LocationRule {
  countryCode: string;
  kind: string;
  /** lower-cased name + aliases */
  names: string[];
}

export interface SearchContext {
  userId: string;
  view: JobView;
  locations: LocationRule[];
  now: Date;
}

const DAY = 86_400_000;
const sql = Prisma.sql;
const join = Prisma.join;
const empty = Prisma.empty;

function locationMatch(loc: LocationRule): Prisma.Sql {
  if (loc.kind === "REMOTE_COUNTRY")
    return sql`(j."remote_status" = 'REMOTE' AND j."country_code" = ${loc.countryCode})`;
  const likes = loc.names.map((n) => `%${n.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  return sql`(j."country_code" = ${loc.countryCode} AND (
    lower(j."city") = ANY(${loc.names}::text[])
    OR lower(j."region") = ANY(${loc.names}::text[])
    OR lower(j."location_raw") LIKE ANY(${likes}::text[])
  ))`;
}

/** "Comparable" = same currency (and period, when chosen) with at least one amount. */
function comparableSalary(p: JobSearchParams): Prisma.Sql {
  return sql`(COALESCE(j."salary_currency" = ${p.cur}, false)
    ${p.per ? sql`AND COALESCE(j."salary_period" = ${p.per}, false)` : empty}
    AND (j."salary_min" IS NOT NULL OR j."salary_max" IS NOT NULL))`;
}

/** WHERE conditions. `withSource` is false for the source facet counts. */
export function buildConditions(
  p: JobSearchParams,
  ctx: SearchContext,
  withSource = true,
): Prisma.Sql[] {
  const c: Prisma.Sql[] = [
    sql`j."deleted_at" IS NULL`,
    sql`(j."visibility" = 'PUBLIC' OR j."created_by_user_id" = ${ctx.userId}::uuid)`,
  ];
  if (ctx.view === "all") c.push(sql`s."hidden_at" IS NULL`);
  if (ctx.view === "bookmarked")
    c.push(sql`s."bookmarked_at" IS NOT NULL AND s."hidden_at" IS NULL`);
  if (ctx.view === "hidden") c.push(sql`s."hidden_at" IS NOT NULL`);

  for (const token of searchTokens(p.q)) {
    const like = `%${token.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    // Both branches are index-friendly (GIN on search_vector, btree on company_id) so the
    // planner can combine them with a BitmapOr instead of scanning every job.
    c.push(sql`(j."search_vector" @@ to_tsquery('simple', ${`${token}:*`})
      OR j."company_id" = ANY(ARRAY(
        SELECT co2."id" FROM "companies" co2 WHERE lower(co2."name") LIKE ${like})))`);
  }

  if (p.country.length || ctx.locations.length) {
    const locCountries = [...new Set(ctx.locations.map((l) => l.countryCode))];
    const locAny = ctx.locations.length
      ? sql`(${join(ctx.locations.map(locationMatch), " OR ")})`
      : null;
    if (p.country.length) {
      // Locations only constrain jobs in their own country (same rule as Search Profiles).
      c.push(sql`j."country_code" = ANY(${p.country}::text[])`);
      if (locAny) c.push(sql`(NOT (j."country_code" = ANY(${locCountries}::text[])) OR ${locAny})`);
    } else if (locAny) {
      c.push(locAny);
    }
  }

  if (p.cat.length)
    c.push(sql`EXISTS (SELECT 1 FROM "job_category_assignments" a
      WHERE a."job_id" = j."id" AND a."category_id" = ANY(${p.cat}::uuid[])
      AND (a."user_id" IS NULL OR a."user_id" = ${ctx.userId}::uuid))`);
  if (p.mode.length) c.push(sql`j."remote_status" = ANY(${p.mode}::text[])`);
  if (p.type.length) c.push(sql`j."employment_type" = ANY(${p.type}::text[])`);
  if (p.exp.length) c.push(sql`j."experience_level" = ANY(${p.exp}::text[])`);

  if (p.cur && (p.salMin !== null || p.salMax !== null)) {
    const inRange: Prisma.Sql[] = [];
    if (p.salMin !== null)
      inRange.push(sql`COALESCE(j."salary_max", j."salary_min") >= ${p.salMin}`);
    if (p.salMax !== null)
      inRange.push(sql`COALESCE(j."salary_min", j."salary_max") <= ${p.salMax}`);
    const range = sql`(${join(inRange, " AND ")})`;
    // Unknown or non-comparable salaries are kept (and labelled) unless the user asks
    // for comparable salaries only. They are never treated as zero.
    c.push(
      p.salOnly
        ? sql`(${comparableSalary(p)} AND ${range})`
        : sql`(NOT ${comparableSalary(p)} OR ${range})`,
    );
  }

  if (withSource && p.src.length)
    c.push(sql`(j."source_key" = ANY(${p.src}::text[]) OR EXISTS (
      SELECT 1 FROM "job_source_postings" sp
      WHERE sp."job_id" = j."id" AND sp."source_key" = ANY(${p.src}::text[])))`);
  if (p.status.length) c.push(sql`j."status" = ANY(${p.status}::text[])`);
  if (p.posted)
    c.push(
      sql`j."posted_at" >= ${new Date(ctx.now.getTime() - p.posted * DAY).toISOString().slice(0, 10)}::date`,
    );
  if (p.disc) c.push(sql`j."discovered_at" >= ${new Date(ctx.now.getTime() - p.disc * DAY)}`);
  if (p.seen) c.push(sql`j."last_seen_at" >= ${new Date(ctx.now.getTime() - p.seen * DAY)}`);
  if (p.profile)
    c.push(sql`EXISTS (SELECT 1 FROM "job_search_profile_hits" h
      WHERE h."job_id" = j."id" AND h."profile_id" = ${p.profile}::uuid
      AND h."user_id" = ${ctx.userId}::uuid)`);
  return c;
}

function fromClause(userId: string) {
  return sql`FROM "jobs" j
    JOIN "companies" co ON co."id" = j."company_id"
    LEFT JOIN "user_job_states" s ON s."job_id" = j."id" AND s."user_id" = ${userId}::uuid`;
}

/** Allowlisted ORDER BY fragments; salary ordering only ever ranks one currency. */
function orderBy(sort: SortKey, p: JobSearchParams): Prisma.Sql {
  switch (sort) {
    case "discovered":
      return sql`j."discovered_at" DESC, j."id" DESC`;
    case "seen":
      return sql`j."last_seen_at" DESC, j."id" DESC`;
    case "company":
      return sql`lower(co."name") ASC, lower(j."title") ASC, j."id" ASC`;
    case "title":
      return sql`lower(j."title") ASC, lower(co."name") ASC, j."id" ASC`;
    case "salary":
      if (p.cur)
        return sql`(CASE WHEN ${comparableSalary(p)} THEN 0 ELSE 1 END) ASC,
          COALESCE(j."salary_max", j."salary_min") DESC NULLS LAST, j."id" DESC`;
      return sql`j."posted_at" DESC NULLS LAST, j."discovered_at" DESC, j."id" DESC`;
    case "newest":
    default:
      return sql`j."posted_at" DESC NULLS LAST, j."discovered_at" DESC, j."id" DESC`;
  }
}

export async function searchJobIds(
  t: Tx,
  p: JobSearchParams,
  ctx: SearchContext,
): Promise<{ ids: string[]; total: number }> {
  const where = join(buildConditions(p, ctx), " AND ");
  const from = fromClause(ctx.userId);
  const [counted] = await t.$queryRaw<{ total: number }[]>(
    sql`SELECT count(*)::int AS total ${from} WHERE ${where}`,
  );
  const total = counted?.total ?? 0;
  if (total === 0) return { ids: [], total };
  const offset = (p.page - 1) * PAGE_SIZE;
  const rows = await t.$queryRaw<{ id: string }[]>(
    sql`SELECT j."id"::text AS id ${from} WHERE ${where}
      ORDER BY ${orderBy(p.sort, p)} LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
  );
  return { ids: rows.map((r) => r.id), total };
}

/** Distinct matching jobs per source (primary source + additional postings), ignoring the source filter. */
export async function countBySource(
  t: Tx,
  p: JobSearchParams,
  ctx: SearchContext,
): Promise<Map<string, number>> {
  const where = join(buildConditions(p, ctx, false), " AND ");
  const rows = await t.$queryRaw<{ key: string; n: number }[]>(
    sql`WITH m AS (SELECT j."id", j."source_key" ${fromClause(ctx.userId)} WHERE ${where})
      SELECT x.k AS key, count(DISTINCT x.id)::int AS n FROM (
        SELECT m."id" AS id, m."source_key" AS k FROM m
        UNION
        SELECT m."id", sp."source_key" FROM m JOIN "job_source_postings" sp ON sp."job_id" = m."id"
      ) x GROUP BY x.k ORDER BY x.k`,
  );
  return new Map(rows.map((r) => [r.key, r.n]));
}

/** Hydrates result ids in order, with the caller's own state and categories. */
export async function loadResultRows(t: Tx, userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await t.job.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      locationRaw: true,
      city: true,
      region: true,
      countryCode: true,
      remoteStatus: true,
      remoteStatusRaw: true,
      employmentType: true,
      experienceLevel: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      salaryRaw: true,
      postedAt: true,
      discoveredAt: true,
      lastSeenAt: true,
      status: true,
      sourceKey: true,
      company: { select: { name: true } },
      source: { select: { sourceName: true } },
      userStates: {
        where: { userId },
        select: { bookmarkedAt: true, hiddenAt: true },
      },
      categoryAssignments: {
        where: { OR: [{ userId: null }, { userId }] },
        select: { category: { select: { id: true, name: true } } },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
}
