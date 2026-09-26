"use client";

import { Copy, Pencil, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { InlineAction } from "@/components/forms/inline-action";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import {
  deleteSavedSearchAction,
  duplicateSavedSearchAction,
  updateSavedSearchAction,
} from "@/app/(app)/jobs/(browse)/actions";

export function RenameSavedSearchButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const result = await updateSavedSearchAction(prev, formData);
    if (result.ok) setOpen(false);
    return result;
  }, INITIAL_ACTION_STATE);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Rename ${name}`}>
        <Pencil className="size-3.5" aria-hidden /> Rename
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Rename saved search">
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="_id" value={id} />
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted text-xs font-medium">Name</span>
            <input
              name="name"
              defaultValue={name}
              required
              maxLength={100}
              className={inputClass}
            />
          </label>
          {(state.fieldErrors?.name || state.error) && (
            <p role="alert" className="text-danger text-xs">
              {state.fieldErrors?.name ?? state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Rename"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DuplicateSavedSearchButton({ id, name }: { id: string; name: string }) {
  return (
    <InlineAction
      action={duplicateSavedSearchAction}
      hidden={{ _id: id }}
      label={`Duplicate ${name}`}
    >
      <Copy className="size-3.5" aria-hidden /> Duplicate
    </InlineAction>
  );
}

export function DeleteSavedSearchButton({ id, name }: { id: string; name: string }) {
  return (
    <InlineAction
      action={deleteSavedSearchAction}
      hidden={{ _id: id }}
      label={`Delete ${name}`}
      confirm={`Delete the saved search “${name}”? Jobs are not affected.`}
    >
      <Trash2 className="size-3.5" aria-hidden /> Delete
    </InlineAction>
  );
}
