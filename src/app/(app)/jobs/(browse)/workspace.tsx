import { ChevronLeft, ChevronRight, Play, Plug, Plus, Radar, SearchX, X } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import {
  EMPTY_SEARCH,
  hasFilters,
  parseSearchParams,
  searchHref,
  type JobSearchParams,
  type JobView,
} from "@/modules/jobs/search/params";
import { countJobStates } from "@/modules/jobs/search/job-state.service";
import { listSavedSearches, runSavedSearch } from "@/modules/jobs/search/saved-searches.service";
import { loadSearchOptions, searchJobs, SOURCE_LABELS } from "@/modules/jobs/search/search.service";
import { JobResults } from "@/modules/jobs/ui/job-results";
import { JobSearchForm } from "@/modules/jobs/ui/job-search-form";
import { ResultsToolbar } from "@/modules/jobs/ui/results-toolbar";
import {
  EXPERIENCE_LABELS,
  JOB_TYPE_LABELS,
  WORK_MODE_LABELS,
  type ExperienceLevel,
  type JobType,
  type WorkMode,
} from "@/modules/search-profiles/types";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/session";

type RawParams = Record<string, string | string[] | undefined>;

const PATHS: Record<JobView, string> = {
  all: "/jobs",
  bookmarked: "/jobs/bookmarked",
  hidden: "/jobs/hidden",
};

const TITLES: Record<JobView, { title: string; description: string }> = {
  all: {
    title: "Jobs",
    description:
      "Search the job catalog discovered from legitimate sources and the jobs you added. Every job keeps its source; unknown details stay unknown.",
  },
  bookmarked: {
    title: "Bookmarked jobs",
    description: "Jobs you bookmarked. Bookmarks are private to you and are not applications.",
  },
  hidden: {
    title: "Hidden jobs",
    description:
      "Jobs you hid from your results. Hiding never deletes a job — restore it any time.",
  },
};

function Tabs({
  view,
  counts,
  savedCount,
}: {
  view: JobView | "saved";
  counts: { bookmarked: number; hidden: number };
  savedCount: number;
}) {
  const tabs = [
    { key: "all", href: "/jobs", label: "All jobs" },
    { key: "bookmarked", href: "/jobs/bookmarked", label: "Bookmarked", n: counts.bookmarked },
    { key: "hidden", href: "/jobs/hidden", label: "Hidden", n: counts.hidden },
    { key: "saved", href: "/jobs/saved", label: "Saved searches", n: savedCount },
  ];
  return (
    <nav aria-label="Job views" className="border-border flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={view === t.key ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs whitespace-nowrap",
            view === t.key
              ? "border-accent text-fg"
              : "text-fg-muted hover:text-fg border-transparent",
          )}
        >
          {t.label}
          {t.n !== undefined && <span className="text-fg-subtle font-mono">{t.n}</span>}
        </Link>
      ))}
    </nav>
  );
}

export function JobsHeader({
  view,
  counts,
  savedCount,
}: {
  view: JobView | "saved";
  counts: { bookmarked: number; hidden: number };
  savedCount: number;
}) {
  const t =
    view === "saved"
      ? {
          title: "Saved searches",
          description:
            "Saved query + filter combinations for the Jobs page. Different from Search Profiles, which configure discovery.",
        }
      : TITLES[view];
  return (
    <>
      <PageHeader
        eyebrow="Discovery"
        title={t.title}
        description={t.description}
        actions={
          <>
            <Link href="/jobs/profiles" className={buttonClass("secondary", "sm")}>
              <Radar className="size-3.5" aria-hidden /> Search profiles
            </Link>
            <Link href="/jobs/discovery" className={buttonClass("secondary", "sm")}>
              <Play className="size-3.5" aria-hidden /> Discovery
            </Link>
            <Link href="/jobs/sources" className={buttonClass("secondary", "sm")}>
              <Plug className="size-3.5" aria-hidden /> Sources
            </Link>
            <Link href="/jobs/new" className={buttonClass("primary", "sm")}>
              <Plus className="size-3.5" aria-hidden /> Add job
            </Link>
          </>
        }
      />
      <Tabs view={view} counts={counts} savedCount={savedCount} />
    </>
  );
}

export async function JobsWorkspace({
  actor,
  view,
  raw,
}: {
  actor: Actor;
  view: JobView;
  raw: RawParams;
}) {
  const basePath = PATHS[view];
  const savedParam = typeof raw.saved === "string" ? raw.saved : null;

  // /jobs?saved=<id> alone opens a saved search: record the run, then show its full URL.
  if (view === "all" && savedParam && Object.keys(raw).length === 1) {
    const run = await runSavedSearch(actor, savedParam).catch((error) => {
      if (error instanceof AppError && ["NOT_FOUND", "VALIDATION_ERROR"].includes(error.code))
        return null;
      throw error;
    });
    if (!run) redirect("/jobs?missingSaved=1");
    const href = searchHref("/jobs", run.params);
    redirect(`${href}${href.includes("?") ? "&" : "?"}saved=${run.saved.id}`);
  }

  const { params, invalid } = parseSearchParams(raw);
  const [result, options, counts, saved] = await Promise.all([
    searchJobs(actor, params, { view }),
    loadSearchOptions(actor),
    countJobStates(actor),
    listSavedSearches(actor),
  ]);
  const activeSaved = view === "all" ? (saved.find((s) => s.id === savedParam) ?? null) : null;
  const withSaved = (href: string) =>
    activeSaved ? `${href}${href.includes("?") ? "&" : "?"}saved=${activeSaved.id}` : href;
  const href = (over: Partial<JobSearchParams>) =>
    withSaved(searchHref(basePath, params, { ...over, page: over.page ?? 1 }));

  // Active filters as removable chips (names come from the database).
  const name = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "Unknown";
  const chips: { label: string; href: string }[] = [];
  if (params.q) chips.push({ label: `“${params.q}”`, href: href({ q: "" }) });
  for (const c of params.country)
    chips.push({
      label: options.countries.find((x) => x.code === c)?.name ?? c,
      href: href({ country: params.country.filter((x) => x !== c) }),
    });
  for (const id of params.loc)
    chips.push({
      label: name(options.locations, id),
      href: href({ loc: params.loc.filter((x) => x !== id) }),
    });
  for (const id of params.cat)
    chips.push({
      label: name(options.categories, id),
      href: href({ cat: params.cat.filter((x) => x !== id) }),
    });
  for (const m of params.mode)
    chips.push({
      label: WORK_MODE_LABELS[m as WorkMode] ?? m,
      href: href({ mode: params.mode.filter((x) => x !== m) }),
    });
  for (const t of params.type)
    chips.push({
      label: JOB_TYPE_LABELS[t as JobType] ?? t,
      href: href({ type: params.type.filter((x) => x !== t) }),
    });
  for (const e of params.exp)
    chips.push({
      label: EXPERIENCE_LABELS[e as ExperienceLevel] ?? e,
      href: href({ exp: params.exp.filter((x) => x !== e) }),
    });
  if (params.cur && (params.salMin !== null || params.salMax !== null))
    chips.push({
      label: `${params.cur} ${params.salMin?.toLocaleString("en") ?? "0"}–${params.salMax?.toLocaleString("en") ?? "∞"}${params.per ? ` / ${params.per.toLowerCase()}` : ""}${params.salOnly ? " (comparable only)" : ""}`,
      href: href({ salMin: null, salMax: null, cur: null, per: null, salOnly: false }),
    });
  for (const s of params.src)
    chips.push({
      label: SOURCE_LABELS[s] ?? s,
      href: href({ src: params.src.filter((x) => x !== s) }),
    });
  for (const s of params.status)
    chips.push({
      label: `Status: ${s.toLowerCase()}`,
      href: href({ status: params.status.filter((x) => x !== s) }),
    });
  if (params.posted)
    chips.push({ label: `Posted ≤ ${params.posted}d`, href: href({ posted: null }) });
  if (params.disc)
    chips.push({ label: `Discovered ≤ ${params.disc}d`, href: href({ disc: null }) });
  if (params.seen) chips.push({ label: `Seen ≤ ${params.seen}d`, href: href({ seen: null }) });
  if (params.profile)
    chips.push({
      label: `Profile: ${name(options.profiles, params.profile)}`,
      href: href({ profile: null }),
    });

  const sourceKeys = new Set([...result.sourceCounts.keys(), ...params.src]);
  const sources = [...sourceKeys].map<[string, string, number]>((k) => [
    k,
    SOURCE_LABELS[k] ?? k,
    result.sourceCounts.get(k) ?? 0,
  ]);
  const filtered = hasFilters(params);
  const from = result.total ? (result.page - 1) * result.pageSize + 1 : 0;
  const to = Math.min(result.total, result.page * result.pageSize);

  return (
    <div className="flex flex-col gap-4">
      <JobsHeader view={view} counts={counts} savedCount={saved.length} />
      {raw.missingSaved === "1" && (
        <Alert tone="warning">That saved search no longer exists.</Alert>
      )}
      {invalid.length > 0 && (
        <Alert tone="warning" title="Some filters were ignored">
          Invalid values for: {invalid.join(", ")}. A salary range is only applied together with a
          currency.
        </Alert>
      )}
      {result.sortNote && <Alert tone="info">{result.sortNote}</Alert>}
      {activeSaved && (
        <p className="text-fg-muted text-xs">
          Saved search: <span className="text-fg font-medium">{activeSaved.name}</span>
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
        <Card className="h-fit p-3 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
          <JobSearchForm
            key={JSON.stringify(params)}
            basePath={basePath}
            params={params}
            savedId={activeSaved?.id ?? null}
            activeCount={chips.length}
            options={{
              countries: options.countries,
              locations: options.locations,
              categories: options.categories,
              profiles: options.profiles,
              sources,
            }}
          />
        </Card>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" role="status" aria-live="polite">
              <span className="font-mono font-semibold">{result.total.toLocaleString("en")}</span>{" "}
              <span className="text-fg-muted">
                {result.total === 1 ? "job" : "jobs"}
                {result.total > 0 && ` · showing ${from}–${to}`}
              </span>
            </p>
            <ResultsToolbar
              basePath={basePath}
              params={params}
              savedId={activeSaved?.id ?? null}
              canSave={filtered}
            />
          </div>
          {chips.length > 0 && (
            <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
              {chips.map((c) => (
                <li key={c.label + c.href}>
                  <Link
                    href={c.href}
                    className="border-accent/40 bg-accent/10 text-fg hover:border-accent inline-flex h-6 items-center gap-1 rounded-md border px-2 text-xs"
                    aria-label={`Remove filter ${c.label}`}
                  >
                    {c.label} <X className="size-3" aria-hidden />
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={withSaved(searchHref(basePath, { ...EMPTY_SEARCH, sort: params.sort }))}
                  className="text-fg-muted hover:text-fg px-1 text-xs underline"
                >
                  Clear all
                </Link>
              </li>
            </ul>
          )}

          <Card>
            {result.items.length === 0 ? (
              <EmptyState
                icon={<SearchX className="size-6" />}
                title="No jobs found"
                description={
                  result.total > 0
                    ? "This page is past the last result."
                    : filtered
                      ? "No jobs match your current search and filters. Try clearing a filter, changing the location or work mode, or running another Search Profile."
                      : view === "bookmarked"
                        ? "You have not bookmarked any jobs yet."
                        : view === "hidden"
                          ? "You have not hidden any jobs."
                          : "The catalog is empty. Run discovery with a Search Profile, or add a job yourself."
                }
                action={
                  filtered ? (
                    <Link href={basePath} className={buttonClass("secondary", "sm")}>
                      Clear filters
                    </Link>
                  ) : view === "all" ? (
                    <Link href="/jobs/discovery" className={buttonClass("primary", "sm")}>
                      <Play className="size-3.5" aria-hidden /> Run discovery
                    </Link>
                  ) : undefined
                }
              />
            ) : (
              <JobResults jobs={result.items} view={view} />
            )}
          </Card>

          {result.pageCount > 1 && (
            <nav aria-label="Pagination" className="flex items-center justify-between gap-2">
              {result.page > 1 ? (
                <Link
                  href={href({ page: result.page - 1 })}
                  className={buttonClass("secondary", "sm")}
                  rel="prev"
                >
                  <ChevronLeft className="size-3.5" aria-hidden /> Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-fg-muted font-mono text-xs">
                Page {result.page} of {result.pageCount}
              </span>
              {result.page < result.pageCount ? (
                <Link
                  href={href({ page: result.page + 1 })}
                  className={buttonClass("secondary", "sm")}
                  rel="next"
                >
                  Next <ChevronRight className="size-3.5" aria-hidden />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
