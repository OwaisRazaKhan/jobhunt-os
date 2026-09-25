"use client";

import { BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import type { FieldContext } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { deleteFactAction, saveFactAction, verifyFactAction } from "@/app/(app)/candidate/actions";
import { SECTION_FIELDS, SECTION_META } from "../form-fields";
import type { SectionKind } from "../schemas";

export function AddFactButton({
  kind,
  context,
  defaults,
  label,
  variant = "ghost",
}: {
  kind: SectionKind;
  context: FieldContext;
  defaults?: Record<string, unknown>;
  label?: string;
  variant?: "ghost" | "secondary" | "primary";
}) {
  const [open, setOpen] = useState(false);
  const meta = SECTION_META[kind];
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden />
        {label ?? `Add ${meta.singular}`}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Add ${meta.singular}`}
        description="Saved as “User provided”. You can verify it afterwards."
        wide
      >
        <ActionForm
          action={saveFactAction}
          fields={SECTION_FIELDS[kind]}
          values={defaults}
          hidden={{ _kind: kind }}
          context={context}
          submitLabel="Add"
          onCancel={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function FactItemActions({
  kind,
  record,
  context,
  verified,
  compact,
}: {
  kind: SectionKind;
  record: Record<string, unknown> & { id: string };
  context: FieldContext;
  verified: boolean;
  compact?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [verifyState, verifyAction, verifying] = useActionState(
    verifyFactAction,
    INITIAL_ACTION_STATE,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteFactAction,
    INITIAL_ACTION_STATE,
  );
  const meta = SECTION_META[kind];
  const values =
    kind === "authorization" && record.validUntil instanceof Date
      ? { ...record, validUntil: record.validUntil.toISOString().slice(0, 10) }
      : record;

  return (
    <div className="flex items-center gap-0.5">
      {!verified && (
        <form action={verifyAction}>
          <input type="hidden" name="_kind" value={kind} />
          <input type="hidden" name="_id" value={record.id} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            disabled={verifying}
            title="I confirm this is accurate"
            aria-label={`Verify this ${meta.singular}`}
          >
            <BadgeCheck className="size-3.5" aria-hidden />
            {!compact && <span className="hidden sm:inline">Verify</span>}
          </Button>
        </form>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setEditing(true)}
        aria-label={`Edit this ${meta.singular}`}
      >
        <Pencil className="size-3.5" aria-hidden />
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setConfirmDelete(true)}
        aria-label={`Delete this ${meta.singular}`}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </Button>
      {(verifyState.error || deleteState.error) && (
        <span role="alert" className="text-danger text-xs">
          {verifyState.error ?? deleteState.error}
        </span>
      )}

      <Modal
        open={editing}
        onClose={() => setEditing(false)}
        title={`Edit ${meta.singular}`}
        description="Changing the content resets verification to “User provided”."
        wide
      >
        <ActionForm
          action={saveFactAction}
          fields={SECTION_FIELDS[kind]}
          values={values}
          hidden={{ _kind: kind, _id: record.id }}
          context={context}
          onCancel={() => setEditing(false)}
          onSuccess={() => setEditing(false)}
        />
      </Modal>

      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete this ${meta.singular}?`}
        description="It is removed from your profile and permanently purged after 30 days."
      >
        <form action={deleteAction} className="flex justify-end gap-2">
          <input type="hidden" name="_kind" value={kind} />
          <input type="hidden" name="_id" value={record.id} />
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </form>
      </Modal>
    </div>
  );
}
