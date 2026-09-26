"use client";

import { Gauge, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { cancelMatchBatchAction, startMatchBatchAction } from "@/app/(app)/matches/actions";
import { buttonClass } from "@/components/ui/button";
import { Alert, ProgressBar } from "@/components/ui/primitives";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { OVERALL_LABELS } from "../types";

export interface BatchView {
  id: string;
  status: string;
  total: number;
  done: number;
  failed: number;
  skipped: number;
  counts: unknown;
  cancelRequested: boolean;
  message: string | null;
}

const ACTIVE = new Set(["QUEUED", "RUNNING"]);

/**
 * Explicit "Match these jobs" button. Nothing is matched automatically; the user chooses.
 * On success it goes to /matches where real progress is shown.
 */
export function MatchJobsButton({
  jobIds,
  label,
  variant = "secondary",
}: {
  jobIds: string[];
  label: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(startMatchBatchAction, INITIAL_ACTION_STATE);
  useEffect(() => {
    if (state.ok && state.data?.id) router.push("/matches");
  }, [state, router]);
  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      {jobIds.map((id) => (
        <input key={id} type="hidden" name="jobId" value={id} />
      ))}
      <button
        type="submit"
        disabled={pending || jobIds.length === 0}
        className={buttonClass(variant, "sm")}
      >
        <Gauge className="size-3.5" aria-hidden /> {pending ? "Starting…" : label}
      </button>
      {state.error && (
        <span className="text-danger text-xs" role="alert">
          {state.error}
        </span>
      )}
    </form>
  );
}

/** Progress of the latest batch, polled from the API while it runs; cancellable. */
export function BatchProgress({ initial }: { initial: BatchView }) {
  const router = useRouter();
  const [batch, setBatch] = useState(initial);
  const [cancelState, cancel, cancelling] = useActionState(
    cancelMatchBatchAction,
    INITIAL_ACTION_STATE,
  );
  const active = ACTIVE.has(batch.status);

  useEffect(() => {
    if (!ACTIVE.has(initial.status)) return;
    let stop = false;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/v1/matching/batches/${initial.id}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const next = ((await res.json()) as { data: BatchView }).data;
        setBatch(next);
        if (!ACTIVE.has(next.status)) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // transient network error: keep polling
      }
    }, 1500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [initial.id, initial.status, router]);

  const processed = batch.done + batch.failed + batch.skipped;
  const counts = (batch.counts ?? {}) as Record<string, number>;
  return (
    <div className="flex flex-col gap-2 px-4 py-3" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-fg">
          {active
            ? batch.cancelRequested
              ? "Cancelling…"
              : batch.status === "QUEUED"
                ? "Queued…"
                : "Calculating matches…"
            : batch.status === "COMPLETED"
              ? "Completed"
              : batch.status === "CANCELLED"
                ? "Cancelled"
                : "Failed"}
        </span>
        <span className="text-fg-muted font-mono">
          {processed}/{batch.total}
        </span>
      </div>
      <ProgressBar
        value={(processed / batch.total) * 100}
        label="Match batch progress"
        tone={
          batch.status === "COMPLETED"
            ? "success"
            : batch.status === "FAILED"
              ? "warning"
              : "accent"
        }
      />
      {Object.keys(counts).length > 0 && (
        <p className="text-fg-muted text-xs">
          {Object.entries(counts)
            .map(([k, v]) => `${OVERALL_LABELS[k] ?? k}: ${v}`)
            .join(" · ")}
        </p>
      )}
      {batch.message && !active && (
        <Alert tone={batch.status === "FAILED" ? "danger" : "info"}>{batch.message}</Alert>
      )}
      {active && !batch.cancelRequested && (
        <form action={cancel}>
          <input type="hidden" name="_id" value={batch.id} />
          <button type="submit" disabled={cancelling} className={buttonClass("ghost", "sm")}>
            <Square className="size-3.5" aria-hidden /> Cancel
          </button>
          {cancelState.error && (
            <span className="text-danger ml-2 text-xs">{cancelState.error}</span>
          )}
        </form>
      )}
    </div>
  );
}
