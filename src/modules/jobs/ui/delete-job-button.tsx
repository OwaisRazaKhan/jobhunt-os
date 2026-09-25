"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { deleteJobAction } from "@/app/(app)/jobs/actions";

export function DeleteJobButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(deleteJobAction, INITIAL_ACTION_STATE);
  return (
    <>
      <Button size="sm" variant="danger" onClick={() => setOpen(true)}>
        <Trash2 className="size-3.5" aria-hidden /> Delete
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this job?"
        description={`“${title}” is removed from your jobs now and permanently purged after 30 days.`}
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
              {pending ? "Deleting…" : "Delete job"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
