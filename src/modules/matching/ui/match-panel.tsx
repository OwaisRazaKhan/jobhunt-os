import { Gauge } from "lucide-react";
import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, type Tone } from "@/components/ui/primitives";
import {
  DIMENSION_LABELS,
  DIMENSION_STATUS_LABELS,
  OVERALL_LABELS,
  type Dimension,
  type DimensionStatus,
  type Freshness,
  type OverallStatus,
} from "../types";

const OVERALL_TONE: Record<OverallStatus, Tone> = {
  STRONG_MATCH: "success",
  GOOD_MATCH: "success",
  PARTIAL_MATCH: "warning",
  REVIEW: "info",
  BLOCKED: "danger",
};

/** Symbols carry meaning alongside colour (never colour alone). */
const STATUS_SYMBOL: Record<DimensionStatus, string> = {
  STRONG_MATCH: "✓✓",
  MATCH: "✓",
  PARTIAL_MATCH: "~",
  UNKNOWN: "?",
  GAP: "✗",
  BLOCKED: "⛔",
  NOT_APPLICABLE: "–",
};

export interface MatchPanelData {
  hasProfile: boolean;
  requirementCount: number;
  match: null | {
    overallStatus: string;
    hardBlockReason: string | null;
    matchingVersion: string;
    freshness: Freshness;
    computedAt: Date;
    dimensions: { dimension: string; status: string; summary: string }[];
  };
}

export function MatchPanel({ data }: { data: MatchPanelData }) {
  const { match } = data;
  return (
    <Card>
      <CardHeader
        title="Match with your profile"
        description="Explainable comparison with your candidate facts. Not a prediction of hiring success."
        actions={
          match ? (
            <Badge tone={OVERALL_TONE[match.overallStatus as OverallStatus]}>
              {OVERALL_LABELS[match.overallStatus as OverallStatus]}
            </Badge>
          ) : (
            <Badge>Not analyzed</Badge>
          )
        }
      />
      {!data.hasProfile ? (
        <div className="flex flex-col items-start gap-2 px-4 py-4 text-sm">
          <p className="text-fg-muted">
            Matching compares this job with your candidate profile. You have not created one yet.
          </p>
          <Link href="/candidate" className={buttonClass("secondary", "sm")}>
            Build your profile
          </Link>
        </div>
      ) : !match ? (
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-fg-muted text-sm">
            No match analysis for this job yet. Structured requirements found:{" "}
            <span className="text-fg font-mono">{data.requirementCount}</span>.
          </p>
          <div>
            <button
              type="button"
              disabled
              className={buttonClass("secondary", "sm")}
              title="The matching rules are being built. Analysis will be enabled once they are ready."
            >
              <Gauge className="size-3.5" aria-hidden /> Analyze match
            </button>
            <p className="text-fg-subtle mt-1.5 text-[11px]">
              Available once the matching rules are built. No score is shown until a real analysis
              exists.
            </p>
          </div>
        </div>
      ) : (
        <div className="px-4 py-3">
          {match.hardBlockReason && (
            <p className="text-danger mb-2 text-sm">Blocked: {match.hardBlockReason}</p>
          )}
          <ul className="divide-border divide-y">
            {match.dimensions.map((d) => (
              <li
                key={d.dimension}
                className="flex items-baseline justify-between gap-3 py-1.5 text-xs"
              >
                <span className="text-fg">
                  {DIMENSION_LABELS[d.dimension as Dimension] ?? d.dimension}
                </span>
                <span className="text-fg-muted font-mono">
                  <span aria-hidden>{STATUS_SYMBOL[d.status as DimensionStatus]} </span>
                  {DIMENSION_STATUS_LABELS[d.status as DimensionStatus] ?? d.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-fg-subtle mt-2 font-mono text-[10px]">
            {match.matchingVersion} · {match.freshness.toLowerCase().replace(/_/g, " ")} · analyzed{" "}
            {match.computedAt.toISOString().slice(0, 16).replace("T", " ")} UTC
          </p>
        </div>
      )}
    </Card>
  );
}
