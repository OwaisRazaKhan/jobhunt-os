"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  activateWorkflow,
  archiveWorkflow,
  createWorkflow,
  deactivateWorkflow,
  duplicateWorkflow,
  importWorkflow,
  saveVersion,
  updateWorkflowMeta,
} from "@/modules/workflows/workflow.service";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership in the service + RLS). */

const id = z.uuid();
const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function revalidate(workflowId?: string) {
  revalidatePath("/workflows");
  if (workflowId) revalidatePath(`/workflows/${workflowId}`);
}

export async function createWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const w = await createWorkflow(actor, {
      name: text(formData, "name"),
      description: text(formData, "description") || null,
      tags: text(formData, "tags"),
    });
    target = w.id;
    revalidate();
  });
  if (result.ok && target) redirect(`/workflows/${target}`);
  return result;
}

export async function importWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  let removed: string[] = [];
  const result = await runAction(async () => {
    const actor = await requireActor();
    const file = formData.get("file");
    const json = file instanceof File && file.size ? await file.text() : text(formData, "json");
    const r = await importWorkflow(actor, json);
    target = r.workflow.id;
    removed = r.removed;
    revalidate();
  });
  if (result.ok && target)
    redirect(
      `/workflows/${target}${removed.length ? `?removed=${encodeURIComponent(removed.join(", "))}` : ""}`,
    );
  return result;
}

export async function updateWorkflowMetaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  return runAction(async () => {
    const actor = await requireActor();
    await updateWorkflowMeta(actor, workflowId, {
      name: text(formData, "name"),
      description: text(formData, "description") || null,
      tags: text(formData, "tags"),
    });
    revalidate(workflowId);
    return { message: "Saved." };
  });
}

export async function saveVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  return runAction(async () => {
    const actor = await requireActor();
    const r = await saveVersion(actor, workflowId, { note: text(formData, "note") || null });
    revalidate(workflowId);
    return {
      message: !r.created
        ? `No changes since version ${r.version.versionNumber}.`
        : `Saved version ${r.version.versionNumber}${r.report.valid ? " (valid)." : " — it has validation errors, so it can't be activated or run yet."}`,
    };
  });
}

export async function activateWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  const versionId = formData.get("versionId");
  return runAction(async () => {
    const actor = await requireActor();
    const r = await activateWorkflow(
      actor,
      workflowId,
      typeof versionId === "string" && versionId ? id.parse(versionId) : null,
    );
    revalidate(workflowId);
    return { message: `Version ${r.version.versionNumber} is active.` };
  });
}

export async function deactivateWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  return runAction(async () => {
    const actor = await requireActor();
    await deactivateWorkflow(actor, workflowId);
    revalidate(workflowId);
    return { message: "Deactivated (back to draft)." };
  });
}

export async function archiveWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  const archived = formData.get("archived") === "1";
  return runAction(async () => {
    const actor = await requireActor();
    await archiveWorkflow(actor, workflowId, archived);
    revalidate(workflowId);
    return { message: archived ? "Archived — history is kept." : "Restored." };
  });
}

export async function duplicateWorkflowAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const workflowId = id.parse(formData.get("workflowId"));
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    target = (await duplicateWorkflow(actor, workflowId)).id;
    revalidate();
  });
  if (result.ok && target) redirect(`/workflows/${target}`);
  return result;
}
