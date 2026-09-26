"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import {
  addClaimAsCandidateFact,
  approveCommunicationVersion,
  archiveCommunication,
  createCommunication,
  deleteSignaturePreset,
  duplicateCommunication,
  restoreCommunicationVersion,
  revokeCommunicationApproval,
  runCommunicationCheck,
  saveCommunicationContent,
  saveSignaturePreset,
  setCommunicationVersionStatus,
  updateCommunicationSettings,
} from "@/modules/communications/communication.service";
import {
  COMMUNICATION_EXPORT_FORMATS,
  exportCommunicationVersion,
} from "@/modules/communications/export.service";
import { generateCommunicationDraft } from "@/modules/communications/generation.service";
import { runAction } from "@/server/action";
import { AppError, toAppError } from "@/server/errors";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). No sending. */

const id = z.uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/);

function revalidate(communicationId?: string) {
  revalidatePath("/communications");
  if (communicationId) revalidatePath(`/communications/${communicationId}`);
}

const str = (formData: FormData, key: string) => {
  const v = formData.get(key);
  return typeof v === "string" ? v : undefined;
};

export async function createCommunicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const generate = str(formData, "generate") === "1";
  const importedText = str(formData, "importedText")?.trim();
  const result = await runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    const created = await createCommunication(
      actor,
      {
        communicationType: raw.communicationType as never,
        jobId: (raw.jobId as string) || null,
        resumeVersionId: (raw.resumeVersionId as string) || null,
        title: (raw.title as string) || undefined,
        recipientType: (raw.recipientType as never) || undefined,
        recipientName: raw.recipientName as string,
        recipientTitle: raw.recipientTitle as string,
        recipientCompany: raw.recipientCompany as string,
        recipientEmail: raw.recipientEmail as string,
        recipientSource: raw.recipientSource as string,
        tone: (raw.tone as never) || undefined,
        length: (raw.length as never) || undefined,
        template: (raw.template as string) || undefined,
        pageFormat: (raw.pageFormat as never) || undefined,
        userContext: raw.userContext as string,
        signaturePresetId: (raw.signaturePresetId as string) || null,
      },
      importedText ? { importedText } : undefined,
    );
    target = created.id;
    revalidate(created.id);
  });
  if (!result.ok || !target) return result;
  if (generate && !importedText) {
    // The communication exists (manual path always works); generation errors are shown on its page.
    let error: string | null = null;
    try {
      const actor = await requireActor();
      await generateCommunicationDraft(actor, target);
    } catch (e) {
      error = toAppError(e).publicMessage;
    }
    revalidate(target);
    redirect(
      `/communications/${target}${error ? `?genError=${encodeURIComponent(error.slice(0, 300))}` : "?generated=1"}`,
    );
  }
  redirect(`/communications/${target}`);
}

export async function generateDraftAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const communicationId = id.parse(formData.get("communicationId"));
  let versionId = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const r = await generateCommunicationDraft(actor, communicationId);
    versionId = r.communicationVersionId;
    revalidate(communicationId);
    return {
      message: r.reused
        ? "Nothing changed since the last draft — showing the existing generated version."
        : `Draft generated (${r.provider === "ollama" ? "Ollama, local" : "Gemini, cloud"} · ${r.model}). ${r.removed.length ? `${r.removed.length} unsupported statement${r.removed.length === 1 ? " was" : "s were"} removed. ` : ""}Review it before approving.`,
      data: { stages: r.stages, removed: r.removed, versionId },
    };
  });
  return result;
}

/** Editor save (called directly by the client component). */
export async function saveCommunicationContentAction(
  communicationId: string,
  content: unknown,
  expectedHash: string,
): Promise<
  | {
      ok: true;
      hash: string;
      versionId: string;
      versionNumber: number;
      created: boolean;
      status: string;
    }
  | { ok: false; error: string; conflict: boolean }
> {
  try {
    const actor = await requireActor();
    const { version, created } = await saveCommunicationContent(actor, id.parse(communicationId), {
      content,
      expectedHash: hash.parse(expectedHash),
    });
    revalidate(communicationId);
    return {
      ok: true,
      hash: version.contentHash,
      versionId: version.id,
      versionNumber: version.versionNumber,
      created,
      status: version.status,
    };
  } catch (error) {
    const e = toAppError(error);
    return { ok: false, error: e.publicMessage, conflict: e.code === "CONFLICT" };
  }
}

export async function updateSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const communicationId = id.parse(formData.get("communicationId"));
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    delete raw.communicationId;
    await updateCommunicationSettings(actor, communicationId, raw);
    revalidate(communicationId);
    return { message: "Settings saved. Regenerate or edit to apply them to the content." };
  });
}

export async function runCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  return runAction(async () => {
    const actor = await requireActor();
    const { check } = await runCommunicationCheck(actor, versionId, { force: true });
    revalidate(communicationId);
    const s = check.summary as { critical: number; warnings: number; passed: number };
    return { message: `${s.passed} passed · ${s.critical} critical · ${s.warnings} warnings` };
  });
}

export async function setStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  const status = z
    .enum(["DRAFT", "READY_FOR_REVIEW", "REJECTED", "ARCHIVED"])
    .parse(formData.get("status"));
  return runAction(async () => {
    const actor = await requireActor();
    await setCommunicationVersionStatus(actor, versionId, status);
    revalidate(communicationId);
  });
}

export async function approveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  const expectedHash = hash.parse(formData.get("contentHash"));
  return runAction(async () => {
    if (formData.get("confirm") !== "on")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Tick the box to confirm you reviewed this exact version.",
      });
    const actor = await requireActor();
    const r = await approveCommunicationVersion(actor, versionId, expectedHash);
    revalidate(communicationId);
    return { message: r.created ? "Approved. This exact version is locked." : "Already approved." };
  });
}

export async function revokeApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  return runAction(async () => {
    const actor = await requireActor();
    await revokeCommunicationApproval(actor, versionId, String(formData.get("reason") ?? ""));
    revalidate(communicationId);
  });
}

export async function restoreVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  const result = await runAction(async () => {
    const actor = await requireActor();
    await restoreCommunicationVersion(actor, versionId);
    revalidate(communicationId);
  });
  if (result.ok) redirect(`/communications/${communicationId}`);
  return result;
}

export async function archiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const communicationId = id.parse(formData.get("communicationId"));
  const archived = formData.get("archived") === "1";
  return runAction(async () => {
    const actor = await requireActor();
    await archiveCommunication(actor, communicationId, archived);
    revalidate(communicationId);
  });
}

export async function duplicateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const communicationId = id.parse(formData.get("communicationId"));
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    target = (await duplicateCommunication(actor, communicationId)).id;
    revalidate(target);
  });
  if (result.ok && target) redirect(`/communications/${target}`);
  return result;
}

export async function exportAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const versionId = id.parse(formData.get("versionId"));
  const communicationId = id.parse(formData.get("communicationId"));
  const format = z.enum(COMMUNICATION_EXPORT_FORMATS).parse(formData.get("format"));
  return runAction(async () => {
    const actor = await requireActor();
    const r = await exportCommunicationVersion(actor, versionId, format);
    revalidate(communicationId);
    return {
      message: r.reused
        ? `${format} ready (unchanged since the last export).`
        : `${format} exported and verified.`,
      data: { exportId: r.export.id },
    };
  });
}

export async function addFactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const claimId = id.parse(formData.get("claimId"));
  const communicationId = id.parse(formData.get("communicationId"));
  return runAction(async () => {
    const actor = await requireActor();
    await addClaimAsCandidateFact(actor, claimId);
    revalidate(communicationId);
    revalidatePath("/candidate");
    return {
      message: "Added to your candidate facts as a statement you provided; the check was re-run.",
    };
  });
}

export async function saveSignatureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formDataToObject(formData);
    const presetId =
      typeof raw.presetId === "string" && raw.presetId ? id.parse(raw.presetId) : null;
    await saveSignaturePreset(
      actor,
      {
        name: raw.name,
        isDefault: raw.isDefault,
        fields: {
          name: raw.f_name,
          email: raw.f_email,
          phone: raw.f_phone,
          location: raw.f_location,
          linkedin: raw.f_linkedin,
          portfolio: raw.f_portfolio,
          website: raw.f_website,
        },
      },
      presetId,
    );
    revalidatePath("/communications/signatures");
    return { message: "Signature saved." };
  });
}

export async function deleteSignatureAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteSignaturePreset(actor, id.parse(formData.get("presetId")));
    revalidatePath("/communications/signatures");
  });
}
