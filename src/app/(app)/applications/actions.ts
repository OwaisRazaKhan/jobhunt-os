"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionState } from "@/lib/action-state";
import { formDataToObject } from "@/lib/form-data";
import {
  addQuestion,
  approveAnswer,
  editAnswer,
  generateAnswers,
} from "@/modules/applications/answer.service";
import {
  resolveUncertainSubmission,
  setAutomationMode,
  transitionApplication,
} from "@/modules/applications/application.service";
import {
  confirmManualSubmission,
  enqueueAttempt,
  prepareEmailSubmission,
  requestSubmit,
  setControlCommand,
} from "@/modules/applications/execution.service";
import {
  createApplicationFromPackage,
  discoverChannels,
  inspectApplicationForm,
  mapApplication,
  saveApplicationSettings,
} from "@/modules/applications/prepare.service";
import {
  approveApplication,
  computeReadiness,
  confirmField,
  overrideField,
  revokeApplicationApproval,
} from "@/modules/applications/review.service";
import { AUTOMATION_MODES } from "@/modules/applications/types";
import { runAction } from "@/server/action";
import { AppError } from "@/server/errors";
import { requireActor } from "@/server/session";

/* Thin transport: authenticate -> parse -> service (ownership in the services + RLS). */

const id = z.uuid();
const appIdOf = (fd: FormData) => id.parse(fd.get("applicationId"));
const text = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
};

function revalidate(applicationId?: string) {
  revalidatePath("/applications");
  if (applicationId) {
    revalidatePath(`/applications/${applicationId}`);
    revalidatePath(`/applications/${applicationId}/review`);
    revalidatePath(`/applications/${applicationId}/questions`);
  }
}

export async function createApplicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packageId = id.parse(formData.get("packageId"));
  let target = "";
  const result = await runAction(async () => {
    const actor = await requireActor();
    try {
      const app = await createApplicationFromPackage(actor, packageId);
      target = app.id;
      // Channel discovery is deterministic and local: run it straight away.
      await discoverChannels(actor, app.id).catch(() => undefined);
    } catch (error) {
      const existing =
        error instanceof AppError && error.code === "CONFLICT"
          ? error.details?.find((d) => d.path === "applicationId")?.message
          : undefined;
      if (existing) {
        target = existing;
        return;
      }
      throw error;
    }
    revalidate(target);
  });
  if (result.ok && target) redirect(`/applications/${target}`);
  return result;
}

export async function discoverChannelsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const url = text(formData, "url").trim();
    const email = text(formData, "email").trim();
    const r = await discoverChannels(
      actor,
      applicationId,
      url || email ? { url: url || null, email: email || null } : undefined,
    );
    revalidate(applicationId);
    return {
      message: r.primary
        ? `Channel: ${r.primary.channelType.toLowerCase().replace(/_/g, " ")}.`
        : "No application channel found — apply manually or enter the form URL.",
    };
  });
}

export async function inspectFormAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const r = await inspectApplicationForm(actor, applicationId);
    revalidate(applicationId);
    return {
      message:
        r.mode === "API"
          ? `Form read from the official ${r.adapter.label} API and mapped.`
          : r.mode === "QUEUED"
            ? "Inspection queued — the application worker will open the form (npm run worker:applications)."
            : `${r.adapter.label}: there is no form to inspect.`,
    };
  });
}

export async function remapAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const r = await mapApplication(actor, applicationId);
    revalidate(applicationId);
    return { message: `Mapped: ${r.mapped} filled, ${r.review} to confirm, ${r.input} need you.` };
  });
}

export async function refreshReadinessAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const r = await computeReadiness(actor, applicationId);
    revalidate(applicationId);
    return { message: `Readiness: ${r.readiness.toLowerCase().replace(/_/g, " ")}.` };
  });
}

export async function overrideFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  const fieldId = id.parse(formData.get("fieldId"));
  return runAction(async () => {
    const actor = await requireActor();
    const raw = formData.getAll("value").filter((v): v is string => typeof v === "string");
    const multi = formData.get("multi") === "1";
    const checkbox = formData.get("checkbox") === "1";
    const value = checkbox ? raw.includes("on") : multi ? raw : (raw[0] ?? "").trim();
    await overrideField(actor, fieldId, value);
    revalidate(applicationId);
    return { message: "Saved (a new mapping version)." };
  });
}

export async function confirmFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    await confirmField(actor, id.parse(formData.get("fieldId")));
    revalidate(applicationId);
    return { message: "Confirmed." };
  });
}

export async function generateAnswersAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const r = await generateAnswers(actor, applicationId);
    revalidate(applicationId);
    return {
      message: `Drafted ${r.generated} answer(s); ${r.needsInput} need you. Review and approve each one.`,
    };
  });
}

export async function editAnswerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    await editAnswer(actor, id.parse(formData.get("questionId")), text(formData, "answer"));
    revalidate(applicationId);
    return { message: "Saved and re-checked against your facts." };
  });
}

export async function approveAnswerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    await approveAnswer(actor, id.parse(formData.get("questionId")));
    revalidate(applicationId);
    return { message: "Answer approved." };
  });
}

export async function addQuestionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const max = Number(text(formData, "maxLength"));
    await addQuestion(
      actor,
      applicationId,
      text(formData, "question"),
      Number.isFinite(max) && max > 0 ? Math.min(max, 20000) : null,
      formData.get("required") === "on",
    );
    revalidate(applicationId);
    return { message: "Question added." };
  });
}

export async function approveApplicationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    if (formData.get("confirm") !== "on")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Tick the box to confirm you reviewed every field, answer and file.",
      });
    const hash = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(formData.get("applicationHash"));
    const actor = await requireActor();
    const r = await approveApplication(actor, applicationId, hash);
    revalidate(applicationId);
    return {
      message: r.created ? "Approved. Nothing has been submitted yet." : "Already approved.",
    };
  });
}

export async function revokeApprovalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    await revokeApplicationApproval(actor, applicationId, "Withdrawn by you.");
    revalidate(applicationId);
    return { message: "Approval withdrawn." };
  });
}

export async function startFillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const attempt = await enqueueAttempt(actor, applicationId, "FILL");
    revalidate(applicationId);
    return {
      message:
        attempt.phase === "FILL_AND_SUBMIT"
          ? "Queued: the worker will fill and submit the approved application."
          : "Queued: the worker will fill the form and wait for your submit decision.",
    };
  });
}

export async function controlAttemptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const command = z.enum(["PAUSE", "RESUME", "STOP"]).parse(formData.get("command"));
    await setControlCommand(actor, id.parse(formData.get("attemptId")), command);
    revalidate(applicationId);
    return {
      message:
        command === "STOP"
          ? "Stopping."
          : command === "PAUSE"
            ? "Pausing after the current step."
            : "Resuming.",
    };
  });
}

export async function requestSubmitAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    if (formData.get("confirm") !== "on")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Tick the box to confirm you want to submit this application.",
      });
    const actor = await requireActor();
    await requestSubmit(actor, applicationId);
    revalidate(applicationId);
    return { message: "Submitting — the result is recorded only with evidence." };
  });
}

export async function prepareEmailAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    await prepareEmailSubmission(actor, applicationId);
    revalidate(applicationId);
    return { message: "Ready to send. Send it from your own mail client, then confirm below." };
  });
}

export async function confirmManualAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    if (formData.get("confirm") !== "on")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Tick the box to confirm you submitted this application yourself.",
      });
    const actor = await requireActor();
    await confirmManualSubmission(actor, applicationId, {
      note: text(formData, "note"),
      externalApplicationId: text(formData, "externalApplicationId"),
    });
    revalidate(applicationId);
    return { message: "Recorded as submitted (confirmed by you)." };
  });
}

export async function resolveUncertainAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const submitted = formData.get("submitted") === "yes";
    await resolveUncertainSubmission(actor, applicationId, {
      submitted,
      note: text(formData, "note") || null,
      externalApplicationId: text(formData, "externalApplicationId") || null,
    });
    revalidate(applicationId);
    return {
      message: submitted
        ? "Recorded as submitted (confirmed by you)."
        : "Recorded as not submitted.",
    };
  });
}

export async function setModeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const mode = z.enum(AUTOMATION_MODES).parse(formData.get("mode"));
    await setAutomationMode(actor, applicationId, mode);
    revalidate(applicationId);
    return { message: "Automation mode saved." };
  });
}

export async function transitionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicationId = appIdOf(formData);
  return runAction(async () => {
    const actor = await requireActor();
    const to = z
      .enum(["CANCELLED", "ARCHIVED", "WITHDRAWN", "IN_PROGRESS"])
      .parse(formData.get("to"));
    await transitionApplication(actor, applicationId, to, {
      reason: text(formData, "reason") || null,
    });
    revalidate(applicationId);
    return { message: `Moved to ${to.toLowerCase().replace(/_/g, " ")}.` };
  });
}

export async function saveApplicationSettingsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await requireActor();
    await saveApplicationSettings(actor, formDataToObject(formData));
    revalidatePath("/applications/settings");
    return { message: "Settings saved. They apply to new applications." };
  });
}
