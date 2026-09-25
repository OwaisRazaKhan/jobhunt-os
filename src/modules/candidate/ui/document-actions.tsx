"use client";

import { Download, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { deleteDocumentAction, reprocessDocumentAction } from "@/app/(app)/candidate/actions";

export function DocumentActions({
  id,
  fileName,
  afterDelete,
}: {
  id: string;
  fileName: string;
  afterDelete?: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [reprocessState, reprocess, reprocessing] = useActionState(
    async (prev: typeof INITIAL_ACTION_STATE, fd: FormData) => {
      const result = await reprocessDocumentAction(prev, fd);
      setTimeout(() => router.refresh(), 2500);
      return result;
    },
    INITIAL_ACTION_STATE,
  );
  const [deleteState, remove, deleting] = useActionState(
    async (prev: typeof INITIAL_ACTION_STATE, fd: FormData) => {
      const result = await deleteDocumentAction(prev, fd);
      if (result.ok && afterDelete) router.push(afterDelete);
      return result;
    },
    INITIAL_ACTION_STATE,
  );

  return (
    <div className="flex items-center gap-0.5">
      <a
        href={`/api/v1/candidate/documents/${id}/download`}
        className={buttonClass("ghost", "sm")}
        aria-label={`Download ${fileName}`}
      >
        <Download className="size-3.5" aria-hidden />
      </a>
      <form action={reprocess}>
        <input type="hidden" name="_id" value={id} />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={reprocessing}
          aria-label={`Reprocess ${fileName}`}
          title="Extract again (pending facts from this document are replaced)"
        >
          <RefreshCw className={reprocessing ? "size-3.5 animate-spin" : "size-3.5"} aria-hidden />
        </Button>
      </form>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirm(true)}
        aria-label={`Delete ${fileName}`}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
      {(reprocessState.error || deleteState.error) && (
        <span role="alert" className="text-danger text-xs">
          {reprocessState.error ?? deleteState.error}
        </span>
      )}
      {reprocessState.ok && reprocessState.message && (
        <span role="status" className="text-fg-muted text-xs">
          {reprocessState.message}
        </span>
      )}
      <Modal
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Delete ${fileName}?`}
        description="The file is removed from storage. Facts you already approved from it stay in your profile (their source excerpt is kept)."
      >
        <form action={remove} className="flex justify-end gap-2">
          <input type="hidden" name="_id" value={id} />
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete document"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
