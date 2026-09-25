import { ArrowLeft, Pencil, Radar } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { inputClass } from "@/components/forms/field-control";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import {
  getActiveDiscoveryRun,
  getDiscoveryRun,
  listDiscoveryRuns,
  previewDiscovery,
} from "@/modules/jobs/discovery/run.service";
import { toDiscoveryRunView } from "@/modules/jobs/discovery/run-view";
import { DiscoveryRunner } from "@/modules/jobs/ui/discovery-runner";
import { RunStatusBadge } from "@/modules/jobs/ui/run-progress";
import { listCategories, listCountries } from "@/modules/search-profiles/config.service";
import { listSearchProfiles } from "@/modules/search-profiles/profiles.service";
import { ProfileSummary } from "@/modules/search-profiles/ui/profile-summary";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Discovery · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const stamp = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");
const uuid = z.uuid();

export default async function DiscoveryPage({ searchParams }: PageProps<"/jobs/discovery">) {
  const actor = await requireActorOrRedirect();
  const params = await searchParams;
  const [profiles, countries, categories, recent, active] = await Promise.all([
    listSearchProfiles(actor),
    listCountries(actor),
    listCategories(actor),
    listDiscoveryRuns(actor, 15),
    getActiveDiscoveryRun(actor),
  ]);

  const header = (
    <>
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <PageHeader
        eyebrow="Discovery"
        title="Run discovery"
        description="Fetches your configured public ATS boards, saves every valid job once to the catalog, and links the ones that satisfy the selected search profile."
      />
    </>
  );

  if (profiles.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card>
          <EmptyState
            icon={<Radar className="size-6" />}
            title="Create a search profile first"
            description="Discovery always runs for a search profile: it decides which discovered jobs are linked to it."
            action={
              <Link href="/jobs/profiles/new" className={buttonClass("primary", "sm")}>
                New search profile
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const requested = uuid.safeParse(params.profile);
  const selected =
    profiles.find((p) => requested.success && p.id === requested.data) ??
    profiles.find((p) => active && p.id === active.profileId) ??
    profiles.find((p) => p.enabled) ??
    profiles[0]!;

  const requestedRun = uuid.safeParse(params.run);
  const shownRunId = active?.id ?? (requestedRun.success ? requestedRun.data : null);
  const [preview, shownRun] = await Promise.all([
    previewDiscovery(actor, selected.id),
    shownRunId
      ? getDiscoveryRun(actor, shownRunId).catch((error) => {
          if (error instanceof AppError && error.code === "NOT_FOUND") return null;
          throw error;
        })
      : null,
  ]);

  const countryNames = new Map(countries.map((c) => [c.code, c.name]));
  const selectedCategoryIds = new Set(selected.categories.map((c) => c.categoryId));
  const terms = categories.filter((c) => selectedCategoryIds.has(c.id));
  const disabledReason = !selected.enabled
    ? "This profile is disabled. Enable it in Search profiles to run it."
    : preview.boards.length === 0
      ? "No enabled source has boards configured for this profile. Add company boards in Sources and enable the source."
      : active && active.profileId !== selected.id
        ? "Another discovery run is in progress. Wait for it to finish."
        : null;

  return (
    <div className="flex flex-col gap-5">
      {header}

      <Card>
        <CardHeader
          title="Search profile"
          actions={
            <Link
              href={`/jobs/profiles/${selected.id}/edit`}
              className={buttonClass("ghost", "sm")}
            >
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Link>
          }
        />
        <div className="flex flex-col gap-4 px-4 py-3">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-col gap-1">
              <span className="text-fg-muted text-xs font-medium">Profile</span>
              <select name="profile" defaultValue={selected.id} className={inputClass}>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.enabled ? "" : " (disabled)"}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={buttonClass("secondary", "md")}>
              Select
            </button>
            <span className="text-fg-muted ml-auto text-xs">
              {selected._count.hits} linked jobs · last run {stamp(selected.lastRunAt)}
              {selected.enabled ? "" : " · "}
              {!selected.enabled && <Badge tone="warning">disabled</Badge>}
            </span>
          </form>
          <ProfileSummary profile={selected} countryNames={countryNames} full />
          {terms.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-fg-subtle font-mono text-[10px] tracking-wide uppercase">
                Category search terms (keywords, not skills)
              </p>
              {terms.map((c) => (
                <p key={c.id} className="text-xs">
                  <span className="text-fg font-medium">{c.name}:</span>{" "}
                  <span className="text-fg-muted font-mono">
                    {c.terms.map((t) => t.term).join(", ")}
                  </span>
                </p>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <p className="text-fg-subtle font-mono text-[10px] tracking-wide uppercase">
              Boards this run will fetch ({preview.boards.length})
            </p>
            {preview.boards.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {preview.boards.map((b) => (
                  <li key={`${b.sourceKey}:${b.board}`}>
                    <Badge tone="neutral" title={b.name ?? undefined}>
                      <span className="text-fg-subtle">{b.sourceName}</span>
                      <span className="font-mono">{b.board}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-fg-muted text-xs">
                None.{" "}
                <Link href="/jobs/sources" className="text-info hover:underline">
                  Configure sources
                </Link>
              </p>
            )}
            {preview.unavailableSources.length > 0 && (
              <p className="text-warning text-xs">
                Selected but unavailable (disabled or no boards):{" "}
                {preview.unavailableSources.join(", ")}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={shownRun && !active ? "Run details" : "Run"}
          description={
            shownRun
              ? `${shownRun.profile?.name ?? "Deleted profile"} · started ${stamp(shownRun.createdAt)} UTC`
              : "Progress and counts update live while the run is in progress."
          }
        />
        <div className="px-4 py-3">
          <DiscoveryRunner
            key={selected.id}
            profileId={selected.id}
            disabledReason={disabledReason}
            initialRun={shownRun ? toDiscoveryRunView(shownRun) : null}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent runs" count={recent.length} />
        {recent.length === 0 ? (
          <p className="text-fg-muted px-4 py-3 text-xs">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-xs tabular-nums">
              <thead className="text-fg-subtle text-left font-mono text-[10px] uppercase">
                <tr className="border-border border-b">
                  <th className="px-4 py-1.5 font-normal">Started (UTC)</th>
                  <th className="px-4 py-1.5 font-normal">Profile</th>
                  <th className="px-4 py-1.5 font-normal">Trigger</th>
                  <th className="px-4 py-1.5 font-normal">Status</th>
                  <th className="px-4 py-1.5 text-right font-normal">Boards</th>
                  <th className="px-4 py-1.5 text-right font-normal">Fetched</th>
                  <th className="px-4 py-1.5 text-right font-normal">New</th>
                  <th className="px-4 py-1.5 text-right font-normal">Matched</th>
                  <th className="px-4 py-1.5 font-normal" />
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {recent.map((r) => (
                  <tr key={r.id} className={r.id === shownRun?.id ? "bg-surface-2" : undefined}>
                    <td className="px-4 py-1.5 font-mono">{stamp(r.createdAt)}</td>
                    <td className="px-4 py-1.5">{r.profile?.name ?? "Deleted profile"}</td>
                    <td className="text-fg-muted px-4 py-1.5">{r.trigger.toLowerCase()}</td>
                    <td className="px-4 py-1.5">
                      <RunStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      {r.sourcesDone}/{r.sourcesTotal}
                    </td>
                    <td className="px-4 py-1.5 text-right">{r.fetched}</td>
                    <td className="px-4 py-1.5 text-right">{r.created}</td>
                    <td className="px-4 py-1.5 text-right">{r.matched}</td>
                    <td className="px-4 py-1.5 text-right">
                      <Link
                        href={`/jobs/discovery?profile=${r.profileId ?? selected.id}&run=${r.id}`}
                        className="text-info hover:underline"
                      >
                        Details
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {active && active.profileId !== selected.id && (
        <Alert tone="info">
          A run for another profile is in progress; its progress is shown above.
        </Alert>
      )}
    </div>
  );
}
