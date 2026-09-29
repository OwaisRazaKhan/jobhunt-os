import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { assertTransition, canTransition, SUBMISSION_SENSITIVE } from "./state-machine";
import {
  ACTIVE_ATTEMPT_STATUSES,
  APPLICATION_FILTERS,
  type ApplicationFilter,
  type ApplicationStatus,
  type AttemptStatus,
  type AutomationMode,
  type ConfirmationSource,
  type ErrorCode,
  type EventType,
  type EvidenceType,
} from "./types";

/**
 * Application Engine — core records (Phase 8, checkpoint 1).
 *  - every read/write is owner-scoped (service filter + RLS)
 *  - status changes go through the state machine; the gated targets (approval, submission,
 *    confirmation) are only reachable through their dedicated functions
 *  - success is only recorded with evidence; uncertain results are never retried automatically
 *  - events are append-only and carry sanitized metadata only
 */

export type ActorRef = { userId: string };

/** Targets that require a dedicated, validated path (never a plain status change). */
const GATED: readonly ApplicationStatus[] = [
  "READY_TO_SUBMIT",
  "SUBMITTING",
  "SUBMITTED",
  "SUBMISSION_CONFIRMED",
  "SUBMISSION_UNCERTAIN",
];

async function ownedApplication(t: Tx, actor: ActorRef, id: string) {
  const a = await t.application.findFirst({ where: { id, userId: actor.userId } });
  if (!a) throw new AppError("NOT_FOUND");
  return a;
}

/** Event metadata is kept small and free of candidate content, sessions or secrets. */
export function sanitizePayload(payload: Record<string, unknown> = {}): Prisma.InputJsonValue {
  const SECRET = /(cookie|token|password|secret|session|authorization|api[-_]?key)/i;
  const clean = (v: unknown, depth: number): unknown => {
    if (depth > 3) return "[depth]";
    if (typeof v === "string") return v.length > 300 ? `${v.slice(0, 300)}…` : v;
    if (typeof v === "number" || typeof v === "boolean" || v === null) return v;
    if (Array.isArray(v)) return v.slice(0, 20).map((x) => clean(x, depth + 1));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k]) => !SECRET.test(k))
          .slice(0, 30)
          .map(([k, x]) => [k, clean(x, depth + 1)]),
      );
    return null;
  };
  return clean(payload, 0) as Prisma.InputJsonValue;
}

export async function recordEvent(
  t: Tx,
  actor: ActorRef,
  applicationId: string,
  eventType: EventType,
  payload: Record<string, unknown> = {},
  attemptId: string | null = null,
) {
  return t.applicationEvent.create({
    data: {
      userId: actor.userId,
      applicationId,
      attemptId,
      eventType,
      payload: sanitizePayload(payload),
    },
  });
}

// --- Reads -----------------------------------------------------------------------------------

export async function listApplications(
  actor: ActorRef,
  opts: { filter?: ApplicationFilter; q?: string | null } = {},
) {
  const statuses = APPLICATION_FILTERS[opts.filter ?? "all"].statuses;
  const q = opts.q?.trim();
  return withUserContext(actor.userId, (t) =>
    t.application.findMany({
      where: {
        userId: actor.userId,
        ...(statuses ? { status: { in: [...statuses] } } : { status: { notIn: ["ARCHIVED"] } }),
        ...(q
          ? {
              OR: [
                { job: { title: { contains: q, mode: "insensitive" } } },
                { company: { name: { contains: q, mode: "insensitive" } } },
                { channel: { provider: { contains: q.toUpperCase() } } },
              ],
            }
          : {}),
      },
      include: {
        job: { select: { id: true, title: true } },
        company: { select: { name: true } },
        channel: { select: { channelType: true, provider: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
}

export async function getApplicationWorkspace(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const application = await t.application.findFirst({
      where: { id, userId: actor.userId },
      include: {
        job: { select: { id: true, title: true, jobUrl: true, deletedAt: true } },
        company: { select: { id: true, name: true } },
        communicationPackage: { select: { id: true, title: true, status: true } },
        channel: true,
        channels: { orderBy: { discoveredAt: "desc" } },
        forms: { where: { status: "CURRENT" }, include: { _count: { select: { fields: true } } } },
        questions: { include: { answers: { where: { isCurrent: true } } } },
        attempts: { orderBy: { attemptNumber: "desc" } },
        submissions: { orderBy: { startedAt: "desc" }, include: { evidence: true } },
        approvals: { orderBy: { approvedAt: "desc" } },
        events: { orderBy: { createdAt: "asc" }, take: 500 },
      },
    });
    if (!application) throw new AppError("NOT_FOUND");
    return application;
  });
}

// --- Status ------------------------------------------------------------------------------------

/**
 * Plain status change through the state machine (preparation, blocking, cancelling, archiving…).
 * Approval, submission and confirmation states are rejected here — they have dedicated paths.
 */
export async function transitionApplication(
  actor: ActorRef,
  id: string,
  to: ApplicationStatus,
  opts: { reason?: string | null; event?: EventType; payload?: Record<string, unknown> } = {},
) {
  if (GATED.includes(to))
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `“${to.toLowerCase().replace(/_/g, " ")}” can only be reached through its own validated step.`,
    });
  return withUserContext(actor.userId, async (t) => {
    const app = await ownedApplication(t, actor, id);
    const from = app.status as ApplicationStatus;
    if (from === to) return app;
    try {
      assertTransition(from, to);
    } catch {
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `An application can't go from ${from.toLowerCase().replace(/_/g, " ")} to ${to.toLowerCase().replace(/_/g, " ")}.`,
      });
    }
    if (to === "BLOCKED" && !opts.reason?.trim())
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "A blocked application needs a reason.",
      });
    const updated = await t.application.update({
      where: { id: app.id },
      data: {
        status: to,
        ...(to === "BLOCKED"
          ? { blockedReason: opts.reason!.trim().slice(0, 1000), readiness: "BLOCKED" }
          : {}),
        ...(to === "ARCHIVED" ? { archivedAt: new Date() } : {}),
      },
    });
    const eventType: EventType =
      opts.event ??
      (to === "BLOCKED"
        ? "BLOCKED"
        : to === "CANCELLED"
          ? "CANCELLED"
          : to === "ARCHIVED"
            ? "ARCHIVED"
            : to === "WITHDRAWN"
              ? "WITHDRAWN"
              : to === "FAILED"
                ? "FAILED"
                : "STATUS_CHANGED");
    await recordEvent(t, actor, app.id, eventType, {
      from,
      to,
      reason: opts.reason ?? undefined,
      ...(opts.payload ?? {}),
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_status_changed",
      resourceType: "application",
      resourceId: app.id,
      metadata: { from, to },
    });
    return updated;
  });
}

export async function setAutomationMode(actor: ActorRef, id: string, mode: AutomationMode) {
  return withUserContext(actor.userId, async (t) => {
    const app = await ownedApplication(t, actor, id);
    if (SUBMISSION_SENSITIVE.includes(app.status as ApplicationStatus))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The automation mode can't change once a submission has started.",
      });
    const updated = await t.application.update({
      where: { id: app.id },
      data: { automationMode: mode },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_policy_changed",
      resourceType: "application",
      resourceId: app.id,
      metadata: { mode },
    });
    return updated;
  });
}

// --- Attempts (worker executions) ----------------------------------------------------------------

export const DEFAULT_LEASE_MS = 5 * 60_000;

/**
 * Starts a controlled execution attempt. At most one active attempt per application (DB unique
 * index) and never after a submission may have happened (no accidental duplicates).
 */
export async function startAttempt(
  actor: ActorRef,
  applicationId: string,
  input: { adapter: string; adapterVersion: string; leaseOwner: string; leaseMs?: number },
) {
  return withUserContext(actor.userId, async (t) => {
    const app = await ownedApplication(t, actor, applicationId);
    if (SUBMISSION_SENSITIVE.includes(app.status as ApplicationStatus))
      throw new AppError("CONFLICT", {
        publicMessage:
          "A submission has already started or may have happened. Resolve it before starting another attempt.",
      });
    const active = await t.applicationAttempt.findFirst({
      where: { applicationId: app.id, status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
    });
    if (active)
      throw new AppError("CONFLICT", {
        publicMessage: "An attempt is already running for this application.",
      });
    const attemptNumber = app.currentAttempt + 1;
    const attempt = await t.applicationAttempt.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        attemptNumber,
        executionId: randomUUID(),
        status: "RUNNING",
        mode: app.automationMode,
        adapter: input.adapter,
        adapterVersion: input.adapterVersion,
        leaseOwner: input.leaseOwner.slice(0, 100),
        leaseExpiresAt: new Date(Date.now() + (input.leaseMs ?? DEFAULT_LEASE_MS)),
      },
    });
    await t.application.update({ where: { id: app.id }, data: { currentAttempt: attemptNumber } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_attempt_started",
      resourceType: "application_attempt",
      resourceId: attempt.id,
      metadata: { applicationId: app.id, attemptNumber, adapter: input.adapter },
    });
    return attempt;
  });
}

/** Extends a lease; fails if another worker holds it or the attempt is no longer active. */
export async function renewLease(
  actor: ActorRef,
  attemptId: string,
  leaseOwner: string,
  leaseMs = DEFAULT_LEASE_MS,
) {
  return withUserContext(actor.userId, async (t) => {
    const { count } = await t.applicationAttempt.updateMany({
      where: {
        id: attemptId,
        userId: actor.userId,
        leaseOwner,
        status: { in: [...ACTIVE_ATTEMPT_STATUSES] },
      },
      data: { leaseExpiresAt: new Date(Date.now() + leaseMs) },
    });
    if (!count)
      throw new AppError("CONFLICT", {
        publicMessage: "This attempt is no longer held by this worker.",
      });
  });
}

export interface AttemptStep {
  step: string;
  status: "done" | "failed" | "waiting" | "skipped";
  detail?: string;
}

export async function updateAttempt(
  actor: ActorRef,
  attemptId: string,
  input: {
    status: AttemptStatus;
    errorCode?: ErrorCode | null;
    errorMessage?: string | null;
    steps?: AttemptStep[];
  },
) {
  return withUserContext(actor.userId, async (t) => {
    const attempt = await t.applicationAttempt.findFirst({
      where: { id: attemptId, userId: actor.userId },
    });
    if (!attempt) throw new AppError("NOT_FOUND");
    if (!(ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(attempt.status))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This attempt has already finished.",
      });
    const finished = !(ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(input.status);
    const steps = (input.steps ?? []).map((s) => ({
      ...s,
      detail: s.detail?.slice(0, 300),
      at: new Date().toISOString(),
    }));
    return t.applicationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: input.status,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage?.slice(0, 1000) ?? null,
        steps: [...((attempt.steps as unknown[]) ?? []), ...steps] as Prisma.InputJsonValue,
        ...(finished ? { completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } : {}),
      },
    });
  });
}

// --- Submission recording (evidence-backed) -------------------------------------------------------

export function submissionFingerprint(
  applicationId: string,
  applicationHash: string,
  attemptNumber: number,
) {
  return createHash("sha256")
    .update(`${applicationId}:${applicationHash}:${attemptNumber}`)
    .digest("hex");
}

/**
 * Opens a submission. Requires READY_TO_SUBMIT with an active approval of the CURRENT application
 * hash; one live submission per application (DB unique index) — a second click cannot resubmit.
 */
export async function beginSubmission(
  actor: ActorRef,
  applicationId: string,
  attemptId: string | null,
) {
  return withUserContext(actor.userId, async (t) => {
    const app = await ownedApplication(t, actor, applicationId);
    if (app.status !== "READY_TO_SUBMIT")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Only an approved application can be submitted.",
      });
    const approval = await t.applicationApproval.findFirst({
      where: { applicationId: app.id, revokedAt: null },
    });
    if (!approval || !app.applicationHash || approval.applicationHash !== app.applicationHash)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage:
          "The approval does not match the current application. Review and approve it again.",
      });
    const live = await t.applicationSubmission.findFirst({
      where: {
        applicationId: app.id,
        status: {
          in: [
            "READY_TO_SEND",
            "SUBMITTING",
            "SENDING",
            "SUBMITTED",
            "SUBMISSION_CONFIRMED",
            "SUBMISSION_UNCERTAIN",
            "SENT",
            "DELIVERY_UNKNOWN",
          ],
        },
      },
    });
    if (live)
      throw new AppError("CONFLICT", {
        publicMessage:
          "A submission for this application already exists. It will not be submitted twice.",
      });
    const channel = app.channelId
      ? await t.applicationChannel.findUnique({ where: { id: app.channelId } })
      : null;
    const submission = await t.applicationSubmission.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        attemptId,
        channelType: channel?.channelType ?? "UNKNOWN",
        status: "SUBMITTING",
        applicationHash: app.applicationHash,
        submissionFingerprint: submissionFingerprint(
          app.id,
          app.applicationHash,
          app.currentAttempt,
        ),
      },
    });
    assertTransition("READY_TO_SUBMIT", "SUBMITTING");
    await t.application.update({ where: { id: app.id }, data: { status: "SUBMITTING" } });
    await recordEvent(
      t,
      actor,
      app.id,
      "SUBMISSION_STARTED",
      { submissionId: submission.id },
      attemptId,
    );
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_submission_started",
      resourceType: "application_submission",
      resourceId: submission.id,
      metadata: { applicationId: app.id },
    });
    return submission;
  });
}

export interface SubmissionEvidenceInput {
  evidenceType: Exclude<EvidenceType, "USER_CONFIRMED">;
  textExcerpt?: string | null;
  storagePath?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Records the observed outcome of a submission.
 *  SUBMITTED  — requires at least one piece of confirming evidence (page, id, message, API success)
 *  UNCERTAIN  — the result could not be determined: stops; never retried automatically
 *  FAILED     — with an error code; the approved package is preserved
 */
export async function recordSubmissionOutcome(
  actor: ActorRef,
  submissionId: string,
  outcome:
    | {
        result: "SUBMITTED";
        confirmationSource: Exclude<ConfirmationSource, "USER_CONFIRMED">;
        evidence: SubmissionEvidenceInput[];
        externalApplicationId?: string | null;
        confirmationUrl?: string | null;
        confirmationText?: string | null;
      }
    | { result: "UNCERTAIN"; reason: string }
    | { result: "FAILED"; errorCode: ErrorCode; reason: string },
) {
  return withUserContext(actor.userId, async (t) => {
    const sub = await t.applicationSubmission.findFirst({
      where: { id: submissionId, userId: actor.userId },
    });
    if (!sub) throw new AppError("NOT_FOUND");
    if (sub.status !== "SUBMITTING")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This submission already has a recorded outcome.",
      });
    const app = await ownedApplication(t, actor, sub.applicationId);
    if (outcome.result === "SUBMITTED") {
      const confirming = outcome.evidence.filter(
        (e) =>
          e.evidenceType !== "SCREENSHOT" &&
          e.evidenceType !== "FAILURE_STATE" &&
          e.evidenceType !== "REVIEW_STATE",
      );
      if (!confirming.length)
        throw new AppError("VALIDATION_ERROR", {
          publicMessage:
            "A submission can only be recorded as successful with confirming evidence.",
        });
      const now = new Date();
      for (const e of outcome.evidence)
        await t.applicationEvidence.create({
          data: {
            userId: actor.userId,
            applicationId: app.id,
            submissionId: sub.id,
            attemptId: sub.attemptId,
            evidenceType: e.evidenceType,
            source: "AUTOMATED",
            storagePath: e.storagePath ?? null,
            textExcerpt: e.textExcerpt?.slice(0, 2000) ?? null,
            metadata: sanitizePayload(e.metadata),
          },
        });
      await t.applicationSubmission.update({
        where: { id: sub.id },
        data: {
          status: "SUBMITTED",
          submittedAt: now,
          confirmationSource: outcome.confirmationSource,
          externalApplicationId: outcome.externalApplicationId ?? null,
          confirmationUrl: outcome.confirmationUrl ?? null,
          confirmationText: outcome.confirmationText?.slice(0, 2000) ?? null,
        },
      });
      await t.application.update({
        where: { id: app.id },
        data: {
          status: "SUBMITTED",
          submittedAt: now,
          confirmationSource: outcome.confirmationSource,
          externalApplicationId: outcome.externalApplicationId ?? null,
          confirmationUrl: outcome.confirmationUrl ?? null,
        },
      });
      await recordEvent(
        t,
        actor,
        app.id,
        "SUBMITTED",
        {
          submissionId: sub.id,
          confirmationSource: outcome.confirmationSource,
          externalApplicationId: outcome.externalApplicationId ?? undefined,
        },
        sub.attemptId,
      );
      await recordAudit(t, {
        userId: actor.userId,
        action: "application_submitted",
        resourceType: "application_submission",
        resourceId: sub.id,
        metadata: { applicationId: app.id, confirmationSource: outcome.confirmationSource },
      });
      return;
    }
    if (outcome.result === "UNCERTAIN") {
      await t.applicationSubmission.update({
        where: { id: sub.id },
        data: { status: "SUBMISSION_UNCERTAIN", errorCode: "UNKNOWN_RESULT" },
      });
      await t.application.update({
        where: { id: app.id },
        data: { status: "SUBMISSION_UNCERTAIN" },
      });
      await recordEvent(
        t,
        actor,
        app.id,
        "SUBMISSION_UNCERTAIN",
        { submissionId: sub.id, reason: outcome.reason },
        sub.attemptId,
      );
      await recordAudit(t, {
        userId: actor.userId,
        action: "application_submission_uncertain",
        resourceType: "application_submission",
        resourceId: sub.id,
        metadata: { applicationId: app.id },
      });
      return;
    }
    await t.applicationSubmission.update({
      where: { id: sub.id },
      data: { status: "FAILED", errorCode: outcome.errorCode },
    });
    await t.application.update({ where: { id: app.id }, data: { status: "FAILED" } });
    await recordEvent(
      t,
      actor,
      app.id,
      "FAILED",
      { submissionId: sub.id, errorCode: outcome.errorCode, reason: outcome.reason },
      sub.attemptId,
    );
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_submission_failed",
      resourceType: "application_submission",
      resourceId: sub.id,
      metadata: { applicationId: app.id, errorCode: outcome.errorCode },
    });
  });
}

/**
 * The candidate confirms (after checking the ATS or their inbox) that an uncertain submission went
 * through — recorded as USER_CONFIRMED, never as automatic verification. Or that it did not.
 */
export async function resolveUncertainSubmission(
  actor: ActorRef,
  applicationId: string,
  input: { submitted: boolean; note?: string | null; externalApplicationId?: string | null },
) {
  return withUserContext(actor.userId, async (t) => {
    const app = await ownedApplication(t, actor, applicationId);
    if (app.status !== "SUBMISSION_UNCERTAIN")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Only an uncertain submission can be resolved.",
      });
    const sub = await t.applicationSubmission.findFirst({
      where: { applicationId: app.id, status: "SUBMISSION_UNCERTAIN" },
      orderBy: { startedAt: "desc" },
    });
    if (!sub) throw new AppError("NOT_FOUND");
    if (!input.submitted) {
      await t.applicationSubmission.update({
        where: { id: sub.id },
        data: { status: "FAILED", errorCode: "UNKNOWN_RESULT" },
      });
      await t.application.update({ where: { id: app.id }, data: { status: "FAILED" } });
      await recordEvent(t, actor, app.id, "FAILED", {
        submissionId: sub.id,
        resolvedBy: "USER",
        submitted: false,
      });
      return;
    }
    const now = new Date();
    await t.applicationEvidence.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        submissionId: sub.id,
        evidenceType: "USER_CONFIRMED",
        source: "USER",
        textExcerpt: input.note?.slice(0, 2000) ?? null,
      },
    });
    await t.applicationSubmission.update({
      where: { id: sub.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        confirmationSource: "USER_CONFIRMED",
        externalApplicationId: input.externalApplicationId ?? null,
      },
    });
    await t.application.update({
      where: { id: app.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        confirmationSource: "USER_CONFIRMED",
        externalApplicationId: input.externalApplicationId ?? null,
      },
    });
    await recordEvent(t, actor, app.id, "USER_CONFIRMED", { submissionId: sub.id });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_user_confirmed",
      resourceType: "application",
      resourceId: app.id,
      metadata: { submissionId: sub.id },
    });
  });
}

export { canTransition };
