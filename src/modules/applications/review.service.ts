import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/config/env";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { selectAdapter } from "./adapters";
import { recordEvent, type ActorRef } from "./application.service";
import { resolveApplicationFiles, type ApplicationFile } from "./files.service";
import { applicationContentHash, type ApplicationStateInput } from "./hash";
import { SUBMISSION_SENSITIVE } from "./state-machine";
import type { ApplicationStatus, FieldType, Readiness } from "./types";
import { validateFieldValue, type FieldValue } from "./validation";

/**
 * Application review (Phase 8, checkpoint 7): deterministic readiness, the normalized application
 * state and its hash, field overrides (versioned), and the human approval. Any change after
 * approval revokes it — approval is never silently preserved.
 */

export interface ReadinessItem {
  key: string;
  label: string;
  status: "PASS" | "FAIL" | "WARN" | "NA";
  detail: string;
}

const FILLABLE = ["MAPPED", "CONFIRMED", "OVERRIDDEN"];

async function loadReviewData(t: Tx, actor: ActorRef, applicationId: string) {
  const app = await t.application.findFirst({ where: { id: applicationId, userId: actor.userId } });
  if (!app) throw new AppError("NOT_FOUND");
  const channel = app.channelId
    ? await t.applicationChannel.findUnique({ where: { id: app.channelId } })
    : null;
  const form = await t.applicationForm.findFirst({
    where: { applicationId: app.id, status: { in: ["CURRENT", "CHANGED"] } },
    orderBy: { discoveredAt: "desc" },
    include: {
      fields: {
        orderBy: { position: "asc" },
        include: { mappings: { where: { isCurrent: true } } },
      },
    },
  });
  const questions = await t.applicationQuestion.findMany({
    where: { applicationId: app.id },
    include: { answers: { where: { isCurrent: true } } },
  });
  const approval = await t.applicationApproval.findFirst({
    where: { applicationId: app.id, revokedAt: null },
  });
  return { app, channel, form, questions, approval };
}

type ReviewData = Awaited<ReturnType<typeof loadReviewData>>;

function fieldValueFor(
  field: NonNullable<ReviewData["form"]>["fields"][number],
  files: ApplicationFile[],
): FieldValue {
  const m = field.mappings[0];
  if (!m || !FILLABLE.includes(m.status)) return null;
  if (field.fieldType === "FILE") {
    const role =
      m.mappingType === "RESUME"
        ? "RESUME"
        : m.mappingType === "COVER_LETTER"
          ? "COVER_LETTER"
          : null;
    const f = files.find((x) => x.role === role);
    if (!f) return null;
    return {
      kind: "file",
      fileName: f.fileName,
      mimeType: f.mimeType,
      byteSize: f.byteSize,
      sha256: f.sha256,
      approvedSha256: f.sha256,
      ownedByUser: f.storagePath.startsWith(`${m.userId}/`),
    };
  }
  return (m.value as FieldValue) ?? null;
}

/** Deterministic readiness + the normalized state that approval covers. */
export function evaluateReview(data: ReviewData, files: ApplicationFile[], now = new Date()) {
  const { app, channel, form, questions } = data;
  const items: ReadinessItem[] = [];
  const add = (key: string, label: string, status: ReadinessItem["status"], detail: string) =>
    items.push({ key, label, status, detail });
  const adapter = channel
    ? selectAdapter(channel, getServerEnv().APPLICATION_FIXTURE_ORIGIN)
    : null;
  const needsForm = Boolean(adapter?.usesBrowser);

  add(
    "package",
    "Communication package",
    app.readiness === "STALE" ? "FAIL" : "PASS",
    app.readiness === "STALE"
      ? "The package or form changed — refresh it before continuing."
      : "Exact approved versions locked.",
  );
  add(
    "channel",
    "Application channel",
    channel ? "PASS" : "FAIL",
    channel
      ? `${channel.channelType.toLowerCase().replace(/_/g, " ")}${channel.provider !== "NONE" ? ` · ${channel.provider.toLowerCase()}` : ""} (${channel.verificationStatus.toLowerCase().replace(/_/g, " ")})`
      : "Discover the application channel.",
  );
  if (channel?.channelType === "EMAIL_APPLICATION")
    add(
      "email",
      "Application email",
      channel.email ? "PASS" : "FAIL",
      channel.email
        ? `${channel.email} — ${channel.verificationStatus === "SOURCE_VERIFIED" ? "published by the company" : "not source-verified"}`
        : "No verified application email.",
    );
  if (app.deadlineAt && app.deadlineAt < now)
    add(
      "deadline",
      "Application deadline",
      "FAIL",
      `The deadline (${app.deadlineAt.toISOString().slice(0, 10)}) has passed.`,
    );
  if (needsForm)
    add(
      "form",
      "Application form",
      !form ? "FAIL" : form.status === "CHANGED" ? "FAIL" : "PASS",
      !form
        ? "Inspect the application form."
        : form.status === "CHANGED"
          ? "The form changed — inspect it again."
          : `${form.fields.length} fields (schema v${form.schemaVersion}).`,
    );

  const fields: ApplicationStateInput["fields"] = [];
  let missing = 0;
  let confirm = 0;
  let invalid = 0;
  const approvedByField = new Map<string, string>();
  for (const q of questions) {
    const ans = q.answers[0];
    if (q.fieldId && ans?.approvalStatus === "APPROVED")
      approvedByField.set(q.fieldId, ans.answerText);
  }
  for (const field of form?.fields ?? []) {
    const m = field.mappings[0];
    // Custom questions are resolved by an approved answer (hashed with the answers below).
    if (m?.mappingType === "GENERATED_ANSWER") {
      const text = approvedByField.get(field.id);
      if (text && field.maxLength && text.length > field.maxLength) invalid++;
      continue;
    }
    const value = fieldValueFor(field, files);
    const options = ((field.options as { label: string }[]) ?? []).map((o) => o.label);
    const issues =
      value === null
        ? []
        : validateFieldValue(
            {
              label: field.label,
              fieldType: field.fieldType as FieldType,
              required: field.required,
              options,
              maxLength: field.maxLength,
            },
            value,
          );
    if (field.required) {
      if (
        !m ||
        m.status === "NEEDS_USER_INPUT" ||
        m.status === "BLOCKED" ||
        (value === null && m.status !== "NEEDS_REVIEW")
      )
        missing++;
      else if (m.status === "NEEDS_REVIEW") confirm++;
    }
    if (issues.length) invalid++;
    if (value !== null && m && FILLABLE.includes(m.status))
      fields.push({
        fieldKey: field.externalFieldId,
        mappingType: m.mappingType,
        sourceRef: m.sourceRef,
        value:
          typeof value === "object" && value && !Array.isArray(value) && "kind" in value
            ? { file: value.sha256 }
            : value,
      });
  }
  if (needsForm && form) {
    add(
      "fields",
      "Required fields",
      missing ? "FAIL" : "PASS",
      missing
        ? `${missing} required field(s) need your answer.`
        : "Every required field has a value.",
    );
    if (confirm)
      add("confirm", "Fields to confirm", "FAIL", `${confirm} field(s) need your confirmation.`);
    if (invalid)
      add(
        "valid",
        "Field values",
        "FAIL",
        `${invalid} value(s) are invalid (format, option or length).`,
      );
  }

  const answers: ApplicationStateInput["answers"] = [];
  let unanswered = 0;
  let unsupported = 0;
  for (const q of questions) {
    const a = q.answers[0];
    if (a?.validationStatus === "UNSUPPORTED") unsupported++;
    if (a?.approvalStatus === "APPROVED")
      answers.push({ questionKey: q.fieldId ?? q.id, contentHash: a.contentHash });
    else if (q.required) unanswered++;
  }
  if (questions.length) {
    add(
      "answers",
      "Application questions",
      unanswered ? "FAIL" : "PASS",
      unanswered
        ? `${unanswered} required question(s) need an approved answer.`
        : `${answers.length} approved answer(s).`,
    );
    if (unsupported)
      add(
        "unsupported",
        "Unsupported answers",
        "FAIL",
        `${unsupported} answer(s) contain unsupported statements.`,
      );
  }

  const snap = app.snapshot as {
    resume?: { versionId: string; contentHash: string };
    coverLetter?: { versionId: string; contentHash: string } | null;
    email?: { versionId: string; contentHash: string } | null;
  };
  const needsFiles = needsForm || channel?.channelType === "EMAIL_APPLICATION";
  if (needsFiles) {
    const resume = files.find((f) => f.role === "RESUME");
    add(
      "resume_file",
      "Resume file",
      resume ? "PASS" : "FAIL",
      resume
        ? `${resume.fileName} (approved version)`
        : "The approved resume file could not be prepared.",
    );
    if (snap.coverLetter) {
      const cl = files.find((f) => f.role === "COVER_LETTER");
      add(
        "cover_file",
        "Cover letter file",
        cl ? "PASS" : "WARN",
        cl
          ? `${cl.fileName} (approved version)`
          : "The approved cover letter file could not be prepared.",
      );
    }
  }

  const assets: ApplicationStateInput["assets"] = {};
  if (snap.resume) assets.RESUME = snap.resume;
  if (snap.coverLetter) assets.COVER_LETTER = snap.coverLetter;
  if (snap.email) assets.EMAIL = snap.email;
  const state: ApplicationStateInput = {
    candidateId: app.candidateId,
    jobId: app.jobId,
    packageIntegrityHash: app.packageIntegrityHash,
    assets,
    fields,
    answers,
    files: files.map((f) => ({ role: f.role, sha256: f.sha256 })),
    channel: channel ? { type: channel.channelType, url: channel.url, email: channel.email } : null,
  };
  const fails = items.filter((i) => i.status === "FAIL");
  const readiness: Readiness =
    app.readiness === "STALE"
      ? "STALE"
      : items.some((i) => i.key === "deadline" && i.status === "FAIL")
        ? "BLOCKED"
        : fails.some((i) => ["fields", "confirm", "answers", "email"].includes(i.key)) &&
            fails.every((i) => ["fields", "confirm", "answers", "valid", "email"].includes(i.key))
          ? "NEEDS_USER_INPUT"
          : fails.length
            ? "NOT_READY"
            : "READY";
  return {
    items,
    state,
    hash: applicationContentHash(state),
    readiness,
    counts: {
      fields: form?.fields.length ?? 0,
      missing,
      confirm,
      invalid,
      questions: questions.length,
      answers: answers.length,
    },
  };
}

/**
 * Recomputes readiness and the application hash; moves DRAFT/IN_PROGRESS/NEEDS_HUMAN_INPUT ↔ READY;
 * an approval whose hash no longer matches the current state is revoked (edit after approval).
 */
export async function computeReadiness(actor: ActorRef, applicationId: string) {
  const files = await resolveApplicationFiles(actor, applicationId).catch(
    () => [] as ApplicationFile[],
  );
  return withUserContext(actor.userId, async (t) => {
    const data = await loadReviewData(t, actor, applicationId);
    const result = evaluateReview(data, files);
    const { app } = data;
    const status = app.status as ApplicationStatus;
    const patch: Prisma.ApplicationUpdateInput = {
      readiness: result.readiness,
      applicationHash: result.hash,
      preparedAt: new Date(),
    };
    if (
      !SUBMISSION_SENSITIVE.includes(status) &&
      !["CANCELLED", "WITHDRAWN", "ARCHIVED", "BLOCKED"].includes(status)
    ) {
      if (data.approval && data.approval.applicationHash !== result.hash) {
        await t.applicationApproval.update({
          where: { id: data.approval.id },
          data: { revokedAt: new Date(), revokeReason: "The application changed after approval." },
        });
        await recordEvent(t, actor, app.id, "APPROVAL_INVALIDATED", {
          reason: "changed after approval",
        });
      }
      const approvedStill = data.approval && data.approval.applicationHash === result.hash;
      const target: ApplicationStatus | null = approvedStill
        ? null
        : result.readiness === "READY"
          ? "READY"
          : result.readiness === "NEEDS_USER_INPUT"
            ? "NEEDS_HUMAN_INPUT"
            : status === "DRAFT"
              ? "IN_PROGRESS"
              : status === "READY_TO_SUBMIT" || status === "READY"
                ? "IN_PROGRESS"
                : null;
      if (target && target !== status && !(status === "FAILED" && target !== "READY")) {
        patch.status = target;
        if (target === "READY")
          await recordEvent(t, actor, app.id, "READY_FOR_REVIEW", { items: result.items.length });
        if (target === "NEEDS_HUMAN_INPUT")
          await recordEvent(t, actor, app.id, "WAITING_FOR_USER", {
            missing: result.counts.missing,
            confirm: result.counts.confirm,
          });
      }
    }
    await t.application.update({ where: { id: app.id }, data: patch });
    return result;
  });
}

export async function getReview(actor: ActorRef, applicationId: string) {
  const files = await resolveApplicationFiles(actor, applicationId).catch(
    () => [] as ApplicationFile[],
  );
  return withUserContext(actor.userId, async (t) => {
    const data = await loadReviewData(t, actor, applicationId);
    return { ...data, files, evaluation: evaluateReview(data, files) };
  });
}

// --- Field overrides -----------------------------------------------------------------------------------

async function newMappingVersion(
  t: Tx,
  actor: ActorRef,
  fieldId: string,
  patch: {
    value: unknown;
    status: "CONFIRMED" | "OVERRIDDEN";
    mappingType?: string;
    sourceRef?: string | null;
    explanation: string;
  },
) {
  const field = await t.applicationField.findFirst({
    where: { id: fieldId, userId: actor.userId },
    include: { form: true, mappings: { where: { isCurrent: true } } },
  });
  if (!field) throw new AppError("NOT_FOUND");
  const app = await t.application.findFirstOrThrow({
    where: { id: field.form.applicationId, userId: actor.userId },
  });
  if (SUBMISSION_SENSITIVE.includes(app.status as ApplicationStatus))
    throw new AppError("VALIDATION_ERROR", {
      publicMessage:
        "The application is being (or was) submitted — it can't be edited. Start a new preparation instead.",
    });
  const current = field.mappings[0];
  const options = ((field.options as { label: string }[]) ?? []).map((o) => o.label);
  if (patch.value !== null && field.fieldType !== "FILE") {
    const issues = validateFieldValue(
      {
        label: field.label,
        fieldType: field.fieldType as FieldType,
        required: field.required,
        options,
        maxLength: field.maxLength,
      },
      patch.value as FieldValue,
    );
    if (issues.length)
      throw new AppError("VALIDATION_ERROR", { publicMessage: issues[0]!.message });
  }
  if (current)
    await t.applicationFieldMapping.update({
      where: { id: current.id },
      data: { isCurrent: false },
    });
  const mapping = await t.applicationFieldMapping.create({
    data: {
      userId: actor.userId,
      fieldId: field.id,
      version: (current?.version ?? 0) + 1,
      mappingType: patch.mappingType ?? current?.mappingType ?? "USER_INPUT",
      sourceRef: patch.sourceRef !== undefined ? patch.sourceRef : (current?.sourceRef ?? null),
      value: patch.value === null ? undefined : (patch.value as Prisma.InputJsonValue),
      confidence: "EXACT",
      policy: "AUTO_FILL",
      status: patch.status,
      explanation: patch.explanation.slice(0, 1000),
      createdBy: "USER",
    },
  });
  await recordEvent(t, actor, app.id, "FIELD_OVERRIDDEN", {
    field: field.externalFieldId.slice(0, 100),
    version: mapping.version,
    status: patch.status,
  });
  await recordAudit(t, {
    userId: actor.userId,
    action: "application_field_mapped",
    resourceType: "application_field",
    resourceId: field.id,
    metadata: { version: mapping.version, by: "USER" },
  });
  return app.id;
}

/** The candidate enters or changes a value (versioned; covered by the next approval). */
export async function overrideField(
  actor: ActorRef,
  fieldId: string,
  value: string | string[] | boolean | null,
) {
  const applicationId = await withUserContext(actor.userId, (t) =>
    newMappingVersion(t, actor, fieldId, {
      value: value === "" ? null : value,
      status: "OVERRIDDEN",
      mappingType: "USER_INPUT",
      sourceRef: null,
      explanation: "Entered by you.",
    }),
  );
  return computeReadiness(actor, applicationId);
}

/** The candidate confirms the suggested value as-is. */
export async function confirmField(actor: ActorRef, fieldId: string) {
  const applicationId = await withUserContext(actor.userId, async (t) => {
    const current = await t.applicationFieldMapping.findFirst({
      where: { fieldId, userId: actor.userId, isCurrent: true },
    });
    if (!current) throw new AppError("NOT_FOUND");
    if (current.mappingType === "UNKNOWN" || current.value === null)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "There is no value to confirm — enter one instead.",
      });
    return newMappingVersion(t, actor, fieldId, {
      value: current.value,
      status: "CONFIRMED",
      explanation: `Confirmed by you. ${current.explanation ?? ""}`.trim(),
    });
  });
  return computeReadiness(actor, applicationId);
}

// --- Approval --------------------------------------------------------------------------------------------

/**
 * The human approval gate: the package is re-validated, the job must be open (when checkable),
 * readiness must be READY, and the caller confirms the exact hash they reviewed. Creates an
 * immutable approval (hash + normalized payload) and moves READY → READY_TO_SUBMIT.
 */
export async function approveApplication(
  actor: ActorRef,
  applicationId: string,
  expectedHash: string,
) {
  const { validatePackage, checkJobOpen } = await import("./prepare.service");
  const pkg = await validatePackage(actor, applicationId);
  if (!pkg.ok)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `The package is stale: ${pkg.reason}`,
    });
  const open = await checkJobOpen(actor, applicationId);
  if (open.open === false) {
    const { transitionApplication } = await import("./application.service");
    await transitionApplication(actor, applicationId, "BLOCKED", { reason: open.detail });
    throw new AppError("VALIDATION_ERROR", { publicMessage: `Blocked: ${open.detail}` });
  }
  const result = await computeReadiness(actor, applicationId);
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirstOrThrow({
      where: { id: applicationId, userId: actor.userId },
    });
    const active = await t.applicationApproval.findFirst({
      where: { applicationId: app.id, revokedAt: null },
    });
    if (active && active.applicationHash === result.hash && app.status === "READY_TO_SUBMIT")
      return { approval: active, created: false };
    if (result.readiness !== "READY") {
      const fails = result.items.filter((i) => i.status === "FAIL").map((i) => i.detail);
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `Not ready: ${fails.slice(0, 3).join(" ")}`,
      });
    }
    if (result.hash !== expectedHash)
      throw new AppError("CONFLICT", {
        publicMessage:
          "The application changed since you reviewed it. Review it again before approving.",
      });
    if (app.status !== "READY")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `A ${app.status.toLowerCase().replace(/_/g, " ")} application can't be approved.`,
      });
    const approval = await t.applicationApproval.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        applicationHash: result.hash,
        payload: {
          state: result.state,
          approvedAt: new Date().toISOString(),
          counts: result.counts,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await t.application.update({
      where: { id: app.id },
      data: { status: "READY_TO_SUBMIT", applicationHash: result.hash },
    });
    await recordEvent(t, actor, app.id, "APPROVED", { approvalId: approval.id });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_approved",
      resourceType: "application",
      resourceId: app.id,
      metadata: { applicationHash: result.hash, approvalId: approval.id },
    });
    return { approval, created: true };
  });
}

export async function revokeApplicationApproval(
  actor: ActorRef,
  applicationId: string,
  reason: string,
) {
  const { invalidateApprovalTx } = await import("./prepare.service");
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
    });
    if (!app) throw new AppError("NOT_FOUND");
    if (SUBMISSION_SENSITIVE.includes(app.status as ApplicationStatus))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "A submission has started — the approval can't be withdrawn now.",
      });
    const done = await invalidateApprovalTx(t, actor, app.id, reason.trim() || "Withdrawn by you.");
    if (!done)
      throw new AppError("VALIDATION_ERROR", { publicMessage: "There is no active approval." });
  });
}
