"use client";

import { Bookmark, BookmarkCheck, EyeOff, RotateCcw } from "lucide-react";
import { useActionState } from "react";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { jobStateAction } from "@/app/(app)/jobs/(browse)/actions";

const CONFIG = {
  bookmark: { icon: Bookmark, label: "Bookmark" },
  unbookmark: { icon: BookmarkCheck, label: "Remove bookmark" },
  hide: { icon: EyeOff, label: "Hide" },
  restore: { icon: RotateCcw, label: "Restore" },
} as const;

/** One bookmark / hide / restore toggle for a job (per-user; never changes the job). */
export function JobStateButton({
  jobId,
  title,
  change,
  showLabel = false,
}: {
  jobId: string;
  title: string;
  change: keyof typeof CONFIG;
  showLabel?: boolean;
}) {
  const [state, action, pending] = useActionState(jobStateAction, INITIAL_ACTION_STATE);
  const { icon: Icon, label } = CONFIG[change];
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="_id" value={jobId} />
      <input type="hidden" name="change" value={change} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`${label}: ${title}`}
        aria-pressed={change === "unbookmark" ? true : change === "bookmark" ? false : undefined}
        title={state.error ?? label}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors disabled:opacity-50",
          change === "unbookmark"
            ? "text-accent hover:bg-surface-2"
            : "text-fg-muted hover:bg-surface-2 hover:text-fg",
          state.error && "text-danger",
        )}
      >
        <Icon className="size-3.5" aria-hidden />
        {showLabel && label}
      </button>
    </form>
  );
}
