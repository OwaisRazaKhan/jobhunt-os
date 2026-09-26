"use client";

import { useActionState } from "react";
import { saveMatchingPreferencesAction } from "@/app/(app)/matches/actions";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import type { MatchingPreferencesInput } from "../types";

const HARD: { key: keyof MatchingPreferencesInput; label: string; help: string }[] = [
  {
    key: "workModeHard",
    label: "Work mode is mandatory",
    help: "e.g. remote-only: a job with a different work mode becomes a hard block instead of a preference conflict.",
  },
  {
    key: "employmentTypeHard",
    label: "Employment type is mandatory",
    help: "A job with an employment type you did not select becomes a hard block.",
  },
  {
    key: "locationHard",
    label: "Location is mandatory",
    help: "A job outside your current / target locations (and you do not relocate) becomes a hard block.",
  },
  {
    key: "salaryMinHard",
    label: "Minimum salary is mandatory",
    help: "Only when the job states a maximum below your minimum in the same currency and period.",
  },
];

/** Matching settings — separate from your candidate profile and your search profiles. */
export function MatchingSettingsForm({
  initial,
  aiAvailable,
}: {
  initial: MatchingPreferencesInput;
  aiAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveMatchingPreferencesAction,
    INITIAL_ACTION_STATE,
  );
  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-3">
      <fieldset className="flex flex-col gap-2">
        <legend className="text-fg-muted mb-1 text-xs font-medium">
          Hard requirements (off = mismatches are shown as preference conflicts)
        </legend>
        {HARD.map((h) => (
          <label key={h.key} className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              name={h.key}
              defaultChecked={initial[h.key]}
              className="mt-0.5"
            />
            <span>
              <span className="text-fg">{h.label}</span>
              <span className="text-fg-subtle block">{h.help}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          name="semanticAssist"
          defaultChecked={initial.semanticAssist}
          className="mt-0.5"
        />
        <span>
          <span className="text-fg">Local AI skill assistance (optional)</span>
          <span className="text-fg-subtle block">
            Uses your local Ollama model to suggest RELATED skills for skill gaps. Suggestions are
            validated and labelled; AI never marks a requirement as matched and never creates or
            removes hard blocks.
            {!aiAvailable && " Ollama is not configured, so this currently has no effect."}
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        <span className="text-xs" role="status" aria-live="polite">
          {state.error ? (
            <span className="text-danger">{state.error}</span>
          ) : (
            <span className="text-fg-muted">{state.message}</span>
          )}
        </span>
      </div>
    </form>
  );
}
