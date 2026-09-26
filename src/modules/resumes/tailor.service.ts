import "server-only";
import { z } from "zod";
import { getAiRoute, routeUnavailableReason, runAiTask } from "@/server/ai/orchestrator";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { alignRequirements } from "./alignment";
import { runVersionCheck } from "./check.service";
import { parseResumeDocument } from "./document";
import { resumeContentHash } from "./hash";
import { loadJobContext } from "./job-context";
import { insertVersion, loadUsableFacts, type ActorRef } from "./resume.service";
import {
  aiTailorOutputSchema,
  applyAiProposals,
  buildTailorPrompt,
  TAILOR_ENGINE_VERSION,
  tailorDeterministic,
  tailoringOptionsSchema,
  type ChangeSet,
  type TailoringOptions,
} from "./tailor";

/**
 * TAILOR_RESUME — the reusable backend capability (future workflow node, Phase 9).
 *
 *   input:  { sourceResumeId, sourceVersionId?, jobId, options? }   (candidate = the actor)
 *   output: { resumeId, resumeVersionId, jobId, changeSet, qualityReport, approvalRequired: true }
 *
 * Steps (each recorded in `stages` with its real duration):
 *   read job requirements → load candidate evidence → deterministic tailoring →
 *   AI wording (optional, local Ollama) → claim validation → save new TAILORED version → Resume Check
 * The source resume is only read; the result is a NEW resume linked to the job.
 */

export const tailorInputSchema = z.object({
  sourceResumeId: z.uuid(),
  sourceVersionId: z.uuid().nullish(),
  jobId: z.uuid(),
  options: tailoringOptionsSchema.default(tailoringOptionsSchema.parse({})),
});
export type TailorInput = z.input<typeof tailorInputSchema>;

export interface TailorStage {
  key: string;
  label: string;
  status: "done" | "skipped" | "failed";
  ms: number;
  detail?: string;
}

export interface TailorResult {
  resumeId: string;
  resumeVersionId: string;
  jobId: string;
  changeSet: ChangeSet;
  qualityReport: {
    checkId: string;
    passed: number;
    issues: number;
    warnings: number;
    opportunities: number;
  };
  approvalRequired: true;
  reused: boolean;
  stages: TailorStage[];
  aiStatus: "USED" | "NOT_REQUESTED" | "UNAVAILABLE" | "INVALID_OUTPUT";
}

const PROMPT_VERSION = 1;

export async function tailorResumeToJob(actor: ActorRef, raw: TailorInput): Promise<TailorResult> {
  const input = tailorInputSchema.parse(raw);
  const options: TailoringOptions = input.options;
  const stages: TailorStage[] = [];
  const stage = async <T>(key: string, label: string, fn: () => Promise<T>): Promise<T> => {
    const started = Date.now();
    try {
      const out = await fn();
      stages.push({ key, label, status: "done", ms: Date.now() - started });
      return out;
    } catch (error) {
      stages.push({ key, label, status: "failed", ms: Date.now() - started });
      throw error;
    }
  };

  // Source version (owned) — read-only.
  const source = await withUserContext(actor.userId, async (t) => {
    const resume = await t.resume.findFirst({
      where: { id: input.sourceResumeId, userId: actor.userId },
    });
    if (!resume)
      throw new AppError("NOT_FOUND", { publicMessage: "The source resume was not found." });
    const versionId = input.sourceVersionId ?? resume.currentVersionId;
    const version = versionId
      ? await t.resumeVersion.findFirst({
          where: { id: versionId, resumeId: resume.id, userId: actor.userId },
        })
      : null;
    if (!version)
      throw new AppError("NOT_FOUND", {
        publicMessage: "The source resume version was not found.",
      });
    return { resume, version };
  });

  const ctx = await stage("requirements", "Reading job requirements", () =>
    loadJobContext(actor, input.jobId),
  );
  const facts = await stage("evidence", "Finding relevant candidate evidence", () =>
    withUserContext(actor.userId, (t) => loadUsableFacts(actor, t)),
  );
  const sourceDoc = parseResumeDocument(source.version.content);

  // Idempotency: the same source content + job + options returns the existing draft.
  const fingerprint = sha256Hex(
    JSON.stringify([
      source.version.contentHash,
      input.jobId,
      options,
      TAILOR_ENGINE_VERSION,
      ctx.requirements.map((r) => r.id),
    ]),
  );
  const existing = await withUserContext(actor.userId, (t) =>
    t.resumeVersion.findFirst({
      where: {
        userId: actor.userId,
        targetJobId: input.jobId,
        versionType: "TAILORED",
        generation: { path: ["fingerprint"], equals: fingerprint },
        resume: { status: "ACTIVE" },
      },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (existing) {
    const report = await runVersionCheck(actor, existing.id, { jobId: input.jobId });
    return {
      resumeId: existing.resumeId,
      resumeVersionId: existing.id,
      jobId: input.jobId,
      changeSet: existing.changeSet as unknown as ChangeSet,
      qualityReport: { checkId: report.check.id, ...pickSummary(report.check.summary) },
      approvalRequired: true,
      reused: true,
      stages,
      aiStatus:
        ((existing.generation as Record<string, unknown>).aiStatus as TailorResult["aiStatus"]) ??
        "NOT_REQUESTED",
    };
  }

  const deterministic = await stage(
    "select",
    "Selecting and ordering relevant experience",
    async () =>
      tailorDeterministic(sourceDoc, {
        requirements: ctx.requirements,
        facts,
        options,
        job: { id: ctx.job.id, title: ctx.job.title },
      }),
  );
  let doc = deterministic.doc;
  const changeSet: ChangeSet = {
    engine: TAILOR_ENGINE_VERSION,
    method: "DETERMINISTIC",
    provider: null,
    model: null,
    options,
    jobId: input.jobId,
    changes: deterministic.changes,
    needsReview: [],
    rejected: [],
    warnings: [...deterministic.warnings],
  };
  if (ctx.researchSignals.length) {
    changeSet.warnings.push(
      `Company/job research emphasised: ${ctx.researchSignals.map((s) => s.skill).join(", ")} — used only to order your existing facts.`,
    );
  }

  let aiStatus: TailorResult["aiStatus"] = "NOT_REQUESTED";
  const wantsAi =
    options.useAi &&
    (options.summaryMode !== "preserve" || options.keywordAlignment !== "conservative");
  const aiRoute = wantsAi ? await getAiRoute(actor.userId, "resume.tailor") : null;
  if (wantsAi && aiRoute && !aiRoute.steps.length) {
    aiStatus = "UNAVAILABLE";
    stages.push({
      key: "draft",
      label: "Drafting targeted wording",
      status: "skipped",
      ms: 0,
      detail: `${routeUnavailableReason(aiRoute)} Deterministic tailoring only.`,
    });
  } else if (wantsAi) {
    const started = Date.now();
    const prompt = buildTailorPrompt({
      doc,
      facts,
      job: ctx.job,
      requirements: ctx.requirements,
      options,
    });
    const result = await runAiTask({
      userId: actor.userId,
      agent: "resume-tailor",
      task: "resume.tailor",
      promptVersion: PROMPT_VERSION,
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      schema: aiTailorOutputSchema,
    });
    if (!result.ok) {
      aiStatus = result.errorKind === "INVALID_OUTPUT" ? "INVALID_OUTPUT" : "UNAVAILABLE";
      stages.push({
        key: "draft",
        label: "Drafting targeted wording",
        status: "failed",
        ms: Date.now() - started,
        detail: result.error.publicMessage,
      });
      changeSet.warnings.push(
        aiStatus === "INVALID_OUTPUT"
          ? "The AI response did not pass validation, so no AI wording was used."
          : `AI wording was skipped: ${result.error.publicMessage}`,
      );
    } else {
      stages.push({
        key: "draft",
        label: "Drafting targeted wording",
        status: "done",
        ms: Date.now() - started,
      });
      const validateStarted = Date.now();
      const applied = applyAiProposals(doc, result.output, facts);
      doc = applied.doc;
      changeSet.changes.push(...applied.changes);
      changeSet.needsReview = applied.needsReview;
      changeSet.rejected = applied.rejected;
      changeSet.warnings.push(...result.output.warnings.map((w) => `AI note: ${w}`));
      changeSet.method = applied.changes.length ? "AI_ASSISTED" : "DETERMINISTIC";
      changeSet.provider = result.provider;
      changeSet.model = result.model;
      aiStatus = "USED";
      stages.push({
        key: "validate",
        label: "Validating claims",
        status: "done",
        ms: Date.now() - validateStarted,
        detail: `${applied.changes.length} accepted · ${applied.needsReview.length} need review · ${applied.rejected.length} rejected`,
      });
      logger.info("resume tailoring ai", {
        jobId: input.jobId,
        accepted: applied.changes.length,
        review: applied.needsReview.length,
        rejected: applied.rejected.length,
        generationId: result.generationId,
      });
    }
  }

  const alignment = alignRequirements(
    ctx.requirements.filter((r) => !r.id.startsWith("research:")),
    facts,
    doc,
  );
  const missingRequired = alignment.filter(
    (a) => a.status === "MISSING" && a.requirementType === "REQUIRED",
  );
  if (missingRequired.length) {
    changeSet.warnings.push(
      `Not in your verified profile, so not added: ${missingRequired
        .slice(0, 6)
        .map((a) => a.text)
        .join(", ")}${missingRequired.length > 6 ? ", …" : ""}.`,
    );
  }

  const saved = await stage("save", "Preparing version", () =>
    withUserContext(actor.userId, async (t) => {
      const company = ctx.job.company ? ` — ${ctx.job.company}` : "";
      const resume = await t.resume.create({
        data: {
          userId: actor.userId,
          name: `${ctx.job.title}${company}`.slice(0, 120),
          kind: "TAILORED",
          template: source.resume.template,
          pageFormat: source.resume.pageFormat,
          sourceResumeId: source.resume.id,
          targetJobId: ctx.job.id,
        },
      });
      const version = await insertVersion(t, actor, {
        resumeId: resume.id,
        doc,
        versionType: "TAILORED",
        title: `Tailored for ${ctx.job.title}${company}`.slice(0, 200),
        parent: { id: source.version.id, content: source.version.content },
        targetJobId: ctx.job.id,
        changeSet,
        aiAssisted: changeSet.method === "AI_ASSISTED",
        generation: {
          method: changeSet.method,
          engine: TAILOR_ENGINE_VERSION,
          provider: changeSet.provider,
          model: changeSet.model,
          options,
          fingerprint,
          aiStatus,
          sourceVersionId: source.version.id,
        },
      });
      await recordAudit(t, {
        userId: actor.userId,
        action: "resume_tailored",
        resourceType: "resume_version",
        resourceId: version.id,
        metadata: {
          jobId: ctx.job.id,
          sourceVersionId: source.version.id,
          method: changeSet.method,
          changes: changeSet.changes.length,
          rejected: changeSet.rejected.length,
          contentHash: resumeContentHash(doc),
        },
      });
      return { resume, version };
    }),
  );

  const report = await stage("check", "Running resume checks", () =>
    runVersionCheck(actor, saved.version.id, { jobId: ctx.job.id }),
  );
  return {
    resumeId: saved.resume.id,
    resumeVersionId: saved.version.id,
    jobId: ctx.job.id,
    changeSet,
    qualityReport: { checkId: report.check.id, ...pickSummary(report.check.summary) },
    approvalRequired: true,
    reused: false,
    stages,
    aiStatus,
  };
}

function pickSummary(summary: unknown) {
  const s = (summary ?? {}) as Record<string, number>;
  return {
    passed: s.passed ?? 0,
    issues: s.issues ?? 0,
    warnings: s.warnings ?? 0,
    opportunities: s.opportunities ?? 0,
  };
}

/** Job priorities for the tailoring flow (before generating). */
export async function getTailoringPreview(
  actor: ActorRef,
  jobId: string,
  sourceVersionId?: string | null,
) {
  const ctx = await loadJobContext(actor, jobId);
  const facts = await withUserContext(actor.userId, (t) => loadUsableFacts(actor, t));
  let alignment = null;
  if (sourceVersionId) {
    const version = await withUserContext(actor.userId, (t) =>
      t.resumeVersion.findFirst({
        where: { id: sourceVersionId, userId: actor.userId },
        select: { content: true },
      }),
    );
    if (version)
      alignment = alignRequirements(
        ctx.requirements.filter((r) => !r.id.startsWith("research:")),
        facts,
        parseResumeDocument(version.content),
      );
  }
  const route = await getAiRoute(actor.userId, "resume.tailor");
  const first = route.steps[0];
  return {
    ctx,
    alignment,
    aiConfigured: Boolean(first),
    aiProvider: first
      ? `${first.kind === "ollama" ? "Ollama" : "Gemini"} · ${first.choice.model} (${first.kind === "ollama" ? "local — facts never leave your server" : "cloud — you opted in to private cloud processing"})`
      : null,
    aiUnavailableReason: routeUnavailableReason(route),
  };
}
