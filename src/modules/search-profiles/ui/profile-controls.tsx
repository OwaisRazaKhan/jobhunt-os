"use client";

import { Copy, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { InlineAction } from "@/components/forms/inline-action";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  deleteSearchProfileAction,
  duplicateSearchProfileAction,
  toggleSearchProfileAction,
} from "@/app/(app)/jobs/profiles/actions";

export function ProfileEnabledToggle({
  id,
  name,
  enabled,
}: {
  id: string;
  name: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(toggleSearchProfileAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="_id" value={id} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
        disabled={pending}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-50",
          enabled ? "border-accent bg-accent/30" : "border-border-strong bg-surface-3",
        )}
      >
        <span
          className={cn(
            "size-3.5 rounded-full transition-transform",
            enabled ? "bg-accent translate-x-4.5" : "bg-fg-subtle translate-x-0.5",
          )}
        />
      </button>
      <span className="text-fg-muted text-[11px]">{enabled ? "Enabled" : "Disabled"}</span>
      {state.error && (
        <span role="alert" className="text-danger text-[11px]">
          {state.error}
        </span>
      )}
    </form>
  );
}

export function DuplicateProfileButton({ id, name }: { id: string; name: string }) {
  return (
    <InlineAction
      action={duplicateSearchProfileAction}
      hidden={{ _id: id }}
      label={`Duplicate ${name}`}
    >
      <Copy className="size-3.5" aria-hidden /> Duplicate
    </InlineAction>
  );
}

export function DeleteProfileButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteSearchProfileAction, INITIAL_ACTION_STATE);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Delete ${name}`}>
        <Trash2 className="size-3.5" aria-hidden /> Delete
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this search profile?"
        description={`“${name}” and its links to discovered jobs are removed. The jobs themselves stay in the catalog, and run history is kept.`}
      >
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="_id" value={id} />
          {state.error && (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Deleting…" : "Delete profile"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
