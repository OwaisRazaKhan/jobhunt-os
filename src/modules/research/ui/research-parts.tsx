import { ExternalLink } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/primitives";
import { isPublicHttpUrl } from "@/lib/safe-url";
import {
  CLAIM_TYPE_LABELS,
  FRESHNESS_LABELS,
  SOURCE_TYPE_LABELS,
  STATUS_LABELS,
  VERIFICATION_LABELS,
  type ClaimType,
  type CompletenessDimension,
  type Freshness,
  type ResearchStats,
  type ResearchStatus,
  type SourceType,
  type Verification,
} from "../types";

/**
 * Evidence-first presentation. External content is rendered as TEXT only (React escapes it);
 * links are shown only for safe public http(s) URLs with rel="noopener noreferrer nofollow".
 */

export const STATUS_TONE: Record<string, Tone> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  PARTIAL: "warning",
  NEEDS_REVIEW: "warning",
  FAILED: "danger",
  STALE: "warning",
};
const TYPE_TONE: Record<ClaimType, Tone> = {
  FACT: "success",
  INTERPRETATION: "info",
  INFERENCE: "ai",
  UNKNOWN: "neutral",
  CONFLICTING: "warning",
};
const VERIFY_TONE: Record<Verification, Tone> = {
  VERIFIED_FROM_SOURCE: "success",
  PENDING_REVIEW: "info",
  REJECTED: "danger",
  CONFLICTING: "warning",
};

export const stamp = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";
export const day = (d: Date | string | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : "—";

export function SafeUrl({ url, label }: { url: string; label?: string }) {
  if (!isPublicHttpUrl(url))
    return <span className="text-fg-muted font-mono break-all">{label ?? url}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-info inline-flex max-w-full items-center gap-1 hover:underline"
    >
      <span className="truncate">{label ?? url.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

export function ResearchStatusBadge({
  status,
  freshness,
}: {
  status: ResearchStatus | string;
  freshness?: Freshness;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={STATUS_TONE[status] ?? "neutral"}>
        {STATUS_LABELS[status as ResearchStatus] ?? status}
      </Badge>
      {/* A failed result has nothing to be fresh about. */}
      {freshness && freshness !== "UNKNOWN" && status !== "FAILED" && (
        <Badge
          tone={freshness === "FRESH" ? "success" : freshness === "AGING" ? "info" : "warning"}
        >
          {FRESHNESS_LABELS[freshness]}
        </Badge>
      )}
    </span>
  );
}

export interface ClaimView {
  id: string;
  section: string;
  claim: string;
  claimType: string;
  verification: string;
  method: string;
  temporal: string;
  rejectionReason: string | null;
  evidence: {
    id: string;
    excerpt: string;
    sourceReference: string | null;
    source: {
      id: string;
      url: string;
      title: string | null;
      sourceType: string;
      reliability: string;
      retrievedAt: Date | null;
      publishedAt: Date | null;
      addedByUser: boolean;
    };
  }[];
}

/** One claim with its type, verification and an expandable evidence drawer. */
export function ClaimItem({ claim, compact = false }: { claim: ClaimView; compact?: boolean }) {
  const type = claim.claimType as ClaimType;
  const verification = claim.verification as Verification;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={TYPE_TONE[type] ?? "neutral"}>{CLAIM_TYPE_LABELS[type] ?? type}</Badge>
        {type !== "UNKNOWN" && (
          <Badge tone={VERIFY_TONE[verification] ?? "neutral"}>
            {VERIFICATION_LABELS[verification] ?? verification}
          </Badge>
        )}
        {claim.method === "AI" && <Badge tone="ai">AI</Badge>}
        {claim.temporal === "HISTORICAL" && <Badge>Historical</Badge>}
      </div>
      <p
        className={
          compact ? "text-fg mt-1 text-xs break-words" : "text-fg mt-1 text-sm break-words"
        }
      >
        {claim.claim}
      </p>
      {claim.rejectionReason && (
        <p className="text-danger mt-0.5 text-xs">Rejected: {claim.rejectionReason}</p>
      )}
      {claim.evidence.length > 0 && (
        <details className="group mt-1">
          <summary className="text-info cursor-pointer text-xs select-none hover:underline">
            View evidence ({claim.evidence.length})
          </summary>
          <ul className="border-border mt-1.5 flex flex-col gap-2 border-l-2 pl-3">
            {claim.evidence.map((e) => (
              <li key={e.id} className="text-xs">
                <blockquote className="text-fg break-words whitespace-pre-wrap">
                  “{e.excerpt}”
                </blockquote>
                <div className="text-fg-subtle mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px]">
                  <span>
                    {SOURCE_TYPE_LABELS[e.source.sourceType as SourceType] ?? e.source.sourceType}
                  </span>
                  <span>· {e.source.reliability.toLowerCase().replace("_", " ")}</span>
                  {e.sourceReference && <span>· {e.sourceReference}</span>}
                  <span>· retrieved {day(e.source.retrievedAt)}</span>
                  {e.source.publishedAt && <span>· published {day(e.source.publishedAt)}</span>}
                </div>
                <div className="mt-0.5 text-[11px]">
                  {e.source.url.startsWith("http") ? (
                    <SafeUrl url={e.source.url} label={e.source.title ?? undefined} />
                  ) : (
                    <span className="text-fg-muted">{e.source.title}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

export function ClaimList({
  claims,
  empty,
  compact,
}: {
  claims: ClaimView[];
  empty?: string;
  compact?: boolean;
}) {
  if (!claims.length) return empty ? <p className="text-fg-subtle py-2 text-xs">{empty}</p> : null;
  return (
    <ul className="divide-border divide-y">
      {claims.map((c) => (
        <ClaimItem key={c.id} claim={c} compact={compact} />
      ))}
    </ul>
  );
}

export function StatsGrid({ stats }: { stats: Partial<ResearchStats> }) {
  const rows: [string, number | undefined, string?][] = [
    ["Sources found", stats.sourcesFound],
    ["Authoritative", stats.authoritative],
    ["Strong", stats.strong],
    ["Secondary", stats.secondary],
    ["Discovery-only", stats.discoveryOnly],
    ["Sources failed", stats.sourcesFailed, "text-warning"],
    ["Claims verified", stats.claimsVerified, "text-success"],
    ["Pending review", stats.claimsPending, "text-info"],
    ["Rejected", stats.claimsRejected, "text-danger"],
    ["Unknowns", stats.claimsUnknown],
    ["Conflicts", stats.conflicts, "text-warning"],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
      {rows.map(([label, value, tone]) => (
        <div key={label} className="flex items-baseline justify-between gap-2">
          <dt className="text-fg-muted">{label}</dt>
          <dd
            className={`font-mono font-semibold ${value ? (tone ?? "text-fg") : "text-fg-subtle"}`}
          >
            {value ?? 0}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function CompletenessList({ dimensions }: { dimensions: CompletenessDimension[] }) {
  const symbol = { COMPLETE: "✓", PARTIAL: "~", MISSING: "✗" } as const;
  const tone = {
    COMPLETE: "text-success",
    PARTIAL: "text-warning",
    MISSING: "text-fg-subtle",
  } as const;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {dimensions.map((d) => (
        <li key={d.key} className="flex items-baseline justify-between gap-2" title={d.detail}>
          <span className="text-fg">
            <span className={tone[d.state]} aria-hidden>
              {symbol[d.state]}
            </span>{" "}
            {d.label}
          </span>
          <span className="text-fg-subtle text-right">{d.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export interface RunSourceRow {
  id: string;
  outcome: string;
  note: string | null;
  source: {
    url: string;
    title: string | null;
    sourceType: string;
    reliability: string;
    fetchStatus: string;
    httpStatus: number | null;
    error: string | null;
    retrievedAt: Date | null;
    publishedAt: Date | null;
    relevance: string;
  };
}

const OUTCOME_TONE: Record<string, Tone> = {
  USED: "success",
  UNCHANGED: "success",
  FAILED: "danger",
  SKIPPED_IRRELEVANT: "neutral",
  SKIPPED_LIMIT: "neutral",
};

export function SourcesTable({ rows }: { rows: RunSourceRow[] }) {
  if (!rows.length)
    return <p className="text-fg-subtle px-4 py-3 text-xs">No sources recorded for this run.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-xs">
        <thead className="border-border text-fg-subtle border-b font-mono text-[10px] tracking-wide uppercase">
          <tr>
            <th className="px-4 py-2 font-normal">Source</th>
            <th className="px-2 py-2 font-normal">Type</th>
            <th className="px-2 py-2 font-normal">Result</th>
            <th className="px-4 py-2 font-normal">Retrieved</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="max-w-72 px-4 py-2">
                <span className="text-fg block truncate">{r.source.title ?? "—"}</span>
                {r.source.url.startsWith("http") ? (
                  <SafeUrl url={r.source.url} />
                ) : (
                  <span className="text-fg-subtle">stored job record</span>
                )}
              </td>
              <td className="text-fg-muted px-2 py-2">
                {SOURCE_TYPE_LABELS[r.source.sourceType as SourceType] ?? r.source.sourceType}
                <span className="text-fg-subtle block font-mono text-[11px]">
                  {r.source.reliability.toLowerCase().replace("_", " ")}
                </span>
              </td>
              <td className="px-2 py-2">
                <Badge tone={OUTCOME_TONE[r.outcome] ?? "neutral"}>
                  {r.outcome.toLowerCase().replace("_", " ")}
                </Badge>
                {(r.source.error || r.note) && (
                  <span className="text-fg-subtle mt-0.5 block text-[11px]">
                    {r.source.error ?? r.note}
                  </span>
                )}
              </td>
              <td className="text-fg-muted px-4 py-2 font-mono whitespace-nowrap">
                {day(r.source.retrievedAt)}
                {r.source.publishedAt && (
                  <span className="text-fg-subtle block">pub. {day(r.source.publishedAt)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
