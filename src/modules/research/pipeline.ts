import "server-only";
import { getServerEnv } from "@/config/env";
import { ensureJobRequirements } from "@/modules/matching/requirements/requirements.service";
import { recordAudit, type AuditAction } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { getDb, withUserContext } from "@/server/db";
import { logger } from "@/server/logger";
import { computeCompleteness, computeStats, researchStatus, type SourceOutcome } from "./claims";
import {
  isJobBoardHost,
  resolveWebsite,
  websiteFromJob,
  websiteFromSearch,
  type WebsiteCandidate,
} from "./company-resolution";
import { extractCompanyClaims, type SourcePage } from "./extract/company";
import { extractJobClaims, THEMES, unknownClaim } from "./extract/job";
import { normalizeUrl, parsePage, siteDomain, type ParsedPage } from "./extract/page";
import { FetchSession } from "./fetch/session";
import { ResearchFetchError } from "./fetch/safe-fetch";
import {
  findCurrentCompanyResearch,
  findCurrentJobResearch,
  findSettings,
  findTarget,
  findVisibleJob,
  insertClaims,
  upsertSource,
} from "./research.repository";
import { getSearchProvider } from "./search/provider";
import { synthesize } from "./synthesis";
import {
  DEFAULT_FRESHNESS,
  DEPTH_CONFIG,
  freshnessOf,
  RESEARCH_ENGINE_VERSION,
  SOURCE_RELIABILITY,
  WEBSITE_UNKNOWN_MESSAGE,
  type BriefItem,
  type CompanyBrief,
  type Depth,
  type DraftClaim,
  type JobBrief,
  type Reliability,
  type SourceType,
} from "./types";

/**
 * Research pipeline (runs in the background after the request, or inline for workflow calls).
 * Every progress step is recorded AFTER the work it names actually happened. Source failures are
 * isolated: a failed page is recorded and the run continues (PARTIAL), never aborted.
 */

type ActorRef = { userId: string };
type StepStatus = "DONE" | "FAILED" | "SKIPPED";
export interface RunStep {
  key: string;
  label: string;
  status: StepStatus;
  detail?: string;
  at: string;
}

interface RunSourceState {
  id: string;
  key: string;
  url: string;
  sourceType: SourceType;
  reliability: Reliability;
  ok: boolean;
  failed: boolean;
  page: ParsedPage | null;
  relevance: string;
  /** Same URL was researched before and its content changed */
  changed: boolean;
}

const DEPTH_RANK: Record<Depth, number> = { QUICK: 1, STANDARD: 2, DEEP: 3 };

class RunContext {
  steps: RunStep[] = [];
  errors: { source?: string; message: string }[] = [];
  sources = new Map<string, RunSourceState>();
  sourceIds = new Map<string, string>();
  attempted = 0;
  constructor(
    readonly actor: ActorRef,
    readonly runId: string,
    readonly session: FetchSession,
  ) {}

  async step(key: string, label: string, status: StepStatus, detail?: string) {
    this.steps.push({
      key,
      label,
      status,
      detail: detail?.slice(0, 300),
      at: new Date().toISOString(),
    });
    await withUserContext(this.actor.userId, (t) =>
      t.researchRun.update({
        where: { id: this.runId },
        data: {
          steps: this.steps as object[],
          heartbeatAt: new Date(),
          requestsMade: this.session.requests,
          sourcesAttempted: this.attempted,
          sourcesSuccessful: [...this.sources.values()].filter((s) => s.ok).length,
          sourcesFailed: [...this.sources.values()].filter((s) => s.failed).length,
        },
      }),
    );
  }

  outcomes(filter?: (s: RunSourceState) => boolean): SourceOutcome[] {
    return [...this.sources.values()]
      .filter((s) => (filter ? filter(s) : true))
      .map((s) => ({
        key: s.key,
        ok: s.ok,
        failed: s.failed,
        reliability: s.reliability,
        sourceType: s.sourceType,
      }));
  }
}

function sessionLimits(depth: Depth) {
  const env = getServerEnv();
  return {
    maxPages: DEPTH_CONFIG[depth].maxPages + 4, // + manual sources and search result pages
    maxDurationMs: DEPTH_CONFIG[depth].maxDurationMs,
    requestsPerMinute: env.RESEARCH_REQUESTS_PER_MINUTE,
    requestsPerHour: env.RESEARCH_REQUESTS_PER_HOUR,
    perHostPerMinute: env.RESEARCH_PER_HOST_PER_MINUTE,
    concurrency: 2,
    maxBytes: env.RESEARCH_MAX_RESPONSE_BYTES,
    maxRetries: 2,
  };
}

// --- Source fetching ---------------------------------------------------------------------------

async function recordRunSource(ctx: RunContext, sourceId: string, outcome: string, note?: string) {
  await withUserContext(ctx.actor.userId, (t) =>
    t.researchRunSource.upsert({
      where: { runId_sourceId: { runId: ctx.runId, sourceId } },
      create: {
        userId: ctx.actor.userId,
        runId: ctx.runId,
        sourceId,
        outcome,
        note: note?.slice(0, 300) ?? null,
      },
      update: { outcome, note: note?.slice(0, 300) ?? null },
    }),
  );
}

async function fetchSource(
  ctx: RunContext,
  input: {
    url: string;
    sourceType: SourceType;
    origin: string;
    companyId: string | null;
    jobId: string | null;
    addedByUser?: boolean;
  },
): Promise<RunSourceState | null> {
  let normalized: string;
  try {
    normalized = normalizeUrl(input.url);
  } catch {
    return null;
  }
  const existing = ctx.sources.get(normalized);
  if (existing) return existing;
  ctx.attempted++;
  const reliability = SOURCE_RELIABILITY[input.sourceType];
  let page: ParsedPage | null = null;
  let fetchStatus = "OK";
  let httpStatus: number | null = null;
  let error: string | null = null;
  let lastModified: Date | null = null;
  let limit = false;
  try {
    const res = await ctx.session.fetchPage(input.url);
    httpStatus = res.status;
    page = res.contentType.includes("text/plain")
      ? { ...parsePage("", res.finalUrl), text: res.body.slice(0, 20_000) }
      : parsePage(res.body, res.finalUrl);
    const lm = res.lastModified ? new Date(res.lastModified) : null;
    lastModified = lm && !Number.isNaN(lm.getTime()) ? lm : null;
  } catch (e) {
    const err =
      e instanceof ResearchFetchError ? e : new ResearchFetchError("NETWORK", "Request failed");
    httpStatus = err.status ?? null;
    error = err.message;
    if (err.kind === "LIMIT_REACHED") {
      fetchStatus = "NOT_FETCHED";
      limit = true;
    } else
      fetchStatus =
        err.kind === "ROBOTS_DISALLOWED"
          ? "ROBOTS_DISALLOWED"
          : err.kind === "UNSAFE_URL"
            ? "UNSAFE_URL"
            : err.kind === "BLOCKED"
              ? "BLOCKED"
              : "FAILED";
    ctx.errors.push({ source: input.url.slice(0, 200), message: err.message });
  }
  const text = page?.text ?? null;
  const { source, changed, previousHash } = await withUserContext(ctx.actor.userId, (t) =>
    upsertSource(t, ctx.actor.userId, {
      companyId: input.companyId,
      jobId: input.jobId,
      url: input.url.slice(0, 2048),
      normalizedUrl: normalized.slice(0, 2048),
      sourceType: input.sourceType,
      reliability,
      relevance: page ? "HIGH" : "UNKNOWN",
      origin: input.origin,
      fetchStatus,
      httpStatus,
      error,
      title: page?.title ?? null,
      publishedAt: page?.publishedAt ? new Date(page.publishedAt) : null,
      sourceUpdatedAt: page?.modifiedAt ? new Date(page.modifiedAt) : lastModified,
      retrievedAt: page ? new Date() : null,
      contentHash: text ? sha256Hex(text) : null,
      contentText: text,
      addedByUser: input.addedByUser,
    }),
  );
  const state: RunSourceState = {
    id: source.id,
    key: normalized,
    url: input.url,
    sourceType: input.sourceType,
    reliability,
    ok: Boolean(page),
    failed: !page && !limit,
    page,
    relevance: page ? "HIGH" : "UNKNOWN",
    changed,
  };
  ctx.sources.set(normalized, state);
  ctx.sourceIds.set(normalized, source.id);
  ctx.sourceIds.set(source.id, source.id);
  await recordRunSource(
    ctx,
    source.id,
    page
      ? !changed && previousHash !== null && previousHash === source.contentHash
        ? "UNCHANGED"
        : "USED"
      : limit
        ? "SKIPPED_LIMIT"
        : "FAILED",
    page && changed ? "Content changed since the last research" : (error ?? undefined),
  );
  return state;
}

// --- Official page discovery ------------------------------------------------------------------

type PageKind = "about" | "careers" | "product" | "news" | "blog" | "docs";
const KIND_TYPE: Record<PageKind, SourceType> = {
  about: "OFFICIAL_COMPANY",
  careers: "OFFICIAL_CAREERS",
  product: "OFFICIAL_PRODUCT",
  news: "OFFICIAL_NEWS",
  blog: "OFFICIAL_BLOG",
  docs: "OFFICIAL_DOCUMENTATION",
};

export function classifyOfficialLink(href: string, domain: string): PageKind | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (siteDomain(url.hostname) !== domain) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (/^\/(about|about-us|company|who-we-are|our-story|our-company)(\/)?$/.test(path))
    return "about";
  if (
    host.startsWith("careers.") ||
    host.startsWith("jobs.") ||
    /^\/(careers?|jobs|join(-us)?|work-with-us)(\/)?$/.test(path)
  )
    return "careers";
  if (/^\/(news|newsroom|press|press-releases|media)(\/)?$/.test(path)) return "news";
  if (host.startsWith("blog.") || /^\/(blog|insights|stories)(\/)?$/.test(path)) return "blog";
  if (
    host.startsWith("docs.") ||
    host.startsWith("developers.") ||
    /^\/(docs|documentation|developers)(\/)?$/.test(path)
  )
    return "docs";
  if (/^\/(products?|solutions?|services?|platform|features?)(\/[a-z0-9-]+)?\/?$/.test(path))
    return "product";
  return null;
}

// --- Brief construction ------------------------------------------------------------------------

function items(drafts: DraftClaim[], ids: string[], pick: (d: DraftClaim) => boolean): BriefItem[] {
  return drafts
    .map((d, i) => ({ d, id: ids[i]! }))
    .filter(({ d }) => d.verification !== "REJECTED" && pick(d))
    .map(({ d, id }) => ({ text: d.claim, claimIds: [id], type: d.claimType }));
}

function companyBrief(
  drafts: DraftClaim[],
  ids: string[],
  unknowns: string[],
  links: { kind: string; url: string }[],
): CompanyBrief {
  const s = (section: string) => (d: DraftClaim) => d.section === section;
  return {
    whatTheyDo: items(drafts, ids, s("WHAT_THEY_DO")),
    productsServices: items(drafts, ids, s("PRODUCTS")),
    industry: items(drafts, ids, s("INDUSTRY")),
    marketsServed: items(drafts, ids, s("MARKETS")),
    companyPositioning: items(
      drafts,
      ids,
      (d) => d.section === "WHAT_THEY_DO" && d.claim.startsWith("The company describes itself"),
    ),
    relevantActivity: items(drafts, ids, s("ACTIVITY")),
    technologySignals: items(drafts, ids, s("TECHNOLOGY_SIGNAL")),
    marketingSignals: items(drafts, ids, s("MARKETING_SIGNAL")),
    growthSignals: items(drafts, ids, s("GROWTH_SIGNAL")),
    facts: items(drafts, ids, (d) => d.section === "FACTS" && d.claimType !== "CONFLICTING"),
    conflicts: items(drafts, ids, (d) => d.claimType === "CONFLICTING"),
    officialLinks: links,
    unknowns,
  };
}

function jobBrief(
  drafts: DraftClaim[],
  ids: string[],
  openQuestions: string[],
  terms: { term: string; count: number }[],
  matchContext: JobBrief["matchContext"],
): JobBrief {
  const sec = (name: string, value?: string) => (d: DraftClaim) =>
    d.section === name && (value === undefined || d.value === value);
  const notReq = (name: string) => (d: DraftClaim) => d.section === name && d.value !== "REQUIRED";
  const termIds = new Map(
    drafts
      .map((d, i) => [d, ids[i]!] as const)
      .filter(([d]) => d.section === "TERM")
      .map(([d, id]) => [d.value ?? "", id]),
  );
  return {
    roleSummary: items(drafts, ids, sec("ROLE_SUMMARY")),
    rolePurpose: items(drafts, ids, sec("ROLE_PURPOSE")),
    keyResponsibilities: items(drafts, ids, sec("RESPONSIBILITY")),
    rolePriorities: items(drafts, ids, sec("PRIORITY")),
    requiredSkills: items(drafts, ids, sec("REQ_SKILL", "REQUIRED")),
    preferredSkills: items(drafts, ids, notReq("REQ_SKILL")),
    requiredExperience: items(drafts, ids, sec("REQ_EXPERIENCE", "REQUIRED")),
    preferredExperience: items(drafts, ids, notReq("REQ_EXPERIENCE")),
    educationExpectations: items(drafts, ids, sec("REQ_EDUCATION")),
    languageRequirements: items(drafts, ids, sec("REQ_LANGUAGE")),
    workModel: items(drafts, ids, sec("REQ_WORK_MODEL")),
    locationContext: items(drafts, ids, sec("REQ_LOCATION")),
    salaryContext: items(drafts, ids, sec("REQ_SALARY")),
    authorizationContext: items(drafts, ids, sec("REQ_AUTHORIZATION")),
    applicationInstructions: items(
      drafts,
      ids,
      (d) => d.section === "APPLICATION" || d.section === "REQ_APPLICATION",
    ),
    importantTerms: terms.map((t) => ({ ...t, claimId: termIds.get(t.term) ?? null })),
    relevantPublicContext: items(
      drafts,
      ids,
      (d) => d.section === "RELEVANT_CONTEXT" || d.section === "MANUAL_SOURCE",
    ),
    aiSynthesis: items(drafts, ids, sec("AI_SYNTHESIS")),
    openQuestions,
    matchContext,
  };
}

function diff(previous: { claim: string }[] | null, next: DraftClaim[], changedSources: string[]) {
  if (!previous)
    return {
      firstVersion: true,
      added: next.length,
      removed: 0,
      addedClaims: [],
      removedClaims: [],
      changedSources,
    };
  const before = new Set(previous.map((c) => c.claim));
  const after = new Set(next.filter((c) => c.verification !== "REJECTED").map((c) => c.claim));
  const added = [...after].filter((c) => !before.has(c));
  const removed = [...before].filter((c) => !after.has(c));
  return {
    firstVersion: false,
    added: added.length,
    removed: removed.length,
    addedClaims: added.slice(0, 10),
    removedClaims: removed.slice(0, 10),
    changedSources,
  };
}

async function audit(
  actor: ActorRef,
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, string | number | boolean | null | string[]>,
) {
  await withUserContext(actor.userId, (t) =>
    recordAudit(t, { userId: actor.userId, action, resourceType, resourceId, metadata }),
  );
}

// --- Company research ---------------------------------------------------------------------------

async function researchCompanyInRun(
  ctx: RunContext,
  opts: {
    companyId: string;
    companyName: string;
    website: WebsiteCandidate | null;
    careersUrl: string | null;
    depth: Depth;
    aiSynthesis: boolean;
  },
) {
  const cfg = DEPTH_CONFIG[opts.depth];
  const provider = getSearchProvider();
  let website = opts.website;

  // Discovery search (hints only) — also used to find a website when none is known.
  const searchResults: { url: string; title: string; snippet: string }[] = [];
  if (cfg.searchQueries > 0 && provider) {
    const queries = [
      ...(website ? [] : [`${opts.companyName} official website`]),
      `"${opts.companyName}" news`,
      `"${opts.companyName}" announcement`,
    ].slice(0, cfg.searchQueries + (website ? 0 : 1));
    try {
      for (const q of queries) searchResults.push(...(await provider.search(q, 8)));
      if (!website) {
        const found = websiteFromSearch(searchResults, opts.companyName);
        if (found?.confidence === "LIKELY") website = found;
      }
      await ctx.step(
        "SEARCH",
        "Searched relevant public sources",
        "DONE",
        `${searchResults.length} results from ${provider.id} (discovery hints only)`,
      );
    } catch (e) {
      ctx.errors.push({ message: `Search failed: ${e instanceof Error ? e.message : "error"}` });
      await ctx.step(
        "SEARCH",
        "Searched relevant public sources",
        "FAILED",
        "The search provider did not respond",
      );
    }
  } else if (cfg.searchQueries > 0) {
    await ctx.step(
      "SEARCH",
      "Searched relevant public sources",
      "SKIPPED",
      "No search provider configured (optional)",
    );
  }

  // Official website.
  let homepage: RunSourceState | null = null;
  if (website) {
    homepage = await fetchSource(ctx, {
      url: website.url,
      sourceType: "OFFICIAL_COMPANY",
      origin: "OFFICIAL_SITE",
      companyId: opts.companyId,
      jobId: null,
    });
    await ctx.step(
      "COMPANY_SITE",
      "Fetched company website",
      homepage?.ok ? "DONE" : "FAILED",
      homepage?.ok
        ? `${website.url} (${website.confidence.toLowerCase()})`
        : `${website.url}: ${ctx.errors.at(-1)?.message ?? "not available"}`,
    );
  } else {
    await ctx.step("COMPANY_SITE", "Fetched company website", "SKIPPED", WEBSITE_UNKNOWN_MESSAGE);
  }

  // Official pages discovered from the homepage (same site only), bounded by the depth tier.
  let careers: "OK" | "FAILED" | "NOT_FOUND" = "NOT_FOUND";
  if (homepage?.ok && website) {
    const domain = siteDomain(new URL(website.url).hostname);
    const byKind = new Map<PageKind, string[]>();
    for (const l of homepage.page!.links) {
      const kind = classifyOfficialLink(l.href, domain);
      if (!kind) continue;
      const list = byKind.get(kind) ?? [];
      if (!list.includes(l.href)) list.push(l.href);
      byKind.set(kind, list);
    }
    if (opts.careersUrl) byKind.set("careers", [opts.careersUrl, ...(byKind.get("careers") ?? [])]);
    const wanted: [PageKind, string][] = [];
    for (const kind of Object.keys(KIND_TYPE) as PageKind[])
      for (const href of (byKind.get(kind) ?? []).slice(0, cfg.pages[kind]))
        wanted.push([kind, href]);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      wanted.map(async ([kind, href]) => {
        const s = await fetchSource(ctx, {
          url: href,
          sourceType: KIND_TYPE[kind],
          origin: "OFFICIAL_SITE",
          companyId: opts.companyId,
          jobId: null,
        });
        if (s?.ok) ok++;
        else if (s?.failed) failed++;
        if (kind === "careers") careers = s?.ok ? "OK" : s?.failed ? "FAILED" : careers;
      }),
    );
    await ctx.step(
      "OFFICIAL_PAGES",
      "Fetched official company pages",
      wanted.length === 0 ? "SKIPPED" : failed && !ok ? "FAILED" : "DONE",
      wanted.length === 0
        ? "No about / careers / product / news pages linked from the homepage"
        : `${ok} fetched, ${failed} unavailable (of ${wanted.length} found)`,
    );
  }

  // Public pages from discovery results: fetched, then judged for relevance.
  if (searchResults.length && cfg.searchFetches > 0) {
    const officialDomain = website ? siteDomain(new URL(website.url).hostname) : null;
    const candidates = searchResults
      .filter((r) => {
        try {
          const host = new URL(r.url).hostname;
          return !isJobBoardHost(host) && siteDomain(host) !== officialDomain;
        } catch {
          return false;
        }
      })
      .slice(0, cfg.searchFetches);
    let relevant = 0;
    for (const r of candidates) {
      const s = await fetchSource(ctx, {
        url: r.url,
        sourceType: "PUBLIC_NEWS",
        origin: "SEARCH",
        companyId: opts.companyId,
        jobId: null,
      });
      if (!s?.ok) continue;
      const name = opts.companyName.toLowerCase();
      const relevance = (s.page!.title ?? "").toLowerCase().includes(name)
        ? "HIGH"
        : s.page!.text.toLowerCase().includes(name)
          ? "MEDIUM"
          : "IRRELEVANT";
      s.relevance = relevance;
      await withUserContext(ctx.actor.userId, (t) =>
        t.researchSource.update({ where: { id: s.id }, data: { relevance } }),
      );
      if (relevance === "IRRELEVANT")
        await recordRunSource(ctx, s.id, "SKIPPED_IRRELEVANT", "Company not mentioned");
      else relevant++;
    }
    await ctx.step(
      "PUBLIC_SOURCES",
      "Fetched relevant public sources",
      "DONE",
      `${relevant} relevant of ${candidates.length} fetched`,
    );
  }

  // Sources the user added for this company.
  const manual = await withUserContext(ctx.actor.userId, (t) =>
    t.researchSource.findMany({
      where: { userId: ctx.actor.userId, companyId: opts.companyId, addedByUser: true },
      distinct: ["normalizedUrl"],
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  );
  if (manual.length) {
    for (const m of manual)
      await fetchSource(ctx, {
        url: m.url,
        sourceType: "MANUAL",
        origin: "MANUAL",
        companyId: opts.companyId,
        jobId: null,
        addedByUser: true,
      });
    await ctx.step(
      "MANUAL_SOURCES",
      "Fetched sources you added",
      "DONE",
      `${manual.length} source(s)`,
    );
  }

  // Evidence extraction.
  const pages: SourcePage[] = [...ctx.sources.values()]
    .filter(
      (s) => s.ok && s.page && s.relevance !== "IRRELEVANT" && s.sourceType !== "OFFICIAL_JOB",
    )
    .map((s) => ({
      key: s.key,
      url: s.url,
      sourceType: s.sourceType,
      reliability: s.reliability,
      page: s.page!,
    }));
  const extracted = extractCompanyClaims(opts.companyName, pages);
  const drafts: DraftClaim[] = [...extracted.claims];
  const unknowns = [...extracted.unknowns];
  if (!website) unknowns.unshift(WEBSITE_UNKNOWN_MESSAGE);
  await ctx.step(
    "COMPANY_EVIDENCE",
    "Extracted company evidence",
    "DONE",
    `${drafts.length} claims from ${pages.length} sources`,
  );

  const ai = await synthesize({
    userId: ctx.actor.userId,
    enabled: opts.aiSynthesis,
    subject: `Company: ${opts.companyName}`,
    companyName: opts.companyName,
    drafts,
  });
  drafts.push(...ai.accepted, ...ai.rejected);

  // Persist the new company research version.
  const companyOutcomes = ctx.outcomes((s) => s.sourceType !== "OFFICIAL_JOB");
  const stats = computeStats(companyOutcomes, drafts);
  const status = researchStatus(stats);
  const completeness = computeCompleteness({
    websiteIdentified: Boolean(website),
    websiteFetched: Boolean(homepage?.ok),
    careers,
    activityChecked: extracted.activityChecked,
    activityFound: extracted.activityFound,
    stats,
  });
  const links = [...ctx.sources.values()]
    .filter((s) => s.ok && s.sourceType.startsWith("OFFICIAL_") && s.sourceType !== "OFFICIAL_JOB")
    .map((s) => ({ kind: s.sourceType, url: s.url }));
  const now = new Date();
  const saved = await withUserContext(ctx.actor.userId, async (t) => {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`research:company:${ctx.actor.userId}:${opts.companyId}`}, 0))`;
    const previous = await t.companyResearch.findFirst({
      where: { userId: ctx.actor.userId, companyId: opts.companyId, isCurrent: true },
      include: {
        claims: { select: { claim: true }, where: { verification: { not: "REJECTED" } } },
      },
    });
    const last = await t.companyResearch.findFirst({
      where: { userId: ctx.actor.userId, companyId: opts.companyId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await t.companyResearch.updateMany({
      where: { userId: ctx.actor.userId, companyId: opts.companyId, isCurrent: true },
      data: { isCurrent: false },
    });
    const research = await t.companyResearch.create({
      data: {
        userId: ctx.actor.userId,
        companyId: opts.companyId,
        runId: ctx.runId,
        version: (last?.version ?? 0) + 1,
        status,
        depth: opts.depth,
        engineVersion: RESEARCH_ENGINE_VERSION,
        websiteUrl: website?.url ?? null,
        websiteConfidence: website
          ? website.confidence === "UNKNOWN"
            ? "UNKNOWN"
            : website.confidence
          : "UNKNOWN",
        summary:
          drafts.find((d) => d.section === "WHAT_THEY_DO")?.claim.slice(0, 4000) ??
          (website ? null : WEBSITE_UNKNOWN_MESSAGE),
        stats: stats as object,
        completeness: { dimensions: completeness } as object,
        researchedAt: now,
        lastVerifiedAt: now,
      },
    });
    const ids = await insertClaims(
      t,
      ctx.actor.userId,
      { companyResearchId: research.id },
      drafts,
      ctx.sourceIds,
    );
    const brief = companyBrief(drafts, ids, unknowns, links);
    const changedSources = [...ctx.sources.values()].filter((s) => s.changed).map((s) => s.url);
    return t.companyResearch.update({
      where: { id: research.id },
      data: {
        brief: brief as object,
        changes: diff(previous?.claims ?? null, drafts, changedSources) as object,
      },
    });
  });
  await ctx.step(
    "COMPANY_BRIEF",
    "Built company research brief",
    "DONE",
    `Version ${saved.version} · ${status.toLowerCase().replace("_", " ")}`,
  );
  return { research: saved, drafts, stats, ai };
}

// --- Run execution ------------------------------------------------------------------------------

export async function executeResearchRun(actor: ActorRef, runId: string) {
  const claimed = await withUserContext(actor.userId, (t) =>
    t.researchRun.updateMany({
      where: { id: runId, userId: actor.userId, status: "QUEUED" },
      data: { status: "RUNNING", startedAt: new Date(), heartbeatAt: new Date() },
    }),
  );
  if (claimed.count !== 1) return;
  const run = await withUserContext(actor.userId, (t) =>
    t.researchRun.findUniqueOrThrow({ where: { id: runId } }),
  );
  const depth = run.depth as Depth;
  const ctx = new RunContext(actor, runId, new FetchSession(actor.userId, sessionLimits(depth)));
  const started = Date.now();
  let aiInfo: {
    used: boolean;
    provider: string | null;
    model: string | null;
    generationId: string | null;
  } = { used: false, provider: null, model: null, generationId: null };
  try {
    const { job, company, target, settings, currentCompany } = await withUserContext(
      actor.userId,
      async (t) => {
        const job = run.jobId ? await findVisibleJob(t, actor.userId, run.jobId) : null;
        const company = await t.company.findUniqueOrThrow({ where: { id: run.companyId } });
        return {
          job,
          company,
          target: await findTarget(t, actor.userId, run.companyId),
          settings: await findSettings(t, actor.userId),
          currentCompany: await findCurrentCompanyResearch(t, actor.userId, run.companyId),
        };
      },
    );
    if (run.kind === "JOB" && !job) throw new Error("Job not available");
    if (job) await ctx.step("LOAD_JOB", "Loaded job", "DONE", job.title);
    const policy = settings
      ? { freshDays: settings.freshDays, staleDays: settings.staleDays }
      : DEFAULT_FRESHNESS;

    // Company identity (never guessed).
    const website = resolveWebsite([
      target?.websiteUrl
        ? { url: target.websiteUrl, confidence: "CONFIRMED", source: "USER" }
        : null,
      company.officialWebsite
        ? {
            url: company.officialWebsite,
            confidence: company.websiteConfidence as "CONFIRMED" | "LIKELY",
            source: "CATALOG",
          }
        : null,
      job ? websiteFromJob(job) : null,
    ]);
    await ctx.step(
      "IDENTIFY_COMPANY",
      "Identified company",
      "DONE",
      `${company.name} — ${website ? `${website.url} (${website.confidence.toLowerCase()}, from ${website.source.toLowerCase().replace("_", " ")})` : WEBSITE_UNKNOWN_MESSAGE}`,
    );

    // Company research: reuse current research when it is still valid, otherwise research now.
    // A FAILED company research is never reused — it is retried.
    const reusable =
      currentCompany &&
      currentCompany.status !== "FAILED" &&
      !run.refreshCompany &&
      ["FRESH", "AGING"].includes(freshnessOf(currentCompany, policy)) &&
      DEPTH_RANK[currentCompany.depth as Depth] >= DEPTH_RANK[depth] &&
      (currentCompany.websiteUrl ?? null) === (website?.url ?? null);
    let companyResearch = currentCompany;
    let companyDrafts: DraftClaim[] | null = null;
    if (reusable && run.kind === "JOB") {
      await ctx.step(
        "COMPANY_REUSED",
        "Reused current company research",
        "DONE",
        `Version ${currentCompany!.version} from ${currentCompany!.researchedAt.toISOString().slice(0, 10)}`,
      );
    } else {
      const res = await researchCompanyInRun(ctx, {
        companyId: company.id,
        companyName: company.name,
        website,
        careersUrl: target?.careersUrl ?? null,
        depth,
        aiSynthesis: Boolean(settings?.aiSynthesis),
      });
      companyResearch = res.research;
      companyDrafts = res.drafts;
      if (res.ai.status === "APPLIED")
        aiInfo = {
          used: true,
          provider: res.ai.provider,
          model: res.ai.model,
          generationId: res.ai.generationId,
        };
    }

    let finalStatus = companyResearch?.status ?? "FAILED";
    let claimsCreated = companyDrafts?.filter((d) => d.verification !== "REJECTED").length ?? 0;
    let claimsRejected = companyDrafts?.filter((d) => d.verification === "REJECTED").length ?? 0;
    let conflicts = companyDrafts
      ? new Set(
          companyDrafts.filter((d) => d.verification === "CONFLICTING").map((d) => d.valueKey),
        ).size
      : 0;
    let resultId = companyResearch?.id ?? null;

    if (job) {
      // Official job listing: the stored copy from the source (API / user entry) — not re-fetched.
      const jobSourceType: SourceType = job.sourceKey === "MANUAL" ? "MANUAL" : "OFFICIAL_JOB";
      const jobKey = `job:${job.id}:${job.contentHash}`;
      const { source } = await withUserContext(actor.userId, (t) =>
        upsertSource(t, actor.userId, {
          companyId: company.id,
          jobId: job.id,
          url: job.jobUrl.slice(0, 2048),
          normalizedUrl: jobKey,
          sourceType: jobSourceType,
          reliability: SOURCE_RELIABILITY[jobSourceType],
          relevance: "HIGH",
          origin: "JOB_RECORD",
          fetchStatus: "OK",
          httpStatus: null,
          error: null,
          title: job.title,
          publishedAt: null,
          sourceUpdatedAt: null,
          retrievedAt: job.lastSeenAt,
          contentHash: job.contentHash,
          contentText: job.description.slice(0, 20_000),
        }),
      );
      ctx.sources.set(jobKey, {
        id: source.id,
        key: jobKey,
        url: job.jobUrl,
        sourceType: jobSourceType,
        reliability: SOURCE_RELIABILITY[jobSourceType],
        ok: true,
        failed: false,
        page: null,
        relevance: "HIGH",
        changed: false,
      });
      ctx.sourceIds.set(jobKey, source.id);
      await recordRunSource(
        ctx,
        source.id,
        "USED",
        job.sourceKey === "MANUAL" ? "Job you entered" : `Stored from ${job.sourceKey}`,
      );
      await ctx.step(
        "OFFICIAL_JOB",
        "Read official job listing",
        "DONE",
        job.sourceKey === "MANUAL"
          ? "Job text you entered"
          : `Stored copy from ${job.sourceKey}, last seen ${job.lastSeenAt.toISOString().slice(0, 10)}`,
      );

      const { set } = await ensureJobRequirements(actor, job.id);
      const extracted = extractJobClaims(job, set.requirements, jobKey);
      const drafts: DraftClaim[] = [...extracted.claims];

      // Manual sources the user added for this job.
      const manual = await withUserContext(actor.userId, (t) =>
        t.researchSource.findMany({
          where: { userId: actor.userId, jobId: job.id, addedByUser: true },
          distinct: ["normalizedUrl"],
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      );
      for (const m of manual) {
        const s = await fetchSource(ctx, {
          url: m.url,
          sourceType: "MANUAL",
          origin: "MANUAL",
          companyId: company.id,
          jobId: job.id,
          addedByUser: true,
        });
        if (s?.ok && s.page) {
          const excerpt = s.page.description ?? s.page.text.slice(0, 400);
          if (excerpt)
            drafts.push({
              section: "MANUAL_SOURCE",
              claim: `Source you added (${s.page.title ?? s.url}): “${excerpt.slice(0, 400)}”`,
              claimType: "FACT",
              verification: "VERIFIED_FROM_SOURCE",
              method: "RULE",
              temporal: s.page.publishedAt ? "CURRENT" : "UNDATED",
              evidence: [
                {
                  sourceKey: s.key,
                  excerpt: excerpt.slice(0, 1000),
                  reference: "page description",
                },
              ],
            });
        }
      }
      if (manual.length)
        await ctx.step(
          "MANUAL_SOURCES_JOB",
          "Fetched job sources you added",
          "DONE",
          `${manual.length} source(s)`,
        );

      // Relevant company context for the role's themes (INTERPRETATION, quoting company evidence).
      const companyClaims = companyResearch
        ? await withUserContext(actor.userId, (t) =>
            t.researchClaim.findMany({
              where: {
                companyResearchId: companyResearch!.id,
                verification: { in: ["VERIFIED_FROM_SOURCE", "CONFLICTING"] },
                section: {
                  in: [
                    "WHAT_THEY_DO",
                    "PRODUCTS",
                    "ACTIVITY",
                    "TECHNOLOGY_SIGNAL",
                    "MARKETING_SIGNAL",
                    "GROWTH_SIGNAL",
                  ],
                },
              },
              include: { evidence: true },
              orderBy: { position: "asc" },
            }),
          )
        : [];
      let related = 0;
      for (const theme of extracted.themes) {
        const re = new RegExp(THEMES[theme.key]!.words.source, "i");
        for (const c of companyClaims) {
          if (related >= 6 || !re.test(c.claim)) continue;
          related++;
          drafts.push({
            section: "RELEVANT_CONTEXT",
            claim: `Related to the role's focus on ${theme.label}: ${c.claim}`,
            claimType: "INTERPRETATION",
            verification: "VERIFIED_FROM_SOURCE",
            method: "RULE",
            temporal: (c.temporal as "CURRENT" | "HISTORICAL" | "UNDATED") ?? "UNDATED",
            evidence: c.evidence.map((e) => ({
              sourceKey: e.sourceId,
              excerpt: e.excerpt,
              reference: e.sourceReference ?? "company research",
            })),
          });
        }
      }
      if (!related)
        drafts.push(
          unknownClaim(
            "RELEVANT_CONTEXT",
            "No company context related to this role's focus was found in the available sources.",
          ),
        );
      await ctx.step(
        "JOB_EVIDENCE",
        "Extracted job evidence",
        "DONE",
        `${extracted.claims.length} claims from the posting, ${related} related company items`,
      );

      const ai = await synthesize({
        userId: actor.userId,
        enabled: Boolean(settings?.aiSynthesis),
        subject: `${job.title} at ${company.name}`,
        companyName: company.name,
        drafts,
      });
      drafts.push(...ai.accepted, ...ai.rejected);
      if (ai.status === "APPLIED")
        aiInfo = {
          used: true,
          provider: ai.provider,
          model: ai.model,
          generationId: ai.generationId,
        };
      await ctx.step(
        "AI",
        "AI synthesis",
        ai.status === "APPLIED" ? "DONE" : ai.status === "OFF" ? "SKIPPED" : "FAILED",
        ai.status === "APPLIED"
          ? `${ai.accepted.length} claims kept for review, ${ai.rejected.length} rejected (unsupported)`
          : ai.status === "OFF"
            ? "Off in research settings"
            : ai.status === "UNAVAILABLE"
              ? "AI unavailable — deterministic research only"
              : "AI output failed validation — discarded",
      );

      // Validation summary + persistence of the job research version.
      const jobOutcomes = ctx.outcomes(
        (s) => s.sourceType === "OFFICIAL_JOB" || s.sourceType === "MANUAL" || s.key === jobKey,
      );
      const stats = computeStats(jobOutcomes, drafts);
      await ctx.step(
        "VALIDATE",
        "Validated claims",
        "DONE",
        `${stats.claimsVerified} verified, ${stats.claimsPending} pending review, ${stats.claimsRejected} rejected, ${stats.conflicts} conflicts`,
      );
      const companyStats = (companyResearch?.stats ?? {}) as Record<string, number>;
      const companyCompleteness =
        ((companyResearch?.completeness ?? {}) as { dimensions?: { key: string; state: string }[] })
          .dimensions ?? [];
      const dim = (key: string) => companyCompleteness.find((d) => d.key === key)?.state;
      const combined = {
        ...stats,
        sourcesFound: stats.sourcesFound + (companyStats.sourcesFound ?? 0),
        sourcesFailed: stats.sourcesFailed + (companyStats.sourcesFailed ?? 0),
        authoritative: stats.authoritative + (companyStats.authoritative ?? 0),
      };
      const completeness = computeCompleteness({
        job: {
          descriptionLength: job.description.length,
          purposeFound: drafts.some((d) => d.section === "ROLE_PURPOSE" && d.claimType === "FACT"),
          responsibilities: drafts.filter((d) => d.section === "RESPONSIBILITY").length,
        },
        websiteIdentified: Boolean(website),
        websiteFetched: dim("COMPANY_WEBSITE") === "COMPLETE",
        careers:
          dim("COMPANY_CAREERS") === "COMPLETE"
            ? "OK"
            : dim("COMPANY_CAREERS") === "PARTIAL"
              ? "FAILED"
              : "NOT_FOUND",
        activityChecked:
          dim("PUBLIC_ACTIVITY") !== "MISSING" && dim("PUBLIC_ACTIVITY") !== undefined,
        activityFound: dim("PUBLIC_ACTIVITY") === "COMPLETE" ? 1 : 0,
        stats: combined,
      });
      let status = researchStatus(stats);
      // Company-side gaps make the job research PARTIAL (or NEEDS_REVIEW) — never FAILED while
      // the job's own evidence is valid.
      if (status === "COMPLETED" && companyResearch && companyResearch.status !== "COMPLETED")
        status = companyResearch.status === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "PARTIAL";
      if (status === "COMPLETED" && !companyResearch) status = "PARTIAL";
      const match = await withUserContext(actor.userId, (t) =>
        t.jobMatch.findFirst({
          where: { userId: actor.userId, jobId: job.id, isCurrent: true },
          select: { id: true, overallStatus: true, computedAt: true },
        }),
      );
      const now = new Date();
      const saved = await withUserContext(actor.userId, async (t) => {
        await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`research:job:${actor.userId}:${job.id}`}, 0))`;
        const previous = await t.jobResearch.findFirst({
          where: { userId: actor.userId, jobId: job.id, isCurrent: true },
          include: {
            claims: { select: { claim: true }, where: { verification: { not: "REJECTED" } } },
          },
        });
        const last = await t.jobResearch.findFirst({
          where: { userId: actor.userId, jobId: job.id },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        await t.jobResearch.updateMany({
          where: { userId: actor.userId, jobId: job.id, isCurrent: true },
          data: { isCurrent: false },
        });
        const research = await t.jobResearch.create({
          data: {
            userId: actor.userId,
            jobId: job.id,
            companyId: company.id,
            runId,
            version: (last?.version ?? 0) + 1,
            status,
            depth,
            engineVersion: RESEARCH_ENGINE_VERSION,
            companyResearchId: companyResearch?.id ?? null,
            companyResearchVersion: companyResearch?.version ?? null,
            requirementSetId: set.id,
            jobContentHash: job.contentHash,
            jobSummary:
              drafts.find((d) => d.section === "ROLE_SUMMARY")?.claim.slice(0, 4000) ?? null,
            stats: combined as object,
            completeness: { dimensions: completeness } as object,
            researchedAt: now,
            lastVerifiedAt: now,
          },
        });
        const ids = await insertClaims(
          t,
          actor.userId,
          { jobResearchId: research.id },
          drafts,
          ctx.sourceIds,
        );
        const brief = jobBrief(
          drafts,
          ids,
          extracted.openQuestions,
          extracted.terms,
          match
            ? {
                matchId: match.id,
                overallStatus: match.overallStatus,
                computedAt: match.computedAt.toISOString(),
              }
            : null,
        );
        return t.jobResearch.update({
          where: { id: research.id },
          data: {
            brief: brief as object,
            changes: diff(
              previous?.claims ?? null,
              drafts,
              previous && previous.jobContentHash !== job.contentHash
                ? ["Job description changed"]
                : [],
            ) as object,
          },
        });
      });
      await ctx.step(
        "BRIEF",
        "Built research brief",
        "DONE",
        `Job research version ${saved.version}`,
      );
      finalStatus = saved.status;
      resultId = saved.id;
      claimsCreated += drafts.filter((d) => d.verification !== "REJECTED").length;
      claimsRejected += drafts.filter((d) => d.verification === "REJECTED").length;
      conflicts += new Set(
        drafts.filter((d) => d.verification === "CONFLICTING").map((d) => d.valueKey),
      ).size;
    }

    await withUserContext(actor.userId, (t) =>
      t.researchRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          completedAt: new Date(),
          heartbeatAt: new Date(),
          durationMs: Date.now() - started,
          steps: ctx.steps as object[],
          errors: ctx.errors.slice(0, 50) as object[],
          requestsMade: ctx.session.requests,
          sourcesAttempted: ctx.attempted + (job ? 1 : 0),
          sourcesSuccessful: [...ctx.sources.values()].filter((s) => s.ok).length,
          sourcesFailed: [...ctx.sources.values()].filter((s) => s.failed).length,
          claimsCreated,
          claimsRejected,
          aiUsed: aiInfo.used,
          aiProvider: aiInfo.provider,
          aiModel: aiInfo.model,
          aiGenerationId: aiInfo.generationId,
        },
      }),
    );
    await ctx.step("COMPLETE", "Complete", "DONE", finalStatus.toLowerCase().replace("_", " "));
    const meta = {
      runId,
      kind: run.kind,
      jobId: run.jobId,
      companyId: run.companyId,
      status: finalStatus,
      depth,
      sources: ctx.attempted,
      requests: ctx.session.requests,
      engineVersion: RESEARCH_ENGINE_VERSION,
    };
    await audit(
      actor,
      run.trigger === "REFRESH" ? "research_refreshed" : "research_completed",
      run.kind === "JOB" ? "job_research" : "company_research",
      resultId ?? runId,
      meta,
    );
    if (claimsCreated)
      await audit(actor, "claim_created", "research_run", runId, { count: claimsCreated });
    if (claimsRejected)
      await audit(actor, "claim_rejected", "research_run", runId, { count: claimsRejected });
    if (conflicts)
      await audit(actor, "claim_conflict", "research_run", runId, { count: conflicts });
    logger.info("research run finished", {
      runId,
      kind: run.kind,
      status: finalStatus,
      durationMs: Date.now() - started,
      requests: ctx.session.requests,
      sources: ctx.attempted,
      aiUsed: aiInfo.used,
      aiProvider: aiInfo.provider,
    });

    // A public catalog job whose own URL shows the employer's site: record it (system) for everyone.
    if (job && job.visibility === "PUBLIC" && !company.officialWebsite) {
      const fromJob = websiteFromJob(job);
      if (fromJob)
        await getDb().company.updateMany({
          where: { id: company.id, officialWebsite: null },
          data: {
            officialWebsite: fromJob.url,
            websiteConfidence: "LIKELY",
            websiteSource: fromJob.source,
          },
        });
    }
  } catch (error) {
    logger.error("research run failed", {
      runId,
      error:
        error instanceof Error
          ? { name: error.name, message: error.message.slice(0, 200) }
          : undefined,
    });
    ctx.errors.push({
      message: error instanceof Error ? error.message.slice(0, 300) : "Research failed",
    });
    await withUserContext(actor.userId, (t) =>
      t.researchRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          durationMs: Date.now() - started,
          steps: [
            ...ctx.steps,
            {
              key: "FAILED",
              label: "Research failed",
              status: "FAILED",
              detail: "Saved evidence was kept; nothing was marked complete.",
              at: new Date().toISOString(),
            },
          ] as object[],
          errors: ctx.errors.slice(0, 50) as object[],
          requestsMade: ctx.session.requests,
        },
      }),
    ).catch(() => undefined);
    await audit(actor, "research_failed", "research_run", runId, {
      kind: run.kind,
      jobId: run.jobId,
      companyId: run.companyId,
    }).catch(() => undefined);
  }
}

export { findCurrentJobResearch };
