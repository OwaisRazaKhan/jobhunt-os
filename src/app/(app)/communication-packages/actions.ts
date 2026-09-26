"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import {
  archivePackage,
  createPackage,
  duplicatePackage,
  markPackageReady,
  recheckPackage,
  updatePackage,
} from "@/modules/communications/package.service";
import {
  applyRecipientToCommunication,
  deleteRecipientContext,
  saveCommunicationPreferences,
  saveRecipientContext,
} from "@/modules/communications/recipient.service";
import {
  saveSignaturePreset,
  listSignaturePresets,
} from "@/modules/communications/communication.service";
import { runAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership in the service + RLS). No submission. */

const id = z.uuid();

function revalidate(packageId?: string) {
  revalidatePath("/communication-packages");
  if (packageId) revalidatePath(`/communication-packages/${packageId}`);
}

export async function createPackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const r = await createPackage(actor, formDataToObject(formData) as never);
    target = r.package.id;
    revalidate(target);
  });
  if (result.ok && target) redirect(`/communication-packages/${target}`);
  return result;
}

export async function updatePackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    delete raw.packageId;
    const r = await updatePackage(actor, packageId, raw as never);
    revalidate(packageId);
    return {
      message: r.evaluation.ready
        ? "Saved — every check passes. Review it and mark it ready."
        : "Saved. Some checks still fail (see the readiness check).",
    };
  });
}

export async function recheckPackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  return runAction(async () => {
    const actor = await requireActor();
    const r = await recheckPackage(actor, packageId);
    revalidate(packageId);
    return { message: `Checked: ${r.status.toLowerCase().replace(/_/g, " ")}.` };
  });
}

export async function markReadyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  return runAction(async () => {
    if (formData.get("confirm") !== "on")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Tick the box to confirm you reviewed every asset in this package.",
      });
    const actor = await requireActor();
    const r = await markPackageReady(actor, packageId);
    revalidate(packageId);
    return {
      message: r.created
        ? "Ready for application — the package is locked. Nothing has been submitted."
        : "Already ready for application.",
    };
  });
}

export async function duplicatePackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  const refresh = formData.get("refresh") === "1";
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    target = (await duplicatePackage(actor, packageId, { refresh })).package.id;
    revalidate(target);
  });
  if (result.ok && target) redirect(`/communication-packages/${target}`);
  return result;
}

export async function archivePackageAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  return runAction(async () => {
    const actor = await requireActor();
    await archivePackage(actor, packageId);
    revalidate(packageId);
  });
}

// --- Recipients & preferences -----------------------------------------------------------------

export async function saveRecipientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    const recipientId =
      typeof raw.recipientId === "string" && raw.recipientId ? id.parse(raw.recipientId) : null;
    delete raw.recipientId;
    await saveRecipientContext(actor, raw, recipientId);
    revalidatePath("/communications/recipients");
    return { message: "Recipient saved." };
  });
}

export async function deleteRecipientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteRecipientContext(actor, id.parse(formData.get("recipientId")));
    revalidatePath("/communications/recipients");
  });
}

export async function applyRecipientAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const communicationId = id.parse(formData.get("communicationId"));
  const raw = formData.get("recipientContextId");
  return runAction(async () => {
    const actor = await requireActor();
    await applyRecipientToCommunication(actor, communicationId, raw ? id.parse(raw) : null);
    revalidatePath(`/communications/${communicationId}`);
    return {
      message: raw
        ? "Recipient applied. Regenerate or edit the greeting if needed."
        : "Recipient unlinked.",
    };
  });
}

export async function savePreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    await saveCommunicationPreferences(actor, raw);
    // The default signature profile lives on the signature presets (single source of truth).
    const defaultSignatureId =
      typeof raw.defaultSignatureId === "string" ? raw.defaultSignatureId : "";
    if (defaultSignatureId) {
      const preset = (await listSignaturePresets(actor)).find((p) => p.id === defaultSignatureId);
      if (!preset) throw new AppError("NOT_FOUND");
      if (!preset.isDefault)
        await saveSignaturePreset(
          actor,
          {
            name: preset.name,
            isDefault: true,
            fields: preset.fields as Record<string, string | null>,
          },
          preset.id,
        );
    }
    revalidatePath("/communications/preferences");
    return { message: "Preferences saved. They apply to new drafts and AI generations." };
  });
}
