"use client";

import { Plus, X } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import { inputClass } from "@/components/forms/field-control";
import { InlineAction } from "@/components/forms/inline-action";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  addCategoryAction,
  addLocationAction,
  addTermAction,
  deleteCategoryAction,
  deleteLocationAction,
  deleteTermAction,
} from "@/app/(app)/jobs/profiles/actions";
import type { FieldDef } from "@/modules/candidate/form-fields";
import { LOCATION_KIND_LABELS, LOCATION_KINDS } from "../types";

const LOCATION_FIELDS: FieldDef[] = [
  { name: "countryCode", label: "Country", type: "country", required: true },
  { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Kochi" },
  {
    name: "kind",
    label: "Kind",
    type: "select",
    options: LOCATION_KINDS.map((k) => ({ value: k, label: LOCATION_KIND_LABELS[k] })),
    help: "“Remote in country” matches remote jobs in that country.",
  },
  {
    name: "aliases",
    label: "Other spellings",
    type: "list",
    help: "One per line, e.g. cochin. Used when matching job locations.",
  },
];

const CATEGORY_FIELDS: FieldDef[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "e.g. Growth" },
  { name: "description", label: "Description", type: "text" },
];

export function AddLocationButton({
  countries,
}: {
  countries: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> Add location
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a location"
        description="Your own locations are visible only to you and can be used in any of your search profiles."
      >
        <ActionForm
          action={addLocationAction}
          fields={LOCATION_FIELDS}
          values={{ kind: "CITY" }}
          context={{ countries }}
          submitLabel="Add location"
          onCancel={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function AddCategoryButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" aria-hidden /> Add category
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add a custom category"
        description="A category is a named group of search terms. Add terms after creating it."
      >
        <ActionForm
          action={addCategoryAction}
          fields={CATEGORY_FIELDS}
          submitLabel="Add category"
          onCancel={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function RemoveLocationButton({ id, name }: { id: string; name: string }) {
  return (
    <InlineAction
      action={deleteLocationAction}
      hidden={{ _id: id }}
      label={`Remove ${name}`}
      confirm={`Remove ${name}? Profiles that use it stop filtering by it.`}
    >
      <X className="size-3.5" aria-hidden />
    </InlineAction>
  );
}

export function RemoveCategoryButton({ id, name }: { id: string; name: string }) {
  return (
    <InlineAction
      action={deleteCategoryAction}
      hidden={{ _id: id }}
      label={`Remove category ${name}`}
      confirm={`Remove the category ${name} and its terms?`}
    >
      <X className="size-3.5" aria-hidden /> Remove
    </InlineAction>
  );
}

export function TermChip({ id, term, own }: { id: string; term: string; own: boolean }) {
  const [state, action, pending] = useActionState(deleteTermAction, INITIAL_ACTION_STATE);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 font-mono text-[11px]",
        own ? "border-accent/40 bg-accent/10 text-fg" : "border-border-strong text-fg-muted",
      )}
      title={own ? "Your term" : "System default"}
    >
      {term}
      {own && (
        <form action={action} className="inline-flex">
          <input type="hidden" name="_id" value={id} />
          <button
            type="submit"
            disabled={pending}
            aria-label={`Remove term ${term}`}
            className="text-fg-muted hover:text-danger"
          >
            <X className="size-3" aria-hidden />
          </button>
        </form>
      )}
      {state.error && (
        <span role="alert" className="text-danger">
          !
        </span>
      )}
    </span>
  );
}

export function AddTermForm({
  categoryId,
  categoryName,
}: {
  categoryId: string;
  categoryName: string;
}) {
  const [state, action, pending] = useActionState(addTermAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="categoryId" value={categoryId} />
      <div className="flex gap-1.5">
        <input
          key={state.ok ? state.at : "draft"}
          name="term"
          placeholder="Add a search term"
          aria-label={`New search term for ${categoryName}`}
          maxLength={80}
          className={cn(inputClass, "h-7 max-w-56 text-xs")}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          <Plus className="size-3.5" aria-hidden /> Add
        </Button>
      </div>
      {state.error && (
        <span role="alert" className="text-danger text-[11px]">
          {state.fieldErrors?.term ?? state.error}
        </span>
      )}
    </form>
  );
}
