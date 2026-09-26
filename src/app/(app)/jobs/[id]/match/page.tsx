import { ArrowLeft, Gauge, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getJob } from "@/modules/jobs/jobs.service";
import type { EvidenceItem } from "@/modules/matching/engine/types";
import { getMatchDetail } from "@/modules/matching/match.service";
import type { RequirementKind } from "@/modules/matching/requirements/extract";
import {
  DIMENSION_LABELS,
  DIMENSION_STATUS_LABELS,
  OVERALL_DESCRIPTIONS,
  OVERALL_LABELS,
  SEMANTIC_ASSIST_LABELS,
  type Dimension,
  type DimensionStatus,
} from "@/modules/matching/types";
import { CountGrid } from "@/modules/matching/ui/match-card";
import { FRESHNESS_LABELS, MatchStatusBadge } from "@/modules/matching/ui/match-badge";
import { MatchResults, type ResultRow } from "@/modules/matching/ui/match-results";
import { CATEGORY_LABELS } from "@/modules/matching/ui/requirements-card";
import { RunMatchButton } from "@/modules/matching/ui/run-match-button";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Match details · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

function Missing({ jobId }: { jobId?: string }) {
  return (
    <div className="flex flex-col gap-5">
      <Link
        href={jobId ? `/jobs/${jobId}` : "/jobs"}
        className={buttonClass("ghost", "sm", "self-start")}
      >
        <ArrowLeft className="size-3.5" aria-hidden /> Back
      </Link>
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Match not found"
          description="This job or match version does not exist or is not yours."
        />
      </Card>
    </div>
  );
}

export default async function MatchDetailPage({
  params,
  searchParams,
}: PageProps<"/jobs/[id]/match">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const version = (await searchParams).version;
  if (!z.uuid().safeParse(id).success) return <Missing />;
  const versionId =
    typeof version === "string" && z.uuid().safeParse(version).success ? version : undefined;
  const notFound = (error: unknown) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  };
  const job = await getJob(actor, id).catch(notFound);
  if (!job) return <Missing />;
  const detail = await getMatchDetail(actor, id, versionId).catch(notFound);
  if (!detail) return <Missing jobId={id} />;
  const { match, history, hasProfile } = detail;

  const header = (
    <>
      <Link href={`/jobs/${id}`} className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Back to job
      </Link>
      <PageHeader
        eyebrow={`Match · ${job.job.company.name}`}
        title={job.job.title}
        description="Requirement-by-requirement comparison of this job's stated requirements with your recorded facts. It is not a prediction of hiring, interview or offer outcomes, and it is not a judgement of you."
      />
    </>
  );

  if (!match)
    return (
      <div className="flex flex-col gap-5">
        {header}
        <Card>
          <EmptyState
            icon={<Gauge className="size-6" />}
            title="No match yet"
            description={
              hasProfile
                ? "Match this job against your candidate profile."
                : "Complete your candidate profile before running a match."
            }
            action={
              hasProfile ? (
                <RunMatchButton jobId={id} />
              ) : (
                <Link href="/candidate" className={buttonClass("secondary", "sm")}>
                  Open profile
                </Link>
              )
            }
          />
        </Card>
      </div>
    );

  const rows: ResultRow[] = match.requirementResults.map((r) => ({
    id: r.id,
    status: r.status,
    relationship: r.relationship,
    gapKind: r.gapKind,
    isHardBlock: r.isHardBlock,
    method: r.method,
    explanation: r.explanation,
    evidence: (Array.isArray(r.evidence) ? r.evidence : []) as unknown as EvidenceItem[],
    requirement: {
      category: r.requirement.category,
      categoryLabel:
        CATEGORY_LABELS[r.requirement.category as RequirementKind] ?? r.requirement.category,
      requirementType: r.requirement.requirementType,
      text: r.requirement.text,
      sourceText: r.requirement.sourceText,
      sourceReference: r.requirement.sourceReference,
    },
  }));
  const counts = (match.counts ?? {}) as Record<string, number>;
  const explanation = (match.explanation ?? {}) as {
    requirementSetVersion?: number;
    extractorVersion?: string;
  };

  return (
    <div className="flex flex-col gap-5">
      {header}
      {!match.isCurrent && (
        <Alert tone="info" title="You are viewing an older match version">
          <Link href={`/jobs/${id}/match`} className="text-info hover:underline">
            Open the current version
          </Link>
        </Alert>
      )}
      {match.isCurrent && match.freshness !== "CURRENT" && (
        <Alert
          tone="warning"
          title={match.freshness === "STALE" ? "This result is stale" : "Requires recalculation"}
        >
          {FRESHNESS_LABELS[match.freshness]}. Recalculating keeps this version in the history.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <MatchStatusBadge
                  status={match.overallStatus}
                  freshness={match.isCurrent ? match.freshness : undefined}
                />
                <span className="text-fg-muted text-xs">
                  {OVERALL_DESCRIPTIONS[match.overallStatus]}
                </span>
              </div>
              {match.overallStatus === "BLOCKED" && match.hardBlockReason && (
                <Alert tone="danger" title="Hard block">
                  {match.hardBlockReason}
                </Alert>
              )}
              {match.summary && <p className="text-fg text-sm">{match.summary}</p>}
              {counts.conflicts ? (
                <Alert tone="warning" title="Conflicting data in your profile">
                  Some of your records disagree. Resolve them in your{" "}
                  <Link href="/candidate" className="text-info hover:underline">
                    candidate profile
                  </Link>
                  .
                </Alert>
              ) : null}
            </div>
          </Card>
          <Card>
            <CardHeader
              title={`Requirements (${rows.length})`}
              description="Expand a requirement to see the job's wording and the evidence from your profile."
            />
            {rows.length === 0 ? (
              <p className="text-fg-muted px-4 py-4 text-sm">
                This job does not contain enough structured requirements for a reliable match.
              </p>
            ) : (
              <MatchResults rows={rows} />
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Summary" />
            <div className="flex flex-col gap-3 px-4 py-3">
              <CountGrid counts={counts} />
              {match.isCurrent && (
                <RunMatchButton
                  jobId={id}
                  label={match.freshness === "CURRENT" ? "Recalculate" : "Recalculate now"}
                  recalculate
                  variant={match.freshness === "CURRENT" ? "secondary" : "primary"}
                />
              )}
            </div>
          </Card>
          {match.dimensions.length > 0 && (
            <Card>
              <CardHeader
                title="Requirements alignment"
                description="Per area: matched vs assessed requirements. No score."
              />
              <ul className="divide-border divide-y">
                {match.dimensions.map((d) => (
                  <li key={d.dimension} className="px-4 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-fg font-medium">
                        {DIMENSION_LABELS[d.dimension as Dimension] ?? d.dimension}
                      </span>
                      <span className="text-fg-muted">
                        {DIMENSION_STATUS_LABELS[d.status as DimensionStatus] ?? d.status}
                      </span>
                    </div>
                    <p className="text-fg-subtle mt-0.5">{d.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="How this was calculated" />
            <dl className="divide-border divide-y text-xs">
              {[
                ["Calculated", stamp(match.computedAt)],
                ["Matching engine", match.matchingVersion],
                [
                  "Requirement set",
                  explanation.requirementSetVersion
                    ? `v${explanation.requirementSetVersion} (${explanation.extractorVersion})`
                    : "—",
                ],
                [
                  "AI assistance",
                  SEMANTIC_ASSIST_LABELS[match.semanticAssist] ?? match.semanticAssist,
                ],
                ["Duration", match.durationMs !== null ? `${match.durationMs} ms` : "—"],
              ].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2 px-4 py-2">
                  <dt className="text-fg-muted">{k}</dt>
                  <dd className="text-fg break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card>
            <CardHeader title="History" description="Every calculation is kept." />
            <ul className="divide-border divide-y">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-2 text-xs">
                  <Link
                    href={h.isCurrent ? `/jobs/${id}/match` : `/jobs/${id}/match?version=${h.id}`}
                    className="flex items-center justify-between gap-2 hover:underline"
                    aria-current={h.id === match.id ? "page" : undefined}
                  >
                    <span className="text-fg">
                      {OVERALL_LABELS[h.overallStatus] ?? h.overallStatus}
                    </span>
                    <span className="text-fg-subtle font-mono text-[11px]">
                      {stamp(h.computedAt)}
                    </span>
                  </Link>
                  <span className="text-fg-subtle flex gap-1 font-mono text-[11px]">
                    {h.matchingVersion}
                    {h.requirementSet ? ` · req v${h.requirementSet.version}` : ""}
                    {h.isCurrent && <Badge tone="accent">current</Badge>}
                    {h.id === match.id && !h.isCurrent && <Badge>viewing</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
