import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { getServerEnv } from "@/config/env";
import { parseCommunicationDocument, toPlainText } from "@/modules/communications/document";
import { isAllowed, parseRobots } from "@/modules/research/fetch/robots";
import { fetchPublicPage, ResearchFetchError } from "@/modules/research/fetch/safe-fetch";
import { recordAudit } from "@/server/audit";
import {
  NavigationBlockedError,
  type BrowserSession,
  type FillInstruction,
  type SessionOptions,
} from "@/server/browser/session";
import type { DomField, DomSnapshot } from "@/server/browser/dom";
import { getDb, withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getStorage } from "@/server/storage";
import { ADAPTERS, selectAdapter, type AdapterDefinition, type InspectedField } from "./adapters";
import {
  beginSubmission,
  recordEvent,
  recordSubmissionOutcome,
  sanitizePayload,
  type ActorRef,
  type SubmissionEvidenceInput,
} from "./application.service";
import { materializeFiles, resolveApplicationFiles } from "./files.service";
import { formFingerprint } from "./hash";
import { getReview } from "./review.service";
import { MANUAL_CONFIRM_FROM, SUBMISSION_SENSITIVE } from "./state-machine";
import {
  ACTIVE_ATTEMPT_STATUSES,
  type ApplicationStatus,
  type AttemptPhase,
  type ControlCommand,
  type ErrorCode,
  type FieldType,
} from "./types";

/**
 * Application execution (Phase 8, checkpoints 8–11): the queue, the browser worker, submission,
 * the email payload and the manual fallback.
 *
 *  - The UI only enqueues attempts and sends control commands (PAUSE / RESUME / STOP / submit);
 *    the worker (`npm run worker:applications`) claims QUEUED attempts with a lease and drives an
 *    isolated browser. Nothing here runs a browser inside a web request.
 *  - HUMAN_APPROVAL (default): after approval the worker fills the form and WAITS before submit;
 *    the candidate submits from JOBHUNT (or in the visible browser, which the worker observes).
 *  - CAPTCHA / sign-in / 2FA / anti-bot pages stop automation and hand the step to the human.
 *  - Success is only recorded with confirming evidence; an unknown result is SUBMISSION_UNCERTAIN
 *    and is never retried automatically. An expired lease during submission → UNCERTAIN.
 */

const log = logger.child({ module: "application-worker" });
const EVIDENCE_DAYS = 180;

// --- Queue ------------------------------------------------------------------------------------------

function automationEnabled() {
  return getServerEnv().APPLICATION_AUTOMATION_ENABLED;
}

/**
 * Queues a worker attempt. INSPECT is read-only; FILL / FILL_AND_SUBMIT need an approved
 * application whose approval matches the current state, and never run in MANUAL_ONLY mode.
 */
export async function enqueueAttempt(actor: ActorRef, applicationId: string, phase: AttemptPhase) {
  if (!automationEnabled())
    throw new AppError("VALIDATION_ERROR", {
      publicMessage:
        "Browser automation is turned off (APPLICATION_AUTOMATION_ENABLED). Use the manual checklist, or enable it and start the worker.",
    });
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
    });
    if (!app) throw new AppError("NOT_FOUND");
    const status = app.status as ApplicationStatus;
    if (SUBMISSION_SENSITIVE.includes(status))
      throw new AppError("CONFLICT", {
        publicMessage:
          "A submission has started or may have happened. Resolve it first — it will not be submitted twice.",
      });
    const channel = app.channelId
      ? await t.applicationChannel.findUnique({ where: { id: app.channelId } })
      : null;
    if (!channel?.url)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Resolve the application channel (a form URL) first.",
      });
    const adapter = selectAdapter(channel, getServerEnv().APPLICATION_FIXTURE_ORIGIN);
    if (!adapter.usesBrowser)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `${adapter.label} applications don't use the browser worker.`,
      });
    let effective: AttemptPhase = phase;
    if (phase !== "INSPECT") {
      if (app.automationMode === "MANUAL_ONLY")
        throw new AppError("VALIDATION_ERROR", {
          publicMessage:
            "This application is manual-only. Use the checklist, or change the automation mode.",
        });
      if (status !== "READY_TO_SUBMIT")
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: "Approve the application before it is filled.",
        });
      const approval = await t.applicationApproval.findFirst({
        where: { applicationId: app.id, revokedAt: null },
      });
      if (!approval || approval.applicationHash !== app.applicationHash)
        throw new AppError("VALIDATION_ERROR", {
          publicMessage:
            "The approval doesn't match the current application. Review and approve it again.",
        });
      // The mode decides whether the worker may click submit itself after filling.
      effective = app.automationMode === "AUTO_FILL_REVIEW_SUBMIT" ? "FILL_AND_SUBMIT" : "FILL";
      if (effective === "FILL_AND_SUBMIT") {
        // With the EXACT threshold, any value below EXACT confidence makes the worker pause before submit.
        const settings = await t.applicationSettings.findUnique({
          where: { userId: actor.userId },
        });
        if ((settings?.autoFillMinConfidence ?? "HIGH") === "EXACT") {
          const weak = await t.applicationFieldMapping.count({
            where: {
              userId: actor.userId,
              isCurrent: true,
              confidence: { not: "EXACT" },
              status: "MAPPED",
              field: { form: { applicationId: app.id, status: "CURRENT" } },
            },
          });
          if (weak) effective = "FILL";
        }
      }
    }
    const active = await t.applicationAttempt.findFirst({
      where: { applicationId: app.id, status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
    });
    if (active)
      throw new AppError("CONFLICT", {
        publicMessage: "An attempt is already queued or running for this application.",
      });
    const attemptNumber = app.currentAttempt + 1;
    const attempt = await t.applicationAttempt.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        attemptNumber,
        executionId: randomUUID(),
        status: "QUEUED",
        phase: effective,
        mode: app.automationMode,
        adapter: adapter.id,
        adapterVersion: adapter.version,
      },
    });
    await t.application.update({ where: { id: app.id }, data: { currentAttempt: attemptNumber } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_attempt_started",
      resourceType: "application_attempt",
      resourceId: attempt.id,
      metadata: { applicationId: app.id, attemptNumber, adapter: adapter.id, phase: effective },
    });
    return attempt;
  });
}

/** PAUSE / RESUME / STOP from the UI; obeyed by the worker between steps. */
export async function setControlCommand(
  actor: ActorRef,
  attemptId: string,
  command: Exclude<ControlCommand, "NONE">,
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
    if (attempt.status === "QUEUED" && command === "STOP") {
      await t.applicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: "CANCELLED",
          completedAt: new Date(),
          errorCode: "CANCELLED",
          errorMessage: "Stopped before it started.",
        },
      });
    } else {
      await t.applicationAttempt.update({
        where: { id: attempt.id },
        data: { controlCommand: command },
      });
    }
    const event = command === "PAUSE" ? "PAUSED" : command === "RESUME" ? "RESUMED" : "STOPPED";
    await recordEvent(t, actor, attempt.applicationId, event, { by: "USER" }, attempt.id);
    await recordAudit(t, {
      userId: actor.userId,
      action:
        command === "PAUSE"
          ? "application_paused"
          : command === "RESUME"
            ? "application_resumed"
            : "application_stopped",
      resourceType: "application_attempt",
      resourceId: attempt.id,
      metadata: {},
    });
  });
}

/**
 * HUMAN_APPROVAL: the candidate reviewed the filled form and asks the waiting worker to submit.
 * Only valid while the attempt waits at the pre-submit checkpoint of an approved application.
 */
export async function requestSubmit(actor: ActorRef, applicationId: string) {
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
    });
    if (!app) throw new AppError("NOT_FOUND");
    if (app.status !== "READY_TO_SUBMIT")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Only an approved application can be submitted.",
      });
    const attempt = await t.applicationAttempt.findFirst({
      where: { applicationId: app.id, status: "NEEDS_HUMAN_INPUT", phase: "FILL" },
    });
    if (!attempt)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "No filled form is waiting for your submit decision.",
      });
    await t.applicationAttempt.update({
      where: { id: attempt.id },
      data: { phase: "SUBMIT", controlCommand: "RESUME" },
    });
    await recordEvent(t, actor, app.id, "RESUMED", { by: "USER", action: "submit" }, attempt.id);
  });
}

/** Atomically claims the oldest queued attempt (owner connection; the run itself is user-scoped). */
export async function claimNextAttempt(workerId: string, leaseMs = 5 * 60_000) {
  const rows = await getDb().$queryRaw<{ id: string; user_id: string }[]>`
    UPDATE "application_attempts" SET "status" = 'RUNNING', "lease_owner" = ${workerId.slice(0, 100)},
      "lease_expires_at" = now() + (${leaseMs}::int * interval '1 millisecond'), "heartbeat_at" = now(), "started_at" = now(), "updated_at" = now()
    WHERE "id" = (
      SELECT "id" FROM "application_attempts" WHERE "status" = 'QUEUED' ORDER BY "created_at" LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "user_id"`;
  return rows[0] ? { attemptId: rows[0].id, userId: rows[0].user_id } : null;
}

/**
 * Recovers attempts whose worker died (lease expired). A browser session can't be resumed: the
 * attempt fails with SESSION_EXPIRED — except during submission, which becomes UNCERTAIN.
 */
export async function recoverExpiredAttempts() {
  const stale = await getDb().applicationAttempt.findMany({
    where: {
      status: { in: ["RUNNING", "PAUSED", "NEEDS_HUMAN_INPUT"] },
      leaseExpiresAt: { lt: new Date() },
    },
    select: { id: true, userId: true, applicationId: true },
    take: 50,
  });
  for (const a of stale) {
    const actor = { userId: a.userId };
    const sub = await withUserContext(a.userId, (t) =>
      t.applicationSubmission.findFirst({
        where: { applicationId: a.applicationId, attemptId: a.id, status: "SUBMITTING" },
      }),
    );
    if (sub)
      await recordSubmissionOutcome(actor, sub.id, {
        result: "UNCERTAIN",
        reason: "The worker stopped during submission.",
      }).catch(() => undefined);
    await finishAttempt(
      actor,
      a.id,
      sub ? "UNCERTAIN" : "FAILED",
      sub ? "UNKNOWN_RESULT" : "SESSION_EXPIRED",
      sub
        ? "The worker stopped during submission — check the ATS or your inbox."
        : "The worker stopped; the browser session was lost. Start a new attempt.",
    ).catch(() => undefined);
  }
  return stale.length;
}

// --- Attempt state helpers -------------------------------------------------------------------------

type Step = { step: string; status: "done" | "failed" | "waiting" | "skipped"; detail?: string };

async function patchAttempt(
  actor: ActorRef,
  attemptId: string,
  data: {
    status?: string;
    humanAction?: string | null;
    step?: Step;
    controlCommand?: ControlCommand;
    leaseMs?: number;
  },
) {
  return withUserContext(actor.userId, async (t) => {
    const a = await t.applicationAttempt.findFirstOrThrow({
      where: { id: attemptId, userId: actor.userId },
    });
    const steps = data.step
      ? [
          ...((a.steps as unknown[]) ?? []),
          { ...data.step, detail: data.step.detail?.slice(0, 300), at: new Date().toISOString() },
        ].slice(-200)
      : undefined;
    return t.applicationAttempt.update({
      where: { id: a.id },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.humanAction !== undefined
          ? { humanAction: data.humanAction?.slice(0, 500) ?? null }
          : {}),
        ...(data.controlCommand ? { controlCommand: data.controlCommand } : {}),
        ...(steps ? { steps: steps as Prisma.InputJsonValue } : {}),
        heartbeatAt: new Date(),
        ...(data.leaseMs ? { leaseExpiresAt: new Date(Date.now() + data.leaseMs) } : {}),
      },
    });
  });
}

async function finishAttempt(
  actor: ActorRef,
  attemptId: string,
  status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNCERTAIN",
  errorCode: ErrorCode | null,
  message: string | null,
) {
  await withUserContext(actor.userId, async (t) => {
    const a = await t.applicationAttempt.findFirst({
      where: { id: attemptId, userId: actor.userId },
    });
    if (!a || !(ACTIVE_ATTEMPT_STATUSES as readonly string[]).includes(a.status)) return;
    await t.applicationAttempt.update({
      where: { id: a.id },
      data: {
        status,
        errorCode,
        errorMessage: message?.slice(0, 1000) ?? null,
        humanAction: null,
        completedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        steps: [
          ...((a.steps as unknown[]) ?? []),
          {
            step: "finish",
            status: status === "SUCCEEDED" ? "done" : "failed",
            detail: (message ?? status).slice(0, 300),
            at: new Date().toISOString(),
          },
        ] as Prisma.InputJsonValue,
      },
    });
    if (status === "FAILED" && errorCode)
      await recordEvent(
        t,
        actor,
        a.applicationId,
        "FAILED",
        { attempt: a.attemptNumber, errorCode, reason: message?.slice(0, 200) },
        a.id,
      );
  });
}

/** Moves the application to NEEDS_HUMAN_INPUT (barriers) when the state machine allows it. */
async function applicationNeedsHuman(
  actor: ActorRef,
  applicationId: string,
  reason: string,
  attemptId: string,
) {
  await withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirstOrThrow({
      where: { id: applicationId, userId: actor.userId },
    });
    if (["DRAFT", "IN_PROGRESS", "READY", "READY_TO_SUBMIT"].includes(app.status))
      await t.application.update({
        where: { id: app.id },
        data: { status: "NEEDS_HUMAN_INPUT", blockedReason: reason.slice(0, 1000) },
      });
    await recordEvent(
      t,
      actor,
      app.id,
      "WAITING_FOR_USER",
      { reason: reason.slice(0, 200) },
      attemptId,
    );
  });
}

async function storeScreenshot(
  actor: ActorRef,
  applicationId: string,
  attemptId: string,
  label: string,
  png: Buffer,
  submissionId: string | null,
  evidenceType: "SCREENSHOT" | "REVIEW_STATE" | "FAILURE_STATE",
) {
  const path = `${actor.userId}/applications/${applicationId}/${attemptId}-${label}-${Date.now()}.png`;
  await getStorage().put(path, png, "image/png");
  await withUserContext(actor.userId, (t) =>
    t.applicationEvidence.create({
      data: {
        userId: actor.userId,
        applicationId,
        attemptId,
        submissionId,
        evidenceType,
        source: "AUTOMATED",
        storagePath: path,
        metadata: sanitizePayload({ label, bytes: png.length }),
        expiresAt: new Date(Date.now() + EVIDENCE_DAYS * 86_400_000),
      },
    }),
  );
  return path;
}

// --- Robots.txt (real, non-test sites) ---------------------------------------------------------------

export async function robotsAllows(url: string): Promise<boolean> {
  const u = new URL(url);
  try {
    const page = await fetchPublicPage(`${u.origin}/robots.txt`, {
      accept: "text",
      timeoutMs: 10_000,
      maxBytes: 500_000,
    });
    return isAllowed(parseRobots(page.body, "jobhunt-os"), `${u.pathname}${u.search}`);
  } catch (error) {
    if (
      error instanceof ResearchFetchError &&
      ["NOT_FOUND", "HTTP_CLIENT", "UNSUPPORTED_TYPE"].includes(error.kind)
    )
      return true;
    return false; // server/network errors: conservatively disallowed (RFC 9309)
  }
}

// --- Running an attempt (worker) ------------------------------------------------------------------------

export interface WorkerDeps {
  createSession: (options: SessionOptions) => BrowserSession;
  /** Test hook: skip the robots.txt check (only ever for the local fixture). */
  skipRobots?: boolean;
  pollMs?: number;
}

function toInspected(snapshot: DomSnapshot): InspectedField[] {
  return snapshot.fields.map((f) => ({
    externalFieldId: f.externalFieldId,
    selector: f.selector,
    label: f.label,
    fieldType: f.fieldType as FieldType,
    required: f.required,
    options: f.options,
    optionValues: f.optionValues,
    maxLength: f.maxLength,
    pageUrl: snapshot.url,
  }));
}

function barrierOf(snapshot: DomSnapshot): { code: ErrorCode; action: string } | null {
  const b = snapshot.barriers;
  if (b.captcha)
    return {
      code: "CAPTCHA_REQUIRED",
      action: "The site shows a CAPTCHA. Complete it yourself — JOBHUNT OS never solves CAPTCHAs.",
    };
  if (b.twoFactor)
    return {
      code: "TWO_FACTOR_REQUIRED",
      action: "The site asks for a verification code. Complete it yourself.",
    };
  if (b.login)
    return {
      code: "AUTHENTICATION_REQUIRED",
      action:
        "The site requires signing in. Sign in yourself — JOBHUNT OS never stores or enters passwords.",
    };
  if (b.antiBot)
    return {
      code: "ANTI_BOT_BLOCKED",
      action: "The site blocked automated access. Apply manually with the checklist.",
    };
  return null;
}

function fillKind(fieldType: string, dom: DomField): FillInstruction["kind"] {
  if (fieldType === "FILE") return "file";
  if (dom.control === "select") return "select";
  if (dom.control === "group") return dom.fieldType === "MULTISELECT" ? "multi" : "choice";
  if (fieldType === "CHECKBOX") return "checkbox";
  return "text";
}

interface RunContext {
  actor: ActorRef;
  attemptId: string;
  applicationId: string;
  phase: AttemptPhase;
  adapter: AdapterDefinition;
  url: string;
  pollMs: number;
  deadline: number;
}

async function readControl(ctx: RunContext) {
  return withUserContext(ctx.actor.userId, (t) =>
    t.applicationAttempt.findFirstOrThrow({
      where: { id: ctx.attemptId },
      select: { controlCommand: true, phase: true, status: true },
    }),
  );
}

/** Between steps: honours PAUSE (waits) and STOP. Returns false when the run must stop. */
async function checkpoint(ctx: RunContext): Promise<boolean> {
  let c = await readControl(ctx);
  if (c.controlCommand === "STOP") return false;
  if (c.controlCommand !== "PAUSE") return true;
  await patchAttempt(ctx.actor, ctx.attemptId, {
    status: "PAUSED",
    step: { step: "pause", status: "waiting", detail: "Paused by you." },
  });
  while (Date.now() < ctx.deadline) {
    await new Promise((r) => setTimeout(r, ctx.pollMs));
    c = await readControl(ctx);
    await patchAttempt(ctx.actor, ctx.attemptId, { leaseMs: 5 * 60_000 });
    if (c.controlCommand === "STOP") return false;
    if (c.controlCommand === "RESUME" || c.controlCommand === "NONE") {
      await patchAttempt(ctx.actor, ctx.attemptId, {
        status: "RUNNING",
        controlCommand: "NONE",
        step: { step: "resume", status: "done" },
      });
      return true;
    }
  }
  return false;
}

/**
 * Runs one claimed attempt end to end. Every exit path finishes the attempt; a submission that
 * may have happened is recorded as UNCERTAIN, never retried.
 */
export async function runAttempt(claim: { attemptId: string; userId: string }, deps: WorkerDeps) {
  const env = getServerEnv();
  const actor = { userId: claim.userId };
  const attempt = await withUserContext(actor.userId, (t) =>
    t.applicationAttempt.findFirstOrThrow({
      where: { id: claim.attemptId, userId: actor.userId },
      include: { application: { include: { channel: true } } },
    }),
  );
  const app = attempt.application;
  const adapter = ADAPTERS[attempt.adapter as keyof typeof ADAPTERS];
  const url = app.channel?.url;
  if (!adapter || !url)
    return finishAttempt(
      actor,
      attempt.id,
      "FAILED",
      "VALIDATION_FAILED",
      "No application form URL.",
    );
  const ctx: RunContext = {
    actor,
    attemptId: attempt.id,
    applicationId: app.id,
    phase: attempt.phase as AttemptPhase,
    adapter,
    url,
    pollMs: deps.pollMs ?? 1500,
    deadline: Date.now() + env.APPLICATION_WORKER_TIMEOUT_MS,
  };
  const trustedOrigins =
    adapter.isTest && env.APPLICATION_FIXTURE_ORIGIN
      ? [new URL(env.APPLICATION_FIXTURE_ORIGIN).origin]
      : [];
  if (adapter.isTest && !trustedOrigins.includes(new URL(url).origin))
    return finishAttempt(
      actor,
      attempt.id,
      "FAILED",
      "UNSAFE_URL",
      "The test adapter only runs against the configured fixture.",
    );

  if (!adapter.isTest && !deps.skipRobots && !(await robotsAllows(url))) {
    await applicationNeedsHuman(
      actor,
      app.id,
      "The site's robots.txt disallows automated access to this page — apply manually.",
      attempt.id,
    );
    return finishAttempt(
      actor,
      attempt.id,
      "FAILED",
      "VALIDATION_FAILED",
      "robots.txt disallows automated access to this page. Use the manual checklist.",
    );
  }

  const session = deps.createSession({
    channel: env.APPLICATION_BROWSER_CHANNEL,
    headless: env.APPLICATION_BROWSER_HEADLESS,
    stepTimeoutMs: env.APPLICATION_STEP_TIMEOUT_MS,
    policy: { trustedOrigins },
  });
  let cleanup: (() => Promise<void>) | null = null;
  let submissionId: string | null = null;
  const heartbeat = setInterval(
    () => void patchAttempt(actor, attempt.id, { leaseMs: 5 * 60_000 }).catch(() => undefined),
    60_000,
  );
  try {
    await session.start();
    await patchAttempt(actor, attempt.id, {
      step: { step: "open", status: "done", detail: new URL(url).host },
    });
    const opened = await session.open(url);
    await withUserContext(actor.userId, (t) =>
      recordEvent(
        t,
        actor,
        app.id,
        "FORM_OPENED",
        { host: new URL(opened.url).host, status: opened.status ?? undefined },
        attempt.id,
      ),
    );
    if (opened.status === 404 || opened.status === 410)
      return await finishAttempt(
        actor,
        attempt.id,
        "FAILED",
        "JOB_CLOSED",
        "The application page no longer exists — the job may be closed.",
      );
    if (opened.status === 429)
      return await finishAttempt(
        actor,
        attempt.id,
        "FAILED",
        "RATE_LIMITED",
        "The site is rate limiting. Try again later — JOBHUNT OS does not retry around limits.",
      );

    let snapshot = await session.snapshot();
    let barrier = barrierOf(snapshot);
    if (opened.status === 401 || opened.status === 403)
      barrier ??= {
        code: "ANTI_BOT_BLOCKED",
        action: "The site refused access. Apply manually with the checklist.",
      };
    // A CAPTCHA on the form itself doesn't prevent READING the public form (inspection), and in a
    // visible window the worker may fill the fields — but the CAPTCHA and the submit click are always
    // left to the human. Headless automation can't hand over, so it stops.
    const captchaOnForm = barrier?.code === "CAPTCHA_REQUIRED" && snapshot.fields.length > 0;
    if (captchaOnForm && (ctx.phase === "INSPECT" || !env.APPLICATION_BROWSER_HEADLESS))
      barrier = null;
    if (barrier) {
      // Headed: the human can clear the barrier in the visible window; the worker waits and re-checks.
      if (env.APPLICATION_BROWSER_HEADLESS || barrier.code === "ANTI_BOT_BLOCKED") {
        await storeScreenshot(
          actor,
          app.id,
          attempt.id,
          "barrier",
          await session.screenshot(),
          null,
          "FAILURE_STATE",
        ).catch(() => undefined);
        await applicationNeedsHuman(actor, app.id, barrier.action, attempt.id);
        return await finishAttempt(actor, attempt.id, "FAILED", barrier.code, barrier.action);
      }
      await patchAttempt(actor, attempt.id, {
        status: "NEEDS_HUMAN_INPUT",
        humanAction: barrier.action,
        step: { step: "barrier", status: "waiting", detail: barrier.code },
      });
      while (barrier && Date.now() < ctx.deadline) {
        await new Promise((r) => setTimeout(r, ctx.pollMs));
        if ((await readControl(ctx)).controlCommand === "STOP")
          return await finishAttempt(
            actor,
            attempt.id,
            "CANCELLED",
            "CANCELLED",
            "Stopped by you.",
          );
        snapshot = await session.snapshot();
        barrier = barrierOf(snapshot);
      }
      if (barrier) {
        await applicationNeedsHuman(actor, app.id, barrier.action, attempt.id);
        return await finishAttempt(
          actor,
          attempt.id,
          "FAILED",
          "TIMEOUT",
          "The step needing you was not completed in time.",
        );
      }
      await patchAttempt(actor, attempt.id, {
        status: "RUNNING",
        humanAction: null,
        step: { step: "barrier", status: "done", detail: "Cleared by you." },
      });
    }

    const { recordInspection } = await import("./prepare.service");
    const live = toInspected(snapshot);
    if (ctx.phase === "INSPECT") {
      if (!live.length)
        return await finishAttempt(
          actor,
          attempt.id,
          "FAILED",
          "FORM_FIELD_NOT_FOUND",
          "No application form fields were found on the page.",
        );
      await recordInspection(actor, app.id, adapter, {
        url: snapshot.url,
        source: adapter.isTest ? "FIXTURE" : "BROWSER",
        fields: live,
        deadlineAt: null,
        notes: captchaOnForm
          ? ["The form uses a CAPTCHA: it must be completed and submitted by you."]
          : [],
      });
      await patchAttempt(actor, attempt.id, {
        step: {
          step: "inspect",
          status: "done",
          detail: `${live.length} fields${captchaOnForm ? " · CAPTCHA on the form" : ""}`,
        },
      });
      return await finishAttempt(
        actor,
        attempt.id,
        "SUCCEEDED",
        null,
        captchaOnForm
          ? `Inspected ${live.length} fields. The form uses a CAPTCHA — automatic submission isn't possible; you complete the CAPTCHA and submit (visible browser or manual checklist).`
          : `Inspected ${live.length} fields.`,
      );
    }

    // --- FILL: the live form must still be the approved form -----------------------------------------
    const current = await withUserContext(actor.userId, (t) =>
      t.applicationForm.findFirst({ where: { applicationId: app.id, status: "CURRENT" } }),
    );
    const liveFp = formFingerprint(
      snapshot.url,
      live.map((f) => ({
        externalFieldId: f.externalFieldId,
        label: f.label,
        fieldType: f.fieldType,
        required: f.required,
        options: f.options,
      })),
    );
    if (!current || current.formFingerprint !== liveFp) {
      await recordInspection(actor, app.id, adapter, {
        url: snapshot.url,
        source: adapter.isTest ? "FIXTURE" : "BROWSER",
        fields: live,
        deadlineAt: null,
        notes: ["re-inspected before filling"],
      });
      const still = await withUserContext(actor.userId, async (t) => {
        const a = await t.application.findFirstOrThrow({ where: { id: app.id } });
        const approval = await t.applicationApproval.findFirst({
          where: { applicationId: app.id, revokedAt: null },
        });
        return (
          a.status === "READY_TO_SUBMIT" &&
          approval &&
          approval.applicationHash === a.applicationHash
        );
      });
      if (!still)
        return await finishAttempt(
          actor,
          attempt.id,
          "FAILED",
          "FORM_CHANGED",
          "The application form changed since you approved it. Review the new form and approve again.",
        );
    }
    const review = await getReview(actor, app.id);
    const approval = review.approval;
    if (
      !approval ||
      approval.applicationHash !== review.evaluation.hash ||
      review.app.status !== "READY_TO_SUBMIT"
    )
      return await finishAttempt(
        actor,
        attempt.id,
        "FAILED",
        "VALIDATION_FAILED",
        "The application changed since approval. Review and approve it again.",
      );

    const files = await resolveApplicationFiles(actor, app.id);
    const materialized = await materializeFiles(actor, files);
    cleanup = materialized.cleanup;
    await withUserContext(actor.userId, (t) =>
      recordEvent(
        t,
        actor,
        app.id,
        "AUTOFILL_STARTED",
        { fields: review.form?.fields.length ?? 0 },
        attempt.id,
      ),
    );
    await withUserContext(actor.userId, (t) =>
      recordAudit(t, {
        userId: actor.userId,
        action: "application_autofill_started",
        resourceType: "application_attempt",
        resourceId: attempt.id,
        metadata: {},
      }),
    );
    const answers = new Map(
      review.questions
        .filter((q) => q.fieldId && q.answers[0]?.approvalStatus === "APPROVED")
        .map((q) => [q.fieldId!, q.answers[0]!.answerText]),
    );
    let filled = 0;
    for (const field of review.form?.fields ?? []) {
      if (!(await checkpoint(ctx)))
        return await finishAttempt(actor, attempt.id, "CANCELLED", "CANCELLED", "Stopped by you.");
      const m = field.mappings[0];
      const dom = snapshot.fields.find((f) => f.externalFieldId === field.externalFieldId);
      let value: unknown = null;
      let filePath: string | undefined;
      if (m?.mappingType === "GENERATED_ANSWER") value = answers.get(field.id) ?? null;
      else if (field.fieldType === "FILE") {
        const role =
          m?.mappingType === "RESUME"
            ? "RESUME"
            : m?.mappingType === "COVER_LETTER"
              ? "COVER_LETTER"
              : null;
        filePath = role ? materialized.paths.get(role) : undefined;
        value = filePath ? true : null;
      } else if (m && ["MAPPED", "CONFIRMED", "OVERRIDDEN"].includes(m.status)) value = m.value;
      if (value === null || value === undefined || value === "") {
        if (field.required)
          return await finishAttempt(
            actor,
            attempt.id,
            "FAILED",
            "VALIDATION_FAILED",
            `“${field.label.slice(0, 80)}” has no approved value.`,
          );
        continue;
      }
      if (!dom) {
        if (field.required)
          return await finishAttempt(
            actor,
            attempt.id,
            "FAILED",
            "FORM_FIELD_NOT_FOUND",
            `“${field.label.slice(0, 80)}” was not found on the page.`,
          );
        continue;
      }
      const kind = fillKind(field.fieldType, dom);
      const result = await session.fill({
        field: dom,
        kind,
        value: value as string | string[] | boolean,
        filePath,
      });
      if (!result.ok) {
        const code: ErrorCode = kind === "file" ? "FILE_UPLOAD_FAILED" : "FORM_FIELD_NOT_FOUND";
        await storeScreenshot(
          actor,
          app.id,
          attempt.id,
          "fill-failed",
          await session.screenshot(),
          null,
          "FAILURE_STATE",
        ).catch(() => undefined);
        return await finishAttempt(
          actor,
          attempt.id,
          "FAILED",
          code,
          `Could not fill “${field.label.slice(0, 80)}”: ${result.detail ?? "unknown"}`,
        );
      }
      filled++;
      await patchAttempt(actor, attempt.id, {
        step: { step: "fill", status: "done", detail: field.label.slice(0, 80) },
      });
    }
    // Re-check barriers that may appear after filling (e.g. an invisible CAPTCHA turning visible).
    const after = barrierOf(await session.snapshot());
    if (after && !(captchaOnForm && after.code === "CAPTCHA_REQUIRED")) {
      await applicationNeedsHuman(actor, app.id, after.action, attempt.id);
      return await finishAttempt(actor, attempt.id, "FAILED", after.code, after.action);
    }
    await storeScreenshot(
      actor,
      app.id,
      attempt.id,
      "filled",
      await session.screenshot(),
      null,
      "REVIEW_STATE",
    ).catch((e) => log.warn("screenshot failed", { error: (e as Error).name }));
    await withUserContext(actor.userId, (t) =>
      recordEvent(t, actor, app.id, "AUTOFILL_COMPLETED", { filled }, attempt.id),
    );
    await withUserContext(actor.userId, (t) =>
      recordAudit(t, {
        userId: actor.userId,
        action: "application_autofill_completed",
        resourceType: "application_attempt",
        resourceId: attempt.id,
        metadata: { filled },
      }),
    );

    // --- Pre-submit checkpoint (HUMAN_APPROVAL) ------------------------------------------------------
    if (ctx.phase === "FILL" || captchaOnForm) {
      const action = captchaOnForm
        ? "The form is filled. This site uses a CAPTCHA: review the form, complete the CAPTCHA and click submit yourself in the browser window. JOBHUNT OS records the confirmation."
        : env.APPLICATION_BROWSER_HEADLESS
          ? "The form is filled. Review the screenshot, then click “Submit application” in JOBHUNT OS — or stop."
          : "The form is filled. Review it in the browser window, then click “Submit application” in JOBHUNT OS, or submit it yourself in the browser.";
      await patchAttempt(actor, attempt.id, {
        status: "NEEDS_HUMAN_INPUT",
        humanAction: action,
        controlCommand: "NONE",
        step: { step: "review", status: "waiting", detail: "Waiting for your submit decision." },
      });
      const formUrl = session.page!.url();
      let decided = false;
      while (Date.now() < ctx.deadline) {
        await new Promise((r) => setTimeout(r, ctx.pollMs));
        await patchAttempt(actor, attempt.id, { leaseMs: 5 * 60_000 });
        const c = await readControl(ctx);
        if (c.controlCommand === "STOP")
          return await finishAttempt(
            actor,
            attempt.id,
            "CANCELLED",
            "CANCELLED",
            "Stopped by you before submitting. Nothing was submitted.",
          );
        if (c.phase === "SUBMIT") {
          if (captchaOnForm) {
            // Never click submit on a CAPTCHA-protected form: the human submits in the browser.
            await patchAttempt(actor, attempt.id, {
              humanAction:
                "This site uses a CAPTCHA — complete it and submit in the browser window yourself.",
            });
            await withUserContext(actor.userId, (t) =>
              t.applicationAttempt.update({ where: { id: attempt.id }, data: { phase: "FILL" } }),
            );
            continue;
          }
          decided = true;
          break;
        }
        if (!env.APPLICATION_BROWSER_HEADLESS) {
          // The human may submit in the visible window: observe (never click) and record with evidence.
          const seen = await session.observeManualSubmission(1, async () => false);
          if (seen?.outcome === "BLOCKED") {
            // The site refused the (human) submission as spam/bot: never retried automatically.
            const action = `The site blocked the submission as possible spam ("${seen.message}"). Submit from your own normal browser using the checklist, then click "I submitted it".`;
            await applicationNeedsHuman(actor, app.id, action, attempt.id);
            return await finishAttempt(actor, attempt.id, "FAILED", "ANTI_BOT_BLOCKED", action);
          }
          if (seen) {
            const sub = await beginSubmission(actor, app.id, attempt.id);
            submissionId = sub.id;
            await recordConfirmed(actor, app.id, attempt.id, sub.id, seen, session);
            return await finishAttempt(
              actor,
              attempt.id,
              "SUCCEEDED",
              null,
              "You submitted in the browser; the confirmation was captured.",
            );
          }
          if (session.page!.url() !== formUrl) {
            const sub = await beginSubmission(actor, app.id, attempt.id);
            submissionId = sub.id;
            await recordSubmissionOutcome(actor, sub.id, {
              result: "UNCERTAIN",
              reason: "The page changed while waiting — it may have been submitted in the browser.",
            });
            return await finishAttempt(
              actor,
              attempt.id,
              "UNCERTAIN",
              "UNKNOWN_RESULT",
              "The page changed while waiting. Check the ATS or your inbox, then confirm.",
            );
          }
        }
      }
      if (!decided)
        return await finishAttempt(
          actor,
          attempt.id,
          "FAILED",
          "TIMEOUT",
          "No submit decision within the time limit. Nothing was submitted.",
        );
      await patchAttempt(actor, attempt.id, {
        status: "RUNNING",
        humanAction: null,
        controlCommand: "NONE",
        step: { step: "review", status: "done", detail: "Submit requested by you." },
      });
    } else if (!(await checkpoint(ctx)))
      return await finishAttempt(
        actor,
        attempt.id,
        "CANCELLED",
        "CANCELLED",
        "Stopped by you before submitting. Nothing was submitted.",
      );

    // --- Submit (exactly once) ----------------------------------------------------------------------
    const sub = await beginSubmission(actor, app.id, attempt.id);
    submissionId = sub.id;
    let observed: Awaited<ReturnType<BrowserSession["submitAndObserve"]>>;
    try {
      observed = await session.submitAndObserve(env.APPLICATION_CONFIRMATION_TIMEOUT_MS);
    } catch (error) {
      await recordSubmissionOutcome(actor, sub.id, {
        result: "UNCERTAIN",
        reason: `The submit step errored: ${(error as Error).message.split("\n")[0]!.slice(0, 150)}`,
      });
      return await finishAttempt(
        actor,
        attempt.id,
        "UNCERTAIN",
        "UNKNOWN_RESULT",
        "The submit step errored — it may or may not have gone through. Check the ATS or your inbox.",
      );
    }
    if (observed.outcome === "CONFIRMED") {
      await recordConfirmed(actor, app.id, attempt.id, sub.id, observed, session);
      return await finishAttempt(
        actor,
        attempt.id,
        "SUCCEEDED",
        null,
        "Submitted — confirmation captured.",
      );
    }
    const shot = await storeScreenshot(
      actor,
      app.id,
      attempt.id,
      "after-submit",
      await session.screenshot(),
      sub.id,
      observed.outcome === "REJECTED" ? "FAILURE_STATE" : "SCREENSHOT",
    ).catch(() => null);
    if (observed.outcome === "BLOCKED") {
      await recordSubmissionOutcome(actor, sub.id, {
        result: "FAILED",
        errorCode: "ANTI_BOT_BLOCKED",
        reason: observed.message,
      });
      return await finishAttempt(
        actor,
        attempt.id,
        "FAILED",
        "ANTI_BOT_BLOCKED",
        `The site blocked the submission as possible spam: ${observed.message} Submit from your own browser using the checklist.`,
      );
    }
    if (observed.outcome === "REJECTED") {
      await recordSubmissionOutcome(actor, sub.id, {
        result: "FAILED",
        errorCode: "SUBMISSION_REJECTED",
        reason: observed.message,
      });
      return await finishAttempt(
        actor,
        attempt.id,
        "FAILED",
        "SUBMISSION_REJECTED",
        `The form rejected the submission: ${observed.message}${shot ? "" : ""}`,
      );
    }
    await recordSubmissionOutcome(actor, sub.id, {
      result: "UNCERTAIN",
      reason: "No confirmation was shown within the time limit.",
    });
    return await finishAttempt(
      actor,
      attempt.id,
      "UNCERTAIN",
      "UNKNOWN_RESULT",
      "No confirmation was shown. Check the ATS or your inbox, then confirm what happened.",
    );
  } catch (error) {
    const blocked = error instanceof NavigationBlockedError;
    log.warn("attempt failed", { attemptId: attempt.id, error: (error as Error).name });
    if (submissionId) {
      const s = await withUserContext(actor.userId, (t) =>
        t.applicationSubmission.findUnique({ where: { id: submissionId! } }),
      );
      if (s?.status === "SUBMITTING")
        await recordSubmissionOutcome(actor, submissionId, {
          result: "UNCERTAIN",
          reason: "The worker failed during submission.",
        }).catch(() => undefined);
      return await finishAttempt(
        actor,
        attempt.id,
        "UNCERTAIN",
        "UNKNOWN_RESULT",
        "The worker failed during submission — check the ATS or your inbox.",
      );
    }
    const timeout = (error as Error).name === "TimeoutError";
    return await finishAttempt(
      actor,
      attempt.id,
      "FAILED",
      blocked
        ? "UNSAFE_URL"
        : timeout
          ? "TIMEOUT"
          : error instanceof AppError
            ? "VALIDATION_FAILED"
            : "INTERNAL_ERROR",
      blocked
        ? `Navigation blocked: ${(error as Error).message}`
        : error instanceof AppError
          ? (error.publicMessage ?? "Validation failed.")
          : timeout
            ? "The page took too long to respond."
            : "The browser step failed.",
    );
  } finally {
    clearInterval(heartbeat);
    await cleanup?.().catch(() => undefined);
    await session.close();
  }
}

async function recordConfirmed(
  actor: ActorRef,
  applicationId: string,
  attemptId: string,
  submissionId: string,
  seen: { confirmationId: string | null; message: string; url: string },
  session: BrowserSession,
) {
  const shot = await storeScreenshot(
    actor,
    applicationId,
    attemptId,
    "confirmation",
    await session.screenshot(),
    submissionId,
    "SCREENSHOT",
  ).catch(() => null);
  const evidence: SubmissionEvidenceInput[] = [
    { evidenceType: "SUCCESS_MESSAGE", textExcerpt: seen.message },
    {
      evidenceType: "CONFIRMATION_PAGE",
      textExcerpt: seen.message,
      metadata: { host: safeHost(seen.url) },
    },
  ];
  if (seen.confirmationId)
    evidence.push({ evidenceType: "CONFIRMATION_ID", textExcerpt: seen.confirmationId });
  if (shot) evidence.push({ evidenceType: "SCREENSHOT", storagePath: shot });
  await recordSubmissionOutcome(actor, submissionId, {
    result: "SUBMITTED",
    confirmationSource: seen.confirmationId ? "CONFIRMATION_ID" : "SUCCESS_MESSAGE",
    evidence: evidence.filter((e) => e.evidenceType !== "SCREENSHOT"),
    externalApplicationId: seen.confirmationId,
    confirmationUrl: /^https?:\/\//.test(seen.url) ? seen.url.slice(0, 2048) : null,
    confirmationText: seen.message,
  });
}

function safeHost(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

// --- Email applications (payload + delivery interface) ----------------------------------------------------

export interface EmailApplicationPayload {
  to: string;
  subject: string;
  body: string;
  attachments: { role: string; fileName: string; sha256: string; byteSize: number }[];
}

/** Delivery connectors arrive in Phase 10; until then nothing is sent automatically. */
export interface EmailDeliveryAdapter {
  id: string;
  configured: boolean;
  send(payload: EmailApplicationPayload): Promise<{ messageId: string }>;
}

export const notConfiguredDelivery: EmailDeliveryAdapter = {
  id: "none",
  configured: false,
  async send() {
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "No email delivery connector is configured (Phase 10).",
    });
  },
};

export async function buildEmailPayload(
  actor: ActorRef,
  applicationId: string,
): Promise<EmailApplicationPayload> {
  const files = await resolveApplicationFiles(actor, applicationId, { create: true });
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
      include: { channel: true },
    });
    if (!app) throw new AppError("NOT_FOUND");
    if (app.channel?.channelType !== "EMAIL_APPLICATION" || !app.channel.email)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "This application has no verified application email.",
      });
    const snap = app.snapshot as { email?: { versionId: string; contentHash: string } | null };
    if (!snap.email)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The package has no approved application email.",
      });
    const v = await t.communicationVersion.findFirst({
      where: { id: snap.email.versionId, userId: actor.userId },
    });
    if (!v || v.status !== "APPROVED" || v.contentHash !== snap.email.contentHash)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The approved email version changed — update the package.",
      });
    const doc = parseCommunicationDocument(v.content);
    if (doc.kind !== "EMAIL")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The package email is not an email document.",
      });
    return {
      to: app.channel.email,
      subject: doc.subject,
      body: toPlainText(doc, { includeSubject: false }),
      attachments: files.map((f) => ({
        role: f.role,
        fileName: f.fileName,
        sha256: f.sha256,
        byteSize: f.byteSize,
      })),
    };
  });
}

/**
 * Email application: after approval, records the exact payload as READY_TO_SEND. Without a
 * delivery connector (Phase 10) the candidate sends it from their own mail client and confirms.
 */
export async function prepareEmailSubmission(
  actor: ActorRef,
  applicationId: string,
  delivery: EmailDeliveryAdapter = notConfiguredDelivery,
) {
  const payload = await buildEmailPayload(actor, applicationId);
  if (delivery.configured)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "Automatic email delivery is a Phase 10 feature.",
    });
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirstOrThrow({
      where: { id: applicationId, userId: actor.userId },
    });
    if (app.status !== "READY_TO_SUBMIT")
      throw new AppError("VALIDATION_ERROR", { publicMessage: "Approve the application first." });
    const approval = await t.applicationApproval.findFirst({
      where: { applicationId: app.id, revokedAt: null },
    });
    if (!approval || approval.applicationHash !== app.applicationHash)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "The approval doesn't match the current application.",
      });
    const existing = await t.applicationSubmission.findFirst({
      where: { applicationId: app.id, status: "READY_TO_SEND" },
    });
    if (existing) return { submission: existing, payload };
    const count = await t.applicationSubmission.count({ where: { applicationId: app.id } });
    const submission = await t.applicationSubmission.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        channelType: "EMAIL_APPLICATION",
        status: "READY_TO_SEND",
        applicationHash: app.applicationHash!,
        submissionFingerprint: createHash("sha256")
          .update(`${app.id}:${app.applicationHash}:email:${count}`)
          .digest("hex"),
      },
    });
    await recordEvent(t, actor, app.id, "WAITING_FOR_USER", {
      reason: "Send the approved email from your mail client, then confirm.",
      submissionId: submission.id,
    });
    return { submission, payload };
  });
}

// --- Manual fallback -----------------------------------------------------------------------------------

/**
 * The candidate applied themselves (manual path, email sent from their client, or after a barrier)
 * and confirms it. Recorded as USER_CONFIRMED — never presented as automatic verification.
 */
export async function confirmManualSubmission(
  actor: ActorRef,
  applicationId: string,
  input: { note?: string | null; externalApplicationId?: string | null },
) {
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
    });
    if (!app) throw new AppError("NOT_FOUND");
    if (!MANUAL_CONFIRM_FROM.includes(app.status as ApplicationStatus))
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `A ${app.status.toLowerCase().replace(/_/g, " ")} application can't be confirmed as submitted.`,
      });
    const active = await t.applicationAttempt.findFirst({
      where: { applicationId: app.id, status: { in: [...ACTIVE_ATTEMPT_STATUSES] } },
    });
    if (active)
      throw new AppError("CONFLICT", {
        publicMessage: "An automation attempt is still running — stop it first.",
      });
    const now = new Date();
    const ext = input.externalApplicationId?.trim().slice(0, 200) || null;
    const hash = app.applicationHash ?? app.packageIntegrityHash;
    const channel = app.channelId
      ? await t.applicationChannel.findUnique({ where: { id: app.channelId } })
      : null;
    let sub = await t.applicationSubmission.findFirst({
      where: { applicationId: app.id, status: "READY_TO_SEND" },
    });
    if (sub) {
      sub = await t.applicationSubmission.update({
        where: { id: sub.id },
        data: {
          status: "SUBMITTED",
          submittedAt: now,
          confirmationSource: "USER_CONFIRMED",
          externalApplicationId: ext,
        },
      });
    } else {
      const count = await t.applicationSubmission.count({ where: { applicationId: app.id } });
      sub = await t.applicationSubmission.create({
        data: {
          userId: actor.userId,
          applicationId: app.id,
          channelType: channel?.channelType ?? "MANUAL_APPLICATION",
          status: "SUBMITTED",
          applicationHash: hash,
          submissionFingerprint: createHash("sha256")
            .update(`${app.id}:${hash}:manual:${count}`)
            .digest("hex"),
          submittedAt: now,
          confirmationSource: "USER_CONFIRMED",
          externalApplicationId: ext,
        },
      });
    }
    await t.applicationEvidence.create({
      data: {
        userId: actor.userId,
        applicationId: app.id,
        submissionId: sub.id,
        evidenceType: "USER_CONFIRMED",
        source: "USER",
        textExcerpt: input.note?.trim().slice(0, 2000) || null,
      },
    });
    await t.application.update({
      where: { id: app.id },
      data: {
        status: "SUBMITTED",
        submittedAt: now,
        confirmationSource: "USER_CONFIRMED",
        externalApplicationId: ext,
        blockedReason: null,
      },
    });
    await recordEvent(t, actor, app.id, "USER_CONFIRMED", { submissionId: sub.id, manual: true });
    await recordAudit(t, {
      userId: actor.userId,
      action: "application_user_confirmed",
      resourceType: "application",
      resourceId: app.id,
      metadata: { submissionId: sub.id, manual: true },
    });
    return sub;
  });
}

export interface ChecklistItem {
  label: string;
  value: string;
  required: boolean;
  status: "READY" | "NEEDS_INPUT";
  kind: "field" | "answer" | "file";
}

/** Everything the candidate needs to apply by hand, in form order, with copyable values. */
export async function buildManualChecklist(
  actor: ActorRef,
  applicationId: string,
  loaded?: Awaited<ReturnType<typeof getReview>>,
) {
  const review = loaded ?? (await getReview(actor, applicationId));
  const answers = new Map(
    review.questions.filter((q) => q.fieldId).map((q) => [q.fieldId!, q.answers[0]]),
  );
  const items: ChecklistItem[] = [];
  for (const field of review.form?.fields ?? []) {
    const m = field.mappings[0];
    if (field.fieldType === "FILE") {
      const role =
        m?.mappingType === "RESUME"
          ? "RESUME"
          : m?.mappingType === "COVER_LETTER"
            ? "COVER_LETTER"
            : null;
      const f = review.files.find((x) => x.role === role);
      items.push({
        label: field.label,
        value: f ? f.fileName : "",
        required: field.required,
        status: f || !field.required ? "READY" : "NEEDS_INPUT",
        kind: "file",
      });
      continue;
    }
    if (m?.mappingType === "GENERATED_ANSWER") {
      const a = answers.get(field.id);
      items.push({
        label: field.label,
        value: a?.answerText ?? "",
        required: field.required,
        status: a?.approvalStatus === "APPROVED" ? "READY" : "NEEDS_INPUT",
        kind: "answer",
      });
      continue;
    }
    const v = m && ["MAPPED", "CONFIRMED", "OVERRIDDEN"].includes(m.status) ? m.value : null;
    const text =
      v === null || v === undefined
        ? ""
        : Array.isArray(v)
          ? v.join(", ")
          : typeof v === "object"
            ? ((v as { fileName?: string }).fileName ?? "")
            : String(v);
    items.push({
      label: field.label,
      value: text,
      required: field.required,
      status: text || !field.required ? "READY" : "NEEDS_INPUT",
      kind: "field",
    });
  }
  for (const q of review.questions.filter((x) => !x.fieldId)) {
    const a = q.answers[0];
    items.push({
      label: q.questionText,
      value: a?.answerText ?? "",
      required: q.required,
      status: a?.approvalStatus === "APPROVED" ? "READY" : "NEEDS_INPUT",
      kind: "answer",
    });
  }
  if (!review.form)
    for (const f of review.files)
      items.push({
        label: f.role === "RESUME" ? "Resume" : "Cover letter",
        value: f.fileName,
        required: f.role === "RESUME",
        status: "READY",
        kind: "file",
      });
  const url = review.channel?.url ?? review.app.applicationUrl ?? review.app.jobUrl;
  const text = [
    `Application checklist`,
    url ? `Apply at: ${url}` : review.channel?.email ? `Email: ${review.channel.email}` : "",
    "",
    ...items.map(
      (i) =>
        `${i.required ? "* " : "  "}${i.label}\n    ${i.value || "(you need to fill this in)"}`,
    ),
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { url, email: review.channel?.email ?? null, items, text, files: review.files };
}

export async function getExecutionState(actor: ActorRef, applicationId: string) {
  return withUserContext(actor.userId, async (t) => {
    const app = await t.application.findFirst({
      where: { id: applicationId, userId: actor.userId },
      select: {
        id: true,
        status: true,
        readiness: true,
        automationMode: true,
        blockedReason: true,
        confirmationSource: true,
        externalApplicationId: true,
        submittedAt: true,
      },
    });
    if (!app) throw new AppError("NOT_FOUND");
    const attempt = await t.applicationAttempt.findFirst({
      where: { applicationId: app.id },
      orderBy: { attemptNumber: "desc" },
    });
    const submission = await t.applicationSubmission.findFirst({
      where: { applicationId: app.id },
      orderBy: { startedAt: "desc" },
    });
    return {
      app,
      attempt: attempt && {
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        phase: attempt.phase,
        humanAction: attempt.humanAction,
        errorCode: attempt.errorCode,
        errorMessage: attempt.errorMessage,
        controlCommand: attempt.controlCommand,
        heartbeatAt: attempt.heartbeatAt?.toISOString() ?? null,
        steps: ((attempt.steps as Step[]) ?? []).slice(-12),
      },
      submission: submission && {
        id: submission.id,
        status: submission.status,
        confirmationSource: submission.confirmationSource,
        externalApplicationId: submission.externalApplicationId,
      },
      automationEnabled: automationEnabled(),
    };
  });
}
