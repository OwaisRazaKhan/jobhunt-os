"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import { createManualJob, deleteManualJob, updateManualJob } from "@/modules/jobs/jobs.service";
import { setSourceEnabled, updateSourceConfiguration } from "@/modules/jobs/sources.service";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const idSchema = z.uuid();

export async function saveSourceConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await updateSourceConfiguration(
      actor,
      idSchema.parse(formData.get("_id")),
      formDataToObject(formData),
    );
    revalidatePath("/jobs", "layout");
    return { message: "Source configuration saved." };
  });
}

export async function toggleSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const enabled = formData.get("enabled") === "true";
    await setSourceEnabled(actor, idSchema.parse(formData.get("_id")), enabled);
    revalidatePath("/jobs", "layout");
    return { message: enabled ? "Source enabled." : "Source disabled." };
  });
}

// --- Manual jobs -------------------------------------------------------------

export async function createJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let jobId = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    jobId = (await createManualJob(actor, formDataToObject(formData))).id;
    revalidatePath("/jobs", "layout");
  });
  if (result.ok && jobId) redirect(`/jobs/${jobId}`);
  return result;
}

export async function updateJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let jobId = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    jobId = idSchema.parse(formData.get("_id"));
    await updateManualJob(actor, jobId, formDataToObject(formData));
    revalidatePath("/jobs", "layout");
  });
  if (result.ok && jobId) redirect(`/jobs/${jobId}`);
  return result;
}

export async function deleteJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction(async () => {
    const actor = await requireActor();
    await deleteManualJob(actor, idSchema.parse(formData.get("_id")));
    revalidatePath("/jobs", "layout");
  });
  if (result.ok) redirect("/jobs?deleted=1");
  return result;
}
