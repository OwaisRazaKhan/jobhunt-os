"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import {
  cancelMatchBatch,
  executeMatchBatch,
  startMatchBatch,
} from "@/modules/matching/batch.service";
import { matchCandidateToJob, saveMatchingPreferences } from "@/modules/matching/match.service";
import { OVERALL_LABELS } from "@/modules/matching/types";
import { runAction } from "@/server/action";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership enforced there + RLS). */

const idSchema = z.uuid();

/** Run (or recalculate) the match for one job. Unchanged inputs reuse the current result. */
export async function runMatchAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const jobId = idSchema.parse(formData.get("_id"));
    const { match, reused } = await matchCandidateToJob(actor, null, jobId, { source: "MANUAL" });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath(`/jobs/${jobId}/match`);
    revalidatePath("/matches");
    return {
      message: reused
        ? "Already up to date — nothing changed since the last match."
        : `Match calculated: ${OVERALL_LABELS[match.overallStatus] ?? match.overallStatus}.`,
    };
  });
}

/** Start an explicit batch ("Match these jobs"); it runs in the background with progress. */
export async function startMatchBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const jobIds = formData.getAll("jobId").map(String);
    const batch = await startMatchBatch(actor, { jobIds });
    after(() => executeMatchBatch({ userId: actor.userId }, batch.id));
    revalidatePath("/matches");
    return {
      message: `Matching ${batch.total} job${batch.total === 1 ? "" : "s"}…`,
      data: { id: batch.id },
    };
  });
}

export async function cancelMatchBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await cancelMatchBatch(actor, idSchema.parse(formData.get("_id")));
    revalidatePath("/matches");
    return { message: "Cancelling after the current jobs finish." };
  });
}

export async function saveMatchingPreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const on = (k: string) => formData.get(k) === "on";
    await saveMatchingPreferences(actor, {
      workModeHard: on("workModeHard"),
      employmentTypeHard: on("employmentTypeHard"),
      locationHard: on("locationHard"),
      salaryMinHard: on("salaryMinHard"),
      semanticAssist: on("semanticAssist"),
    });
    revalidatePath("/matches");
    return { message: "Matching settings saved. Existing matches are now marked stale." };
  });
}
