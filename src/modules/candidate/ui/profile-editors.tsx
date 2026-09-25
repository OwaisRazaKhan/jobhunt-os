"use client";

import { BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import { inputClass, type FieldContext } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import {
  savePreferencesAction,
  saveProfileAction,
  saveTargetLocationsAction,
  verifyProfileAction,
} from "@/app/(app)/candidate/actions";
import type { FieldDef } from "../form-fields";

export function EditDialogButton({
  title,
  description,
  fields,
  values,
  context,
  target,
  label = "Edit",
  variant = "ghost",
}: {
  title: string;
  description?: string;
  fields: FieldDef[];
  values: Record<string, unknown>;
  context?: FieldContext;
  target: "profile" | "preferences";
  label?: string;
  variant?: "ghost" | "secondary" | "primary";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden />
        {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        wide
      >
        <ActionForm
          action={target === "profile" ? saveProfileAction : savePreferencesAction}
          fields={fields}
          values={values}
          context={context}
          onCancel={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

/** Inline (non-dialog) form, used by onboarding steps. */
export function InlineProfileForm({
  fields,
  values,
  context,
  target,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  context?: FieldContext;
  target: "profile" | "preferences";
}) {
  return (
    <ActionForm
      action={target === "profile" ? saveProfileAction : savePreferencesAction}
      fields={fields}
      values={values}
      context={context}
      submitLabel="Save"
    />
  );
}

export function VerifyProfileButton() {
  const [state, action, pending] = useActionState(verifyProfileAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex items-center gap-2">
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={pending}
        title="I confirm my basic information is accurate"
      >
        <BadgeCheck className="size-3.5" aria-hidden /> Verify basics
      </Button>
      {state.error && <span className="text-danger text-xs">{state.error}</span>}
    </form>
  );
}

interface Location {
  countryCode: string;
  city: string | null;
}

export function TargetLocationsEditor({
  initial,
  countries,
  onSaved,
}: {
  initial: Location[];
  countries: { value: string; label: string }[];
  onSaved?: () => void;
}) {
  const [rows, setRows] = useState<Location[]>(
    initial.length ? initial : [{ countryCode: "", city: "" }],
  );
  const [state, action, pending] = useActionState(
    async (prev: typeof INITIAL_ACTION_STATE, fd: FormData) => {
      const result = await saveTargetLocationsAction(prev, fd);
      if (result.ok) onSaved?.();
      return result;
    },
    INITIAL_ACTION_STATE,
  );

  return (
    <form action={action} className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => (
          <li key={i} className="flex gap-2">
            <select
              name="countryCode"
              aria-label={`Target country ${i + 1}`}
              value={row.countryCode}
              onChange={(e) =>
                setRows(rows.map((r, j) => (j === i ? { ...r, countryCode: e.target.value } : r)))
              }
              className={inputClass}
            >
              <option value="">Select a country</option>
              {countries.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <input
              name="city"
              aria-label={`City (optional) ${i + 1}`}
              placeholder="City (optional)"
              value={row.city ?? ""}
              onChange={(e) =>
                setRows(rows.map((r, j) => (j === i ? { ...r, city: e.target.value } : r)))
              }
              className={inputClass}
            />
            <Button
              variant="ghost"
              aria-label="Remove location"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setRows([...rows, { countryCode: "", city: "" }])}
        >
          <Plus className="size-3.5" aria-hidden /> Add location
        </Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : "Save locations"}
        </Button>
      </div>
      {state.error && (
        <p role="alert" className="text-danger text-sm">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-success text-sm">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function TargetLocationsButton({
  initial,
  countries,
}: {
  initial: Location[];
  countries: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" aria-hidden /> Edit
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Target countries & cities"
        description="Where you want to work. Order sets priority."
      >
        <TargetLocationsEditor
          initial={initial}
          countries={countries}
          onSaved={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
