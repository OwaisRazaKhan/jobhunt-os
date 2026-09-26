"use client";

import { BookmarkPlus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  createSavedSearchAction,
  updateSavedSearchAction,
} from "@/app/(app)/jobs/(browse)/actions";
import {
  searchHref,
  SORT_LABELS,
  SORTS,
  toSearchParams,
  type JobSearchParams,
  type SortKey,
} from "../search/params";

function SaveSearchButton({ qs, disabled }: { qs: string; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [state, action, pending] = useActionState(createSavedSearchAction, INITIAL_ACTION_STATE);
  useEffect(() => {
    const id = state.ok ? (state.data?.id as string | undefined) : undefined;
    if (id) router.replace(`/jobs?${qs}${qs ? "&" : ""}saved=${id}`);
  }, [state, qs, router]);
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={disabled ? "Add a search or filter first" : undefined}
      >
        <BookmarkPlus className="size-3.5" aria-hidden /> Save search
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Save this search"
        description="Stores the current query and filters (not the results). Run it again any time from Saved searches."
      >
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="_qs" value={qs} />
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted text-xs font-medium">Name</span>
            <input
              name="name"
              required
              maxLength={100}
              autoFocus
              placeholder="e.g. India Remote AI"
              aria-invalid={state.fieldErrors?.name ? true : undefined}
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
              {pending ? "Saving…" : "Save search"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function UpdateSavedButton({ id, qs }: { id: string; qs: string }) {
  const [state, action, pending] = useActionState(updateSavedSearchAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="_id" value={id} />
      <input type="hidden" name="_qs" value={qs} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        <RefreshCw className="size-3.5" aria-hidden /> Update with current filters
      </Button>
      {(state.error || (state.ok && state.message)) && (
        <span
          role="status"
          className={cn("text-[11px]", state.error ? "text-danger" : "text-success")}
        >
          {state.error ?? state.message}
        </span>
      )}
    </form>
  );
}

export function ResultsToolbar({
  basePath,
  params,
  savedId,
  canSave,
}: {
  basePath: string;
  params: JobSearchParams;
  savedId: string | null;
  canSave: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const qs = toSearchParams(params, { page: 1 }).toString();
  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="flex items-center gap-2 text-xs">
        <span className="text-fg-muted">Sort</span>
        <select
          value={params.sort}
          disabled={pending}
          onChange={(e) => {
            const href = searchHref(basePath, {
              ...params,
              sort: e.target.value as SortKey,
              page: 1,
            });
            startTransition(() =>
              router.push(
                savedId ? `${href}${href.includes("?") ? "&" : "?"}saved=${savedId}` : href,
              ),
            );
          }}
          className={cn(inputClass, "h-7 w-auto py-0 text-xs")}
        >
          {SORTS.map((s) => (
            <option key={s} value={s}>
              {SORT_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {basePath === "/jobs" && <SaveSearchButton qs={qs} disabled={!canSave} />}
      {basePath === "/jobs" && savedId && <UpdateSavedButton id={savedId} qs={qs} />}
    </div>
  );
}
