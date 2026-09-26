"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { runVersionCheck } from "@/modules/resumes/check.service";
import { exportResumeVersion } from "@/modules/resumes/export.service";
import {
  addNewFactsToResume,
  approveVersion,
  archiveResume,
  createMasterResume,
  createResume,
  duplicateResume,
  restoreVersion,
  revokeApproval,
  saveAsNewVersion,
  saveResumeContent,
  setVersionStatus,
  updateResumeSettings,
} from "@/modules/resumes/resume.service";
import { tailorResumeToJob } from "@/modules/resumes/tailor.service";
import { tailoringOptionsSchema } from "@/modules/resumes/tailor";
import { runAction } from "@/server/action";
import { toAppError } from "@/server/errors";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const id = z.uuid();

function revalidate(resumeId?: string) {
  revalidatePath("/resumes");
  if (resumeId) revalidatePath(`/resumes/${resumeId}`);
}

export async function createMasterResumeAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const { resume } = await createMasterResume(actor);
    target = resume.id;
    revalidate(resume.id);
  });
  if (result.ok && target) redirect(`/resumes/${target}`);
  return result;
}

export async function createResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const from = formData.get("fromResumeId");
    const { resume } = await createResume(actor, {
      name: String(formData.get("name") ?? ""),
      fromResumeId: from ? id.parse(from) : null,
    });
    target = resume.id;
    revalidate(resume.id);
  });
  if (result.ok && target) redirect(`/resumes/${target}`);
  return result;
}

export async function duplicateResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const { resume } = await duplicateResume(actor, id.parse(formData.get("resumeId")));
    target = resume.id;
    revalidate(resume.id);
  });
  if (result.ok && target) redirect(`/resumes/${target}`);
  return result;
}

/** Editor save (called directly by the client component, not a form). */
export async function saveResumeContentAction(
  resumeId: string,
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
    const { version, created } = await saveResumeContent(actor, id.parse(resumeId), {
      content,
      expectedHash: z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .parse(expectedHash),
    });
    if (created) revalidate(resumeId);
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
    const detail = e.details
      ?.map((d) => `${d.path ? `${d.path}: ` : ""}${d.message}`)
      .slice(0, 3)
      .join("; ");
    return {
      ok: false,
      error: detail ? `${e.publicMessage} ${detail}` : e.publicMessage,
      conflict: e.code === "CONFLICT",
    };
  }
}

export async function saveAsNewVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const resumeId = id.parse(formData.get("resumeId"));
    const version = await saveAsNewVersion(actor, resumeId, String(formData.get("title") ?? ""));
    revalidate(resumeId);
    return { message: `Saved. Now editing v${version.versionNumber}.` };
  });
}

export async function restoreVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    const version = await restoreVersion(actor, id.parse(formData.get("versionId")));
    target = version.resumeId;
    revalidate(version.resumeId);
  });
  if (result.ok && target) redirect(`/resumes/${target}`);
  return result;
}

export async function addNewFactsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const resumeId = id.parse(formData.get("resumeId"));
    const { added } = await addNewFactsToResume(actor, resumeId);
    revalidate(resumeId);
    return {
      message: added
        ? `Added ${added} new fact${added === 1 ? "" : "s"}.`
        : "Everything in your profile is already in this resume.",
    };
  });
}

export async function updateResumeSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const resumeId = id.parse(formData.get("resumeId"));
    const get = (k: string) => (formData.has(k) ? String(formData.get(k)) : undefined);
    await updateResumeSettings(actor, resumeId, {
      name: get("name"),
      template: get("template"),
      pageFormat: get("pageFormat"),
    });
    revalidate(resumeId);
    return { message: "Saved." };
  });
}

export async function setVersionStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const status = z
      .enum(["DRAFT", "READY_FOR_REVIEW", "REJECTED", "ARCHIVED"])
      .parse(formData.get("status"));
    const version = await setVersionStatus(actor, id.parse(formData.get("versionId")), status);
    revalidate(version.resumeId);
    return { message: "Status updated." };
  });
}

export async function approveVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const versionId = id.parse(formData.get("versionId"));
    const { created } = await approveVersion(
      actor,
      versionId,
      String(formData.get("contentHash") ?? ""),
    );
    revalidatePath("/resumes", "layout");
    return {
      message: created ? "Approved. This exact content is now approved." : "Already approved.",
    };
  });
}

export async function revokeApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await revokeApproval(
      actor,
      id.parse(formData.get("versionId")),
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/resumes", "layout");
    return { message: "Approval withdrawn." };
  });
}

export async function archiveResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const resumeId = id.parse(formData.get("resumeId"));
    const archived = formData.get("archived") === "true";
    await archiveResume(actor, resumeId, archived);
    revalidate(resumeId);
    return { message: archived ? "Archived." : "Restored." };
  });
}

export async function runCheckAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const versionId = id.parse(formData.get("versionId"));
    const jobRaw = formData.get("jobId");
    const { check, cached } = await runVersionCheck(actor, versionId, {
      jobId: jobRaw ? id.parse(jobRaw) : undefined,
      force: formData.get("force") === "true",
    });
    revalidatePath("/resumes", "layout");
    const s = check.summary as Record<string, number>;
    return {
      message: `${cached ? "Up to date: " : ""}${s.passed} checks passed · ${s.issues} issues · ${s.warnings} to review · ${s.opportunities} alignment opportunities.`,
    };
  });
}

export async function exportResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const versionId = id.parse(formData.get("versionId"));
    const format = z.enum(["PDF", "DOCX"]).parse(formData.get("format"));
    const { export: record, reused } = await exportResumeVersion(actor, versionId, format);
    revalidatePath("/resumes", "layout");
    return {
      message: `${format} ${reused ? "already generated" : "generated"} (${Math.round((record.byteSize ?? 0) / 1024)} KB).`,
      data: { exportId: record.id },
    };
  });
}

const tailorForm = z.object({
  sourceResumeId: id,
  sourceVersionId: id.nullish(),
  jobId: id,
});

export async function tailorResumeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const base = tailorForm.parse({
      sourceResumeId: formData.get("sourceResumeId"),
      sourceVersionId: formData.get("sourceVersionId") || null,
      jobId: formData.get("jobId"),
    });
    const options = tailoringOptionsSchema.parse({
      emphasis: formData.get("emphasis") || undefined,
      summaryMode: formData.get("summaryMode") || undefined,
      keywordAlignment: formData.get("keywordAlignment") || undefined,
      pageTarget: formData.get("pageTarget") || undefined,
      includeProjects: formData.get("includeProjects") === "on",
      includeLinks: formData.get("includeLinks") === "on",
      useAi: formData.get("useAi") === "on",
    });
    const result = await tailorResumeToJob(actor, { ...base, options });
    revalidate(result.resumeId);
    return {
      message: result.reused
        ? "An identical tailored draft already exists — opened it instead of creating a duplicate."
        : "Tailored draft created. Review the changes before approving.",
      data: {
        resumeId: result.resumeId,
        versionId: result.resumeVersionId,
        stages: result.stages,
        aiStatus: result.aiStatus,
        changes: result.changeSet.changes.length,
        rejected: result.changeSet.rejected.length,
        needsReview: result.changeSet.needsReview.length,
        quality: result.qualityReport,
      },
    };
  });
}
