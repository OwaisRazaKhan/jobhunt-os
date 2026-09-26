import { Gauge } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { latestMatchBatch } from "@/modules/matching/batch.service";
import type { MatchCounts } from "@/modules/matching/engine/types";
import { getMatchingPreferences, listCurrentMatches } from "@/modules/matching/match.service";
import { MAX_BATCH_JOBS, OVERALL_LABELS, OVERALL_STATUSES } from "@/modules/matching/types";
import { BatchProgress, MatchJobsButton } from "@/modules/matching/ui/batch-controls";
import { MatchStatusBadge } from "@/modules/matching/ui/match-badge";
import { MatchingSettingsForm } from "@/modules/matching/ui/matching-settings-form";
import { getAiRoute } from "@/server/ai/orchestrator";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Matches · JOBHUNT OS" };
export const dynamic = "force-dynamic";
/** Batches continue after the response (after()); allow time on platforms that honour this. */
export const maxDuration = 300;

export default async function MatchesPage({ searchParams }: PageProps<"/matches">) {
  const actor = await requireActorOrRedirect();
  const raw = (await searchParams).status;
  const status =
    typeof raw === "string" && (OVERALL_STATUSES as readonly string[]).includes(raw) ? raw : null;
  const [all, batch, prefs] = await Promise.all([
    listCurrentMatches(actor),
    latestMatchBatch(actor),
    getMatchingPreferences(actor),
  ]);
  const matches = status ? all.filter((m) => m.overallStatus === status) : all;
  const stale = all
    .filter((m) => m.freshness !== "CURRENT")
    .map((m) => m.jobId)
    .slice(0, MAX_BATCH_JOBS);
  const byStatus = new Map<string, number>();
  for (const m of all) byStatus.set(m.overallStatus, (byStatus.get(m.overallStatus) ?? 0) + 1);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Matching"
        title="Matches"
        description="Jobs you matched against your candidate profile. Each result compares the job's stated requirements with your recorded facts — never a prediction of hiring outcomes. Jobs are only matched when you ask."
        actions={
          stale.length > 0 ? (
            <MatchJobsButton
              jobIds={stale}
              label={`Recalculate ${stale.length} stale`}
              variant="primary"
            />
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <nav
            aria-label="Filter by status"
            className="border-border flex gap-1 overflow-x-auto border-b px-3"
          >
            {[null, ...OVERALL_STATUSES].map((s) => (
              <Link
                key={s ?? "all"}
                href={s ? `/matches?status=${s}` : "/matches"}
                aria-current={status === s ? "page" : undefined}
                className={cn(
                  "-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-2 text-xs whitespace-nowrap",
                  status === s
                    ? "border-accent text-fg"
                    : "text-fg-muted hover:text-fg border-transparent",
                )}
              >
                {s ? OVERALL_LABELS[s] : "All"}
                <span className="text-fg-subtle font-mono">
                  {s ? (byStatus.get(s) ?? 0) : all.length}
                </span>
              </Link>
            ))}
          </nav>
          {matches.length === 0 ? (
            <EmptyState
              icon={<Gauge className="size-6" />}
              title={all.length ? "No matches with this status" : "No matches yet"}
              description={
                all.length
                  ? "Try another status filter."
                  : "Open a job and run a match, or use “Match these jobs” on the Jobs page."
              }
              action={
                <Link href="/jobs" className={buttonClass("secondary", "sm")}>
                  Browse jobs
                </Link>
              }
            />
          ) : (
            <ul className="divide-border divide-y">
              {matches.map((m) => {
                const c = (m.counts ?? {}) as Partial<MatchCounts>;
                return (
                  <li
                    key={m.id}
                    className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/jobs/${m.jobId}/match`}
                        className="text-fg text-sm font-medium break-words hover:underline"
                      >
                        {m.job.title}
                      </Link>
                      <p className="text-fg-muted text-xs">{m.job.company.name}</p>
                      <p className="text-fg-subtle font-mono text-[11px]">
                        {c.matched ?? 0}/{c.total ?? 0} matched · {c.requiredGaps ?? 0} required
                        gaps · {(c.unknown ?? 0) + (c.unverified ?? 0)} unknown
                        {c.hardBlocks ? ` · ${c.hardBlocks} hard block` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <MatchStatusBadge status={m.overallStatus} freshness={m.freshness} />
                      <span className="text-fg-subtle font-mono text-[11px]">
                        {m.computedAt.toISOString().slice(0, 10)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Batch matching"
              description={`Explicit only · up to ${MAX_BATCH_JOBS} jobs per batch · one at a time.`}
            />
            {batch ? (
              <BatchProgress key={`${batch.id}-${batch.status}`} initial={batch} />
            ) : (
              <p className="text-fg-muted px-4 py-3 text-xs">
                No batches yet. On the Jobs page, filter the list and choose “Match these jobs”.
              </p>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Matching settings"
              description="Separate from your candidate profile and your search profiles. Changing them marks matches stale."
            />
            <MatchingSettingsForm
              initial={prefs}
              aiAvailable={
                (await getAiRoute(actor.userId, "matching.semantic_skills")).steps.length > 0
              }
            />
          </Card>
        </div>
      </div>
    </div>
  );
}
