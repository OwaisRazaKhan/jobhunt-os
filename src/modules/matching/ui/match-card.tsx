import { ArrowRight, Gauge } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Alert, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import type { MatchCounts } from "../engine/types";
import {
  DIMENSION_LABELS,
  DIMENSION_STATUS_LABELS,
  type Dimension,
  type DimensionStatus,
  type Freshness,
} from "../types";
import { FRESHNESS_LABELS, MatchStatusBadge } from "./match-badge";
import { RunMatchButton } from "./run-match-button";

export interface MatchCardData {
  hasProfile: boolean;
  requirementCount: number;
  /** "migration" when the database is behind the code, "error" when matching could not load */
  problem?: "migration" | "error" | null;
  match: {
    id: string;
    overallStatus: string;
    hardBlockReason: string | null;
    summary: string | null;
    counts: unknown;
    matchingVersion: string;
    computedAt: Date;
    freshness: Freshness;
    requirementSet: { version: number } | null;
    dimensions: { dimension: string; status: string; summary: string }[];
  } | null;
}

const DIM_SYMBOL: Record<string, string> = {
  STRONG_MATCH: "✓✓",
  MATCH: "✓",
  PARTIAL_MATCH: "~",
  UNKNOWN: "?",
  GAP: "✗",
  BLOCKED: "⛔",
  NOT_APPLICABLE: "–",
};

export function CountGrid({ counts }: { counts: Partial<MatchCounts> }) {
  const items: [string, number | undefined, string][] = [
    ["Matched", counts.matched, "text-success"],
    ["Related / partial", (counts.related ?? 0) + (counts.partial ?? 0), "text-info"],
    ["Required gaps", counts.requiredGaps, "text-danger"],
    ["Preferred gaps", counts.preferredGaps, "text-warning"],
    ["Preference conflicts", counts.preferenceGaps, "text-warning"],
    ["Unknown / unverified", (counts.unknown ?? 0) + (counts.unverified ?? 0), "text-fg-muted"],
    ["Conflicts in your data", counts.conflicts, "text-warning"],
    ["Hard blocks", counts.hardBlocks, "text-danger"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      {items.map(([label, value, tone]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{label}</dt>
          <dd className={`font-mono font-semibold ${value ? tone : "text-fg-subtle"}`}>
            {value ?? 0}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Job-detail match card. Every number comes from stored requirement results; there is no score. */
export function MatchCard({ jobId, data }: { jobId: string; data: MatchCardData }) {
  const header = (
    <CardHeader
      title="Match"
      description="Your recorded facts vs this job's stated requirements. Not a hiring prediction."
    />
  );
  if (data.problem)
    return (
      <Card>
        {header}
        <div className="px-4 py-3">
          <Alert tone="warning">
            {data.problem === "migration"
              ? "The database needs an update. Run npm run db:migrate:deploy, then reload."
              : "Matching could not be loaded right now. Your data is safe — please try again."}
          </Alert>
        </div>
      </Card>
    );
  if (!data.hasProfile)
    return (
      <Card>
        {header}
        <EmptyState
          icon={<Gauge className="size-6" />}
          title="No candidate profile"
          description="Complete your candidate profile before running a match."
          action={
            <Link href="/candidate" className={buttonClass("secondary", "sm")}>
              Open profile
            </Link>
          }
        />
      </Card>
    );
  const m = data.match;
  if (!m)
    return (
      <Card>
        {header}
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-fg-muted text-sm">
            {data.requirementCount < 2
              ? "This job does not contain enough structured requirements for a reliable match."
              : "Match this job against your candidate profile."}
          </p>
          <RunMatchButton jobId={jobId} />
        </div>
      </Card>
    );
  const counts = (m.counts ?? {}) as Partial<MatchCounts>;
  return (
    <Card>
      {header}
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <MatchStatusBadge status={m.overallStatus} freshness={m.freshness} />
          <span className="text-fg-subtle font-mono text-[11px]">
            {counts.matched ?? 0}/{counts.total ?? 0} matched
          </span>
        </div>
        {m.overallStatus === "BLOCKED" && m.hardBlockReason && (
          <Alert tone="danger" title="Hard block">
            {m.hardBlockReason}
          </Alert>
        )}
        {m.summary && m.overallStatus !== "BLOCKED" && (
          <p className="text-fg text-xs">{m.summary}</p>
        )}
        <CountGrid counts={counts} />
        {m.dimensions.length > 0 && (
          <div>
            <p className="text-fg-muted mb-1 text-[11px] font-medium">Requirements alignment</p>
            <ul className="flex flex-col gap-0.5">
              {m.dimensions.map((d) => (
                <li
                  key={d.dimension}
                  className="flex items-center justify-between gap-2 text-xs"
                  title={d.summary}
                >
                  <span className="text-fg">
                    {DIMENSION_LABELS[d.dimension as Dimension] ?? d.dimension}
                  </span>
                  <span className="text-fg-muted">
                    <span aria-hidden>{DIM_SYMBOL[d.status] ?? "·"}</span>{" "}
                    {DIMENSION_STATUS_LABELS[d.status as DimensionStatus] ?? d.status}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {m.freshness !== "CURRENT" && (
          <Alert
            tone="warning"
            title={m.freshness === "STALE" ? "Stale result" : "Requires recalculation"}
          >
            {FRESHNESS_LABELS[m.freshness]}.
          </Alert>
        )}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Link href={`/jobs/${jobId}/match`} className={buttonClass("secondary", "sm")}>
            View details <ArrowRight className="size-3.5" aria-hidden />
          </Link>
          {m.freshness !== "CURRENT" && (
            <RunMatchButton jobId={jobId} label="Recalculate" recalculate />
          )}
        </div>
        <p className="text-fg-subtle font-mono text-[11px]">
          {m.computedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · {m.matchingVersion}
          {m.requirementSet ? ` · requirements v${m.requirementSet.version}` : ""}
        </p>
      </div>
    </Card>
  );
}
