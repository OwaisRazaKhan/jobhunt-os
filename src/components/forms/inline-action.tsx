"use client";

import { useActionState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import type { FormAction } from "./action-form";

/**
 * A single-button form bound to a Server Action (toggle, duplicate, remove…).
 * Shows the action's error inline; never throws to the client.
 */
export function InlineAction({
  action,
  hidden,
  children,
  label,
  variant = "ghost",
  confirm,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  children: ReactNode;
  /** Accessible name when the button only shows an icon */
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  /** Ask the browser to confirm first (for small, reversible-by-re-adding removals) */
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-0.5"
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" size="sm" variant={variant} disabled={pending} aria-label={label}>
        {children}
      </Button>
      {state.error && (
        <span role="alert" className="text-danger max-w-56 text-[11px]">
          {state.error}
        </span>
      )}
      {state.ok && state.message && (
        <span role="status" className="text-success max-w-56 text-[11px]">
          {state.message}
        </span>
      )}
    </form>
  );
}
