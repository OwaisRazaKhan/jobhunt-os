import { FileSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSearchProvider } from "@/modules/research/search/provider";
import { listRecentResearch } from "@/modules/research/research.service";
import { DEPTH_CONFIG, DEPTHS } from "@/modules/research/types";
import { ResearchSettingsForm } from "@/modules/research/ui/research-controls";
import { day, ResearchStatusBadge, STATUS_TONE } from "@/modules/research/ui/research-parts";
import { getAiRoute } from "@/server/ai/orchestrator";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Research · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const actor = await requireActorOrRedirect();
  const { policy, jobResearch, runs } = await listRecentResearch(actor);
  const search = getSearchProvider();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Research"
        title="Research"
        description="Evidence-first job and company research. Start research from a job or a company page; every claim links to its source."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title={`Researched jobs (${jobResearch.length})`} />
            {jobResearch.length === 0 ? (
              <EmptyState
                icon={<FileSearch className="size-6" />}
                title="No research yet"
                description="Open a job and choose “Research this job”."
                action={
                  <Link href="/jobs" className="text-info text-xs hover:underline">
                    Browse jobs
                  </Link>
                }
              />
            ) : (
              <ul className="divide-border divide-y">
                {jobResearch.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/jobs/${r.jobId}/research`}
                        className="text-fg text-sm font-medium break-words hover:underline"
                      >
                        {r.job.title}
                      </Link>
                      <Link
                        href={`/companies/${r.job.company.id}`}
                        className="text-fg-muted block text-xs hover:underline"
                      >
                        {r.job.company.name}
                      </Link>
                    </div>
                    <div className="flex flex-col items-start gap-0.5 sm:items-end">
                      <ResearchStatusBadge status={r.status} freshness={r.freshness} />
                      <span className="text-fg-subtle font-mono text-[11px]">
                        v{r.version} · {r.depth.toLowerCase()} · {day(r.researchedAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Recent research runs"
              description="Every run is recorded with its sources, requests and outcome."
            />
            {runs.length === 0 ? (
              <p className="text-fg-muted px-4 py-3 text-xs">No runs yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="border-border text-fg-subtle border-b font-mono text-[10px] tracking-wide uppercase">
                    <tr>
                      <th className="px-4 py-2 font-normal">Target</th>
                      <th className="px-2 py-2 font-normal">Status</th>
                      <th className="px-2 py-2 font-normal">Sources</th>
                      <th className="px-4 py-2 font-normal">Started</th>
                    </tr>
                  </thead>
                  <tbody className="divide-border divide-y">
                    {runs.map((r) => (
                      <tr key={r.id}>
                        <td className="px-4 py-2">
                          <Link
                            href={
                              r.jobId ? `/jobs/${r.jobId}/research` : `/companies/${r.companyId}`
                            }
                            className="text-fg hover:underline"
                          >
                            {r.job?.title ?? r.company.name}
                          </Link>
                          <span className="text-fg-subtle block font-mono text-[11px]">
                            {r.kind.toLowerCase()} · {r.depth.toLowerCase()} ·{" "}
                            {r.trigger.toLowerCase()}
                            {r.aiUsed ? " · AI" : ""}
                          </span>
                        </td>
                        <td className="px-2 py-2">
                          <Badge tone={STATUS_TONE[r.status] ?? "info"}>
                            {r.status.toLowerCase().replace("_", " ")}
                          </Badge>
                        </td>
                        <td className="text-fg-muted px-2 py-2 font-mono">
                          {r.sourcesSuccessful} ok · {r.sourcesFailed} failed · {r.requestsMade} req
                        </td>
                        <td className="text-fg-muted px-4 py-2 font-mono whitespace-nowrap">
                          {day(r.createdAt)}
                          {r.durationMs !== null && (
                            <span className="text-fg-subtle block">
                              {(r.durationMs / 1000).toFixed(1)} s
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="Research settings"
              description="Private to you. Freshness thresholds decide Fresh / Aging / Stale."
            />
            <ResearchSettingsForm
              initial={{
                defaultDepth: policy.defaultDepth,
                freshDays: policy.freshDays,
                staleDays: policy.staleDays,
                aiSynthesis: policy.aiSynthesis,
              }}
              aiAvailable={(await getAiRoute(actor.userId, "research.synthesize")).steps.length > 0}
            />
          </Card>
          <Card>
            <CardHeader title="Depth tiers" description="Every tier is bounded (pages and time)." />
            <ul className="divide-border divide-y text-xs">
              {DEPTHS.map((d) => (
                <li key={d} className="px-4 py-2">
                  <span className="text-fg font-medium">{DEPTH_CONFIG[d].label}</span>{" "}
                  <span className="text-fg-subtle font-mono text-[11px]">
                    ≤ {DEPTH_CONFIG[d].maxPages} pages · ≤ {DEPTH_CONFIG[d].maxDurationMs / 1000} s
                  </span>
                  <p className="text-fg-muted">{DEPTH_CONFIG[d].description}</p>
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle px-4 py-2 text-[11px]">
              Public web search:{" "}
              {search
                ? `enabled (${search.id}, discovery hints only)`
                : "not configured (optional SEARXNG_URL) — official sites and your URLs are still used"}
              .
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
