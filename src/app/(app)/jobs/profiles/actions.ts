"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import {
  addCategory,
  addLocation,
  addTerm,
  deleteCategory,
  deleteLocation,
  deleteTerm,
} from "@/modules/search-profiles/config.service";
import {
  createSearchProfile,
  deleteSearchProfile,
  duplicateSearchProfile,
  setSearchProfileEnabled,
  updateSearchProfile,
} from "@/modules/search-profiles/profiles.service";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const idSchema = z.uuid();
const revalidate = () => revalidatePath("/jobs", "layout");

export async function saveSearchProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    const id = formData.get("_id");
    const input = formDataToObject(formData);
    if (id) await updateSearchProfile(actor, idSchema.parse(id), input);
    else await createSearchProfile(actor, input);
    revalidate();
  });
  if (result.ok) redirect("/jobs/profiles?saved=1");
  return result;
}

export async function duplicateSearchProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const copy = await duplicateSearchProfile(actor, idSchema.parse(formData.get("_id")));
    revalidate();
    return { message: `Created “${copy.name}” (disabled until you enable it).` };
  });
}

export async function toggleSearchProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const enabled = formData.get("enabled") === "true";
    await setSearchProfileEnabled(actor, idSchema.parse(formData.get("_id")), enabled);
    revalidate();
    return { message: enabled ? "Profile enabled." : "Profile disabled." };
  });
}

export async function deleteSearchProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    await deleteSearchProfile(actor, idSchema.parse(formData.get("_id")));
    revalidate();
  });
  if (result.ok) redirect("/jobs/profiles?deleted=1");
  return result;
}

// --- Search configuration: locations, categories, terms ------------------------

export async function addLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const location = await addLocation(actor, formDataToObject(formData));
    revalidate();
    return { message: `Added ${location.name}.` };
  });
}

export async function deleteLocationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteLocation(actor, idSchema.parse(formData.get("_id")));
    revalidate();
  });
}

export async function addCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const category = await addCategory(actor, formDataToObject(formData));
    revalidate();
    return { message: `Added ${category.name}. Add search terms to it below.` };
  });
}

export async function deleteCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteCategory(actor, idSchema.parse(formData.get("_id")));
    revalidate();
  });
}

export async function addTermAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await addTerm(actor, formDataToObject(formData));
    revalidate();
    return { message: "Term added." };
  });
}

export async function deleteTermAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteTerm(actor, idSchema.parse(formData.get("_id")));
    revalidate();
  });
}
