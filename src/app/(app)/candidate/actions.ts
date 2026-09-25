"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import {
  approveCandidate,
  bulkApproveCandidates,
  bulkRejectCandidates,
  createFact,
  deleteCandidateData,
  deleteDocument,
  deleteFact,
  processDocument,
  rejectCandidate,
  restoreFact,
  setTargetLocations,
  updateFact,
  updateOnboarding,
  updatePreferences,
  updateProfile,
  verifyFact,
  verifyProfile,
} from "@/modules/candidate";
import { isSectionKind, ONBOARDING_STEPS, type OnboardingStep } from "@/modules/candidate/schemas";
import { runAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { requireActor } from "@/server/session";

/*
 * Thin transport layer: authenticate -> parse -> call service -> revalidate.
 * Ids from the client are only used as lookup keys; services enforce ownership.
 */

const idSchema = z.uuid();

function refresh() {
  revalidatePath("/candidate", "layout");
}

function sectionKindFrom(formData: FormData) {
  const kind = formData.get("_kind");
  if (!isSectionKind(kind)) throw new AppError("VALIDATION_ERROR", { message: "Unknown section" });
  return kind;
}

// --- Profile -------------------------------------------------------------------------

export async function saveProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await updateProfile(actor, formDataToObject(formData));
    refresh();
    return { message: "Profile saved." };
  });
}

export async function verifyProfileAction(): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await verifyProfile(actor);
    refresh();
    return { message: "Basic information marked as verified." };
  });
}

// --- Facts ---------------------------------------------------------------------------

export async function saveFactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const kind = sectionKindFrom(formData);
    const id = formData.get("_id");
    const input = formDataToObject(formData);
    if (id) await updateFact(actor, kind, idSchema.parse(id), input);
    else await createFact(actor, kind, input);
    refresh();
    return { message: id ? "Changes saved." : "Added." };
  });
}

export async function verifyFactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await verifyFact(actor, sectionKindFrom(formData), idSchema.parse(formData.get("_id")));
    refresh();
    return { message: "Marked as verified." };
  });
}

export async function deleteFactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const kind = sectionKindFrom(formData);
    const id = idSchema.parse(formData.get("_id"));
    await deleteFact(actor, kind, id);
    refresh();
    return { message: "Deleted. You can undo this for 30 days.", data: { kind, id } };
  });
}

export async function restoreFactAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await restoreFact(actor, sectionKindFrom(formData), idSchema.parse(formData.get("_id")));
    refresh();
    return { message: "Restored." };
  });
}

// --- Preferences -----------------------------------------------------------------------

export async function savePreferencesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await updatePreferences(actor, formDataToObject(formData));
    refresh();
    return { message: "Preferences saved." };
  });
}

export async function saveTargetLocationsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const countries = formData.getAll("countryCode").map(String);
    const cities = formData.getAll("city").map(String);
    const locations = countries
      .map((countryCode, i) => ({ countryCode, city: cities[i] ?? "" }))
      .filter((l) => l.countryCode);
    await setTargetLocations(actor, { locations });
    refresh();
    return { message: "Target locations saved." };
  });
}

// --- Onboarding ------------------------------------------------------------------------

export async function onboardingAction(formData: FormData) {
  const actor = await requireActor();
  const step = z.enum(ONBOARDING_STEPS).parse(formData.get("step"));
  const action = z.enum(["complete", "skip", "exit"]).parse(formData.get("action"));
  if (action !== "exit") await updateOnboarding(actor, { step, action });
  refresh();
  if (action === "exit") redirect("/candidate");
  const index = ONBOARDING_STEPS.indexOf(step);
  const next: OnboardingStep | undefined = ONBOARDING_STEPS[index + 1];
  redirect(next ? `/candidate/onboarding?step=${next}` : "/candidate");
}

/** Called after an inline onboarding form saved successfully; returns the next step URL. */
export async function completeOnboardingStepAction(step: string): Promise<string> {
  const actor = await requireActor();
  const parsed = z.enum(ONBOARDING_STEPS).parse(step);
  await updateOnboarding(actor, { step: parsed, action: "complete" });
  refresh();
  const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(parsed) + 1];
  return next ? `/candidate/onboarding?step=${next}` : "/candidate";
}

// --- Fact review -----------------------------------------------------------------------

export async function approveCandidateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await approveCandidate(actor, idSchema.parse(formData.get("_candidateId")), { mode: "verify" });
    refresh();
    return { message: "Approved and verified." };
  });
}

export async function approveEditedCandidateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const candidateId = idSchema.parse(formData.get("_candidateId"));
    const editedPayload = formDataToObject(formData);
    await approveCandidate(actor, candidateId, { mode: "verify", editedPayload });
    refresh();
    return { message: "Saved with your edits and verified." };
  });
}

export async function rejectCandidateAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const reason = formData.get("_reason") === "duplicate" ? "duplicate" : "incorrect";
    await rejectCandidate(actor, idSchema.parse(formData.get("_candidateId")), reason);
    refresh();
    return { message: "Rejected." };
  });
}

export async function bulkReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const ids = z.array(z.uuid()).max(200).parse(formData.getAll("candidateId"));
    if (ids.length === 0)
      throw new AppError("VALIDATION_ERROR", { publicMessage: "Select at least one fact." });
    if (formData.get("_op") === "reject") {
      const { rejected } = await bulkRejectCandidates(actor, ids);
      refresh();
      return { message: `Rejected ${rejected} fact${rejected === 1 ? "" : "s"}.` };
    }
    const result = await bulkApproveCandidates(actor, ids);
    refresh();
    const skipped = result.skipped.length
      ? ` ${result.skipped.length} skipped (need individual review).`
      : "";
    return {
      message: `Added ${result.approved.length} fact${result.approved.length === 1 ? "" : "s"} as User provided (not verified).${skipped}`,
    };
  });
}

// --- Documents -------------------------------------------------------------------------

export async function reprocessDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    const documentId = idSchema.parse(formData.get("_id"));
    after(async () => {
      try {
        await processDocument(actor, documentId);
      } catch (error) {
        logger.warn("reprocess failed", {
          documentId,
          code: error instanceof AppError ? error.code : "UNKNOWN",
        });
      }
    });
    refresh();
    return { message: "Reprocessing started." };
  });
}

export async function deleteDocumentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await deleteDocument(actor, idSchema.parse(formData.get("_id")));
    refresh();
    return { message: "Document deleted. Facts you approved from it are kept." };
  });
}

// --- Privacy ---------------------------------------------------------------------------

export async function deleteCandidateDataAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    if (formData.get("confirm") !== "DELETE") {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Type DELETE to confirm.",
        details: [{ path: "confirm", message: "Type DELETE to confirm" }],
      });
    }
    await deleteCandidateData(actor);
    refresh();
    return { message: "All candidate data and uploaded documents were deleted." };
  });
}
