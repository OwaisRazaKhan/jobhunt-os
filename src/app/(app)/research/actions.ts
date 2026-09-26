"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { executeResearchRun } from "@/modules/research/pipeline";
import {
  addManualSource,
  addNote,
  deleteNote,
  refreshResearch,
  saveResearchSettings,
  setCompanyTarget,
  startCompanyResearch,
  startJobResearch,
} from "@/modules/research/research.service";
import { depthSchema } from "@/modules/research/types";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const id = z.uuid();
const optionalId = (v: FormDataEntryValue | null) => (v ? id.parse(v) : undefined);

function revalidate(jobId?: string, companyId?: string) {
  if (jobId) {
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/research`);
  }
  if (companyId) revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  revalidatePath("/research");
}

/** Start job research; the run executes after the response and the page polls its progress. */
export async function startJobResearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const jobId = id.parse(formData.get("_id"));
    const run = await startJobResearch(actor, jobId, {
      depth: depthSchema.optional().parse(formData.get("depth") || undefined),
      refreshCompany: formData.get("refreshCompany") === "on",
    });
    after(() => executeResearchRun({ userId: actor.userId }, run.id));
    return { message: "Researching job…", data: { runId: run.id } };
  });
}

export async function startCompanyResearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const companyId = id.parse(formData.get("_id"));
    const run = await startCompanyResearch(actor, companyId, {
      depth: depthSchema.optional().parse(formData.get("depth") || undefined),
    });
    after(() => executeResearchRun({ userId: actor.userId }, run.id));
    return { message: "Researching company…", data: { runId: run.id } };
  });
}

export async function refreshResearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const run = await refreshResearch(actor, {
      researchId: id.parse(formData.get("_researchId")),
      options: {
        depth: depthSchema.optional().parse(formData.get("depth") || undefined),
        refreshCompany: formData.get("refreshCompany") === "on",
      },
    });
    after(() => executeResearchRun({ userId: actor.userId }, run.id));
    return { message: "Refreshing research…", data: { runId: run.id } };
  });
}

export async function addManualSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const jobId = optionalId(formData.get("jobId"));
    const companyId = optionalId(formData.get("companyId"));
    const source = await addManualSource(actor, {
      jobId,
      companyId,
      url: z
        .string()
        .max(2048)
        .parse(formData.get("url") ?? ""),
    });
    revalidate(jobId, companyId);
    return {
      message:
        source.fetchStatus === "OK"
          ? "Source added. Refresh research to include it."
          : `Source saved, but it could not be fetched (${source.error ?? source.fetchStatus.toLowerCase()}).`,
    };
  });
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const jobId = optionalId(formData.get("jobId"));
    const companyId = optionalId(formData.get("companyId"));
    await addNote(actor, { jobId, companyId, body: formData.get("body") });
    revalidate(jobId, companyId);
    return { message: "Note saved (private to you)." };
  });
}

export async function deleteNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteNote(actor, id.parse(formData.get("_id")));
    revalidate(optionalId(formData.get("jobId")), optionalId(formData.get("companyId")));
    return { message: "Note deleted." };
  });
}

export async function setCompanyTargetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const companyId = id.parse(formData.get("_id"));
    await setCompanyTarget(actor, companyId, {
      websiteUrl: String(formData.get("websiteUrl") ?? ""),
      careersUrl: String(formData.get("careersUrl") ?? ""),
    });
    revalidate(undefined, companyId);
    return { message: "Saved. Research using the old website is now marked stale." };
  });
}

export async function saveResearchSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await saveResearchSettings(actor, {
      defaultDepth: formData.get("defaultDepth"),
      freshDays: formData.get("freshDays"),
      staleDays: formData.get("staleDays"),
      aiSynthesis: formData.get("aiSynthesis") === "on",
    });
    revalidatePath("/research");
    return { message: "Research settings saved." };
  });
}
