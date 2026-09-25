"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import type { FieldDef } from "@/modules/candidate/form-fields";
import { FieldControl, type FieldContext } from "./field-control";

export type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

type SubmittedState = ActionState & { submitted?: Record<string, unknown> };

/**
 * Generic form bound to a Server Action. Renders declarative fields, shows
 * per-field and form errors, and reports success to the caller.
 */
export function ActionForm({
  action,
  fields,
  values = {},
  hidden = {},
  context = {},
  submitLabel = "Save",
  onSuccess,
  onCancel,
  children,
  footer,
}: {
  action: FormAction;
  fields: FieldDef[];
  values?: Record<string, unknown>;
  hidden?: Record<string, string>;
  context?: FieldContext;
  submitLabel?: string;
  onSuccess?: (state: ActionState) => void;
  onCancel?: () => void;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  // React resets uncontrolled fields after an action; keep what the user submitted so
  // nothing typed is lost when validation fails.
  const [state, formAction, pending] = useActionState(
    async (prev: SubmittedState, formData: FormData): Promise<SubmittedState> => ({
      ...(await action(prev, formData)),
      submitted: formDataToObject(formData),
    }),
    INITIAL_ACTION_STATE as SubmittedState,
  );
  const shown = state.submitted ?? values;
  const handled = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (state.ok && state.at && handled.current !== state.at) {
      handled.current = state.at;
      onSuccess?.(state);
    }
  }, [state, onSuccess]);

  const arrays = fields.filter((f) => f.type === "multiselect").map((f) => f.name);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {arrays.length > 0 && <input type="hidden" name="__arrays" value={arrays.join(",")} />}
      {children}
      <div key={state.at ?? 0} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <FieldControl
            key={field.name}
            field={field}
            value={shown[field.name]}
            error={state.fieldErrors?.[field.name]}
            context={context}
          />
        ))}
      </div>
      {state.error && (
        <p
          role="alert"
          className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      )}
      {state.ok && state.message && !onSuccess && (
        <p role="status" className="text-success text-sm">
          {state.message}
        </p>
      )}
      <div className="border-border flex flex-wrap items-center justify-end gap-2 border-t pt-3">
        {footer}
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
