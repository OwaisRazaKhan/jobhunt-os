"use client";

import { Gauge, RefreshCw } from "lucide-react";
import { useActionState } from "react";
import { runMatchAction } from "@/app/(app)/matches/actions";
import { buttonClass } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

/** Run / recalculate one job's match. Disabled while pending, so a double click cannot fire twice. */
export function RunMatchButton({
  jobId,
  label = "Run match",
  recalculate = false,
  variant = "primary",
}: {
  jobId: string;
  label?: string;
  recalculate?: boolean;
  variant?: "primary" | "secondary";
}) {
  const [state, action, pending] = useActionState(runMatchAction, INITIAL_ACTION_STATE);
  const Icon = recalculate ? RefreshCw : Gauge;
  return (
    <form action={action} className="flex flex-col gap-1.5">
      <input type="hidden" name="_id" value={jobId} />
      <button
        type="submit"
        disabled={pending}
        className={buttonClass(variant, "sm", "self-start")}
        aria-busy={pending}
      >
        <Icon className={pending ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
        {pending ? "Calculating…" : label}
      </button>
      <p className="text-xs" role="status" aria-live="polite">
        {state.error ? (
          <span className="text-danger">{state.error}</span>
        ) : state.message ? (
          <span className="text-fg-muted">{state.message}</span>
        ) : null}
      </p>
    </form>
  );
}
