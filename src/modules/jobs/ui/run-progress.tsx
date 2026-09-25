import { Badge, ProgressBar, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import type { DiscoveryRunView, RunCounter, SyncRunView } from "../discovery/run-view";

/** Presentational progress of a discovery run (numbers come straight from the DB). */

export const RUN_STATUS_TONE: Record<string, Tone> = {
  QUEUED: "info",
  RUNNING: "info",
  SUCCEEDED: "success",
  PARTIAL: "warning",
  FAILED: "danger",
  CANCELLED: "neutral",
  SKIPPED: "neutral",
};

const STAGES = [
  ["FETCHING", "Fetch"],
  ["NORMALIZING", "Normalize"],
  ["DEDUPLICATING", "Deduplicate & save"],
  ["MATCHING_PROFILE", "Match profile"],
  ["DONE", "Done"],
] as const;

const COUNTER_LABELS: [RunCounter, string, string][] = [
  ["fetched", "Fetched", "Postings returned by the sources"],
  ["valid", "Valid", "Passed the canonical job schema"],
  ["invalid", "Invalid", "Rejected by validation (field paths recorded)"],
  ["created", "New jobs", "Canonical jobs created"],
  ["updated", "Updated", "Existing jobs whose content changed"],
  ["unchanged", "Unchanged", "Seen again, no change"],
  ["duplicates", "Merged", "Same job from another board, attached as a second source"],
  ["flagged", "Possible duplicates", "Similar jobs flagged for review, never merged"],
  ["closed", "Closed", "No longer listed after a complete fetch"],
  ["matched", "Matched profile", "Jobs linked to this search profile"],
];

export function RunStatusBadge({ status }: { status: string }) {
  return <Badge tone={RUN_STATUS_TONE[status] ?? "neutral"}>{status.toLowerCase()}</Badge>;
}

function StageSteps({ stage, status }: { stage: string; status: string }) {
  const current = STAGES.findIndex(([key]) => key === stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Pipeline stage">
      {STAGES.map(([key, label], i) => {
        const done = current > i || (stage === "DONE" && key === "DONE");
        const active = current === i && stage !== "DONE";
        return (
          <li
            key={key}
            aria-current={active ? "step" : undefined}
            className={cn(
              "rounded-sm border px-1.5 py-0.5",
              done && status !== "FAILED" && "border-success/30 text-success",
              done && status === "FAILED" && "border-danger/30 text-danger",
              active && "border-info/40 bg-info/10 text-info animate-pulse",
              !done && !active && "border-border text-fg-subtle",
            )}
          >
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export function SyncRunsTable({ rows }: { rows: SyncRunView[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-xs tabular-nums">
        <thead className="text-fg-subtle text-left font-mono text-[10px] uppercase">
          <tr className="border-border border-b">
            <th className="px-3 py-1.5 font-normal">Board</th>
            <th className="px-3 py-1.5 font-normal">Status</th>
            <th className="px-3 py-1.5 text-right font-normal">Fetched</th>
            <th className="px-3 py-1.5 text-right font-normal">Valid</th>
            <th className="px-3 py-1.5 text-right font-normal">New</th>
            <th className="px-3 py-1.5 text-right font-normal">Updated</th>
            <th className="px-3 py-1.5 text-right font-normal">Merged</th>
            <th className="px-3 py-1.5 text-right font-normal">Closed</th>
            <th className="px-3 py-1.5 text-right font-normal">Time</th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-1.5">
                <span className="text-fg-subtle font-mono">{r.sourceKey}</span>{" "}
                <span className="font-mono">{r.board}</span>
                {r.truncated && (
                  <Badge tone="warning" className="ml-1" title="Limits reached; closure skipped">
                    truncated
                  </Badge>
                )}
                {r.errorMessage && <p className="text-danger mt-0.5">{r.errorMessage}</p>}
              </td>
              <td className="px-3 py-1.5">
                <RunStatusBadge status={r.status} />
              </td>
              <td className="px-3 py-1.5 text-right">{r.fetched}</td>
              <td className="px-3 py-1.5 text-right">{r.valid}</td>
              <td className="px-3 py-1.5 text-right">{r.created}</td>
              <td className="px-3 py-1.5 text-right">{r.updated}</td>
              <td className="px-3 py-1.5 text-right">{r.duplicates}</td>
              <td className="px-3 py-1.5 text-right">{r.closed}</td>
              <td className="text-fg-muted px-3 py-1.5 text-right">
                {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "…"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunProgress({ run }: { run: DiscoveryRunView }) {
  const pct = run.sourcesTotal ? (run.sourcesDone / run.sourcesTotal) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <RunStatusBadge status={run.status} />
        <StageSteps stage={run.stage} status={run.status} />
        <span className="text-fg-muted ml-auto font-mono text-[11px]">
          {run.sourcesDone}/{run.sourcesTotal} boards
        </span>
      </div>
      <ProgressBar
        value={run.terminal ? 100 : pct}
        tone={
          run.status === "SUCCEEDED" ? "success" : run.status === "PARTIAL" ? "warning" : "accent"
        }
        label="Boards processed"
      />
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {COUNTER_LABELS.map(([key, label, help]) => (
          <div key={key} className="border-border rounded-md border px-2 py-1.5" title={help}>
            <dt className="text-fg-subtle text-[10px] uppercase">{label}</dt>
            <dd
              className={cn(
                "font-mono text-sm tabular-nums",
                key === "matched" && run.counts.matched > 0 && "text-accent",
              )}
            >
              {run.counts[key]}
            </dd>
          </div>
        ))}
      </dl>
      {run.message && (
        <p
          className={cn(
            "text-xs",
            run.status === "FAILED" || run.status === "PARTIAL" ? "text-warning" : "text-fg-muted",
          )}
        >
          {run.message}
        </p>
      )}
    </div>
  );
}
