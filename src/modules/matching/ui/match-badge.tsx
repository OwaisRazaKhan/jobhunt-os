import { Badge, type Tone } from "@/components/ui/primitives";
import { OVERALL_LABELS, RESULT_LABELS, type Freshness } from "../types";

export const OVERALL_TONE: Record<string, Tone> = {
  STRONG_MATCH: "success",
  GOOD_MATCH: "success",
  PARTIAL_MATCH: "warning",
  LOW_MATCH: "neutral",
  BLOCKED: "danger",
  INSUFFICIENT_DATA: "info",
  REVIEW: "info",
};

/** Symbols carry meaning alongside colour (never colour alone). */
export const RESULT_SYMBOL: Record<string, string> = {
  MATCHED: "✓",
  RELATED: "≈",
  PARTIAL: "~",
  GAP: "✗",
  UNKNOWN: "?",
  UNVERIFIED: "!",
  CONFLICT: "⚠",
  BLOCKED: "⛔",
  NOT_APPLICABLE: "–",
};

export const RESULT_TONE: Record<string, Tone> = {
  MATCHED: "success",
  RELATED: "info",
  PARTIAL: "warning",
  GAP: "danger",
  UNKNOWN: "neutral",
  UNVERIFIED: "warning",
  CONFLICT: "warning",
  BLOCKED: "danger",
  NOT_APPLICABLE: "neutral",
};

export const FRESHNESS_LABELS: Record<Freshness, string> = {
  CURRENT: "Up to date",
  STALE: "Stale — your profile, settings or the job changed",
  REQUIRES_RECALCULATION: "Requires recalculation — the matching engine was updated",
};

export function MatchStatusBadge({ status, freshness }: { status: string; freshness?: Freshness }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={OVERALL_TONE[status] ?? "neutral"}>{OVERALL_LABELS[status] ?? status}</Badge>
      {freshness && freshness !== "CURRENT" && (
        <Badge tone="warning" title={FRESHNESS_LABELS[freshness]}>
          {freshness === "STALE" ? "Stale" : "Recalculate"}
        </Badge>
      )}
    </span>
  );
}

export function ResultBadge({ status }: { status: string }) {
  return (
    <Badge tone={RESULT_TONE[status] ?? "neutral"}>
      <span aria-hidden>{RESULT_SYMBOL[status] ?? "·"}</span> {RESULT_LABELS[status] ?? status}
    </Badge>
  );
}
