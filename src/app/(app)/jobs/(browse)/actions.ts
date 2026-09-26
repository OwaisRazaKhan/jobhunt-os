"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { setJobState } from "@/modules/jobs/search/job-state.service";
import {
  createSavedSearch,
  deleteSavedSearch,
  duplicateSavedSearch,
  updateSavedSearch,
} from "@/modules/jobs/search/saved-searches.service";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const idSchema = z.uuid();
const changeSchema = z.enum(["bookmark", "unbookmark", "hide", "restore"]);
/** The current /jobs query string, re-validated by the service before it is stored. */
const queryString = z.string().max(4000);

function paramsFrom(qs: string) {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of new URLSearchParams(qs)) {
    const prev = out[k];
    out[k] = prev === undefined ? v : Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}

const MESSAGES = {
  bookmark: "Bookmarked.",
  unbookmark: "Bookmark removed.",
  hide: "Hidden. Find it under Hidden jobs.",
  restore: "Restored to your job list.",
} as const;

export async function jobStateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const change = changeSchema.parse(formData.get("change"));
    await setJobState(actor, idSchema.parse(formData.get("_id")), change);
    revalidatePath("/jobs", "layout");
    return { message: MESSAGES[change] };
  });
}

export async function createSavedSearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const saved = await createSavedSearch(actor, {
      name: formData.get("name"),
      params: paramsFrom(queryString.parse(formData.get("_qs") ?? "")),
    });
    revalidatePath("/jobs", "layout");
    return { message: `Saved “${saved.name}”.`, data: { id: saved.id } };
  });
}

export async function updateSavedSearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const name = formData.get("name");
    const qs = formData.get("_qs");
    await updateSavedSearch(actor, idSchema.parse(formData.get("_id")), {
      ...(name !== null ? { name } : {}),
      ...(qs !== null ? { params: paramsFrom(queryString.parse(qs)) } : {}),
    });
    revalidatePath("/jobs", "layout");
    return { message: qs !== null ? "Saved search updated with the current filters." : "Renamed." };
  });
}

export async function duplicateSavedSearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const copy = await duplicateSavedSearch(actor, idSchema.parse(formData.get("_id")));
    revalidatePath("/jobs", "layout");
    return { message: `Created “${copy.name}”.` };
  });
}

export async function deleteSavedSearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteSavedSearch(actor, idSchema.parse(formData.get("_id")));
    revalidatePath("/jobs", "layout");
    return { message: "Saved search deleted." };
  });
}
