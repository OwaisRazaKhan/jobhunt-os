import { Bookmark, Play } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { countJobStates } from "@/modules/jobs/search/job-state.service";
import { listSavedSearches, savedSearchParams } from "@/modules/jobs/search/saved-searches.service";
import { loadSearchOptions, SOURCE_LABELS } from "@/modules/jobs/search/search.service";
import {
  DeleteSavedSearchButton,
  DuplicateSavedSearchButton,
  RenameSavedSearchButton,
} from "@/modules/jobs/ui/saved-search-controls";
import { SORT_LABELS, type JobSearchParams } from "@/modules/jobs/search/params";
import { requireActorOrRedirect } from "@/server/session";
import { JobsHeader } from "../workspace";

export const metadata: Metadata = { title: "Saved searches · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const stamp = (d: Date | null) =>
  d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "never";

function describe(p: JobSearchParams, options: Awaited<ReturnType<typeof loadSearchOptions>>) {
  const byId = (list: { id: string; name: string }[], ids: string[]) =>
    ids.map((id) => list.find((x) => x.id === id)?.name ?? "Unknown");
  const parts: [string, string][] = [];
  if (p.q) parts.push(["Query", `“${p.q}”`]);
  if (p.country.length)
    parts.push([
      "Country",
      p.country.map((c) => options.countries.find((x) => x.code === c)?.name ?? c).join(", "),
    ]);
  if (p.loc.length) parts.push(["Location", byId(options.locations, p.loc).join(", ")]);
  if (p.cat.length) parts.push(["Category", byId(options.categories, p.cat).join(", ")]);
  if (p.mode.length) parts.push(["Work mode", p.mode.join(", ").toLowerCase()]);
  if (p.type.length) parts.push(["Type", p.type.join(", ").toLowerCase().replaceAll("_", " ")]);
  if (p.exp.length) parts.push(["Experience", p.exp.join(", ").toLowerCase().replaceAll("_", " ")]);
  if (p.cur && (p.salMin !== null || p.salMax !== null))
    parts.push([
      "Salary",
      `${p.cur} ${p.salMin ?? 0}–${p.salMax ?? "∞"}${p.per ? ` / ${p.per.toLowerCase()}` : ""}`,
    ]);
  if (p.src.length) parts.push(["Source", p.src.map((s) => SOURCE_LABELS[s] ?? s).join(", ")]);
  if (p.status.length) parts.push(["Status", p.status.join(", ").toLowerCase()]);
  const fresh = [
    p.posted && `posted ≤ ${p.posted}d`,
    p.disc && `discovered ≤ ${p.disc}d`,
    p.seen && `seen ≤ ${p.seen}d`,
  ].filter(Boolean);
  if (fresh.length) parts.push(["Freshness", fresh.join(", ")]);
  if (p.profile) parts.push(["Search profile", byId(options.profiles, [p.profile]).join("")]);
  parts.push(["Sort", SORT_LABELS[p.sort]]);
  return parts;
}

export default async function SavedSearchesPage() {
  const actor = await requireActorOrRedirect();
  const [saved, options, counts] = await Promise.all([
    listSavedSearches(actor),
    loadSearchOptions(actor),
    countJobStates(actor),
  ]);
  return (
    <div className="flex flex-col gap-4">
      <JobsHeader view="saved" counts={counts} savedCount={saved.length} />
      {saved.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Bookmark className="size-6" />}
            title="No saved searches yet"
            description="On the Jobs page, search or filter, then click “Save search”."
            action={
              <Link href="/jobs" className={buttonClass("primary", "sm")}>
                Go to jobs
              </Link>
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {saved.map((s) => (
            <li key={s.id}>
              <Card className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold break-words">{s.name}</h2>
                    <p className="text-fg-subtle font-mono text-[11px]">
                      Last run {stamp(s.lastRunAt)} · updated {stamp(s.updatedAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-start gap-1">
                    <Link href={`/jobs?saved=${s.id}`} className={buttonClass("primary", "sm")}>
                      <Play className="size-3.5" aria-hidden /> Run
                    </Link>
                    <RenameSavedSearchButton id={s.id} name={s.name} />
                    <DuplicateSavedSearchButton id={s.id} name={s.name} />
                    <DeleteSavedSearchButton id={s.id} name={s.name} />
                  </div>
                </div>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                  {describe(savedSearchParams(s), options).map(([k, v]) => (
                    <div key={k} className="flex min-w-0 gap-2">
                      <dt className="text-fg-subtle shrink-0">{k}</dt>
                      <dd className="text-fg min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
