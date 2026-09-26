import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { getProfile } from "@/modules/candidate/profile.service";
import { getAiRoute, routeUnavailableReason, runAiTask } from "@/server/ai/orchestrator";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import {
  captureContext,
  createCommunication,
  createCommunicationInput,
  insertVersion,
  persistClaims,
  runCommunicationCheck,
  signatureText,
  type ActorRef,
  type SignatureFields,
} from "./communication.service";
import { loadEvidence } from "./context.service";
import { getCommunicationPreferences } from "./recipient.service";
import { parseCommunicationDocument, type CommunicationDocument } from "./document";
import {
  aiCoverLetterOutputSchema,
  aiEmailOutputSchema,
  applyGeneratedDraft,
  buildGenerationPrompt,
  COVER_LETTER_PROMPT_ID,
  COVER_LETTER_PROMPT_VERSION,
  EMAIL_PROMPT_ID,
  EMAIL_PROMPT_VERSION,
  GENERATION_ENGINE_VERSION,
  type RejectedSentence,
} from "./generation";
import {
  defaultGreeting,
  PURPOSE_BY_TYPE,
  type CommunicationType,
  type Length,
  type RecipientType,
  type Tone,
} from "./types";

/**
 * GENERATE_COMMUNICATION — AI drafting through the AI Orchestrator (never a provider SDK).
 *   load job/requirements · candidate evidence · resume · match · research (current versions)
 *   → orchestrator (privacy routing: private data stays on Ollama unless the user opted in)
 *   → structured output → reference + claim validation (unsupported sentences removed)
 *   → NEW version (GENERATED, AI_GENERATED) locked to the exact context → quality check.
 * Generation is explicit, idempotent for identical inputs, and never approves anything.
 */

export interface GenerationStage {
  key: string;
  label: string;
  status: "done" | "failed" | "skipped";
  ms: number;
  detail?: string;
}

export interface GenerationResult {
  communicationId: string;
  communicationVersionId: string;
  contentHash: string;
  qualityReport: {
    checkId: string;
    passed: number;
    critical: number;
    warnings: number;
    info: number;
  };
  approvalRequired: true;
  reused: boolean;
  provider: string | null;
  model: string | null;
  removed: RejectedSentence[];
  stages: GenerationStage[];
}

const inFlight = new Set<string>();

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function generateCommunicationDraft(
  actor: ActorRef,
  communicationId: string,
): Promise<GenerationResult> {
  if (inFlight.has(communicationId))
    throw new AppError("CONFLICT", {
      publicMessage:
        "A draft is already being generated for this communication. Wait for it to finish.",
    });
  inFlight.add(communicationId);
  try {
    return await generate(actor, communicationId);
  } finally {
    inFlight.delete(communicationId);
  }
}

async function generate(actor: ActorRef, communicationId: string): Promise<GenerationResult> {
  const stages: GenerationStage[] = [];
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

  const { communication, head, ctx } = await stage("job", "Loading job context", () =>
    withUserContext(actor.userId, async (t) => {
      const communication = await t.communication.findFirst({
        where: { id: communicationId, userId: actor.userId },
      });
      if (!communication) throw new AppError("NOT_FOUND");
      if (communication.status === "ARCHIVED")
        throw new AppError("VALIDATION_ERROR", {
          publicMessage: "This communication is archived. Restore it to make changes.",
        });
      const head = communication.currentVersionId
        ? await t.communicationVersion.findUnique({ where: { id: communication.currentVersionId } })
        : null;
      if (!head) throw new AppError("NOT_FOUND");
      const ctx = await captureContext(
        t,
        actor,
        communication.jobId,
        communication.resumeVersionId,
      );
      return { communication, head, ctx };
    }),
  );
  const task =
    communication.kind === "COVER_LETTER"
      ? ("cover_letter.generate" as const)
      : ("email.generate" as const);
  const promptId = task === "email.generate" ? EMAIL_PROMPT_ID : COVER_LETTER_PROMPT_ID;
  const recipient = {
    name: communication.recipientName,
    title: communication.recipientTitle,
    company: communication.recipientCompany,
  };

  const evidence = await stage("evidence", "Loading candidate evidence", () =>
    withUserContext(actor.userId, (t) =>
      loadEvidence(t, actor, {
        jobId: communication.jobId,
        resumeVersionId: communication.resumeVersionId,
        requirementSetId: ctx.requirementSetId,
        jobResearchId: ctx.jobResearchId,
        matchId: ctx.match?.id ?? null,
        userContext: communication.userContext,
        recipient,
      }),
    ),
  );
  if (communication.resumeVersionId)
    stages.push({
      key: "resume",
      label: "Loading resume",
      status: "done",
      ms: 0,
      detail: evidence.resume?.label,
    });
  stages.push({
    key: "research",
    label: "Loading research",
    status: evidence.research ? "done" : "skipped",
    ms: 0,
    detail: evidence.research
      ? `Research v${evidence.research.version} · ${evidence.research.claims.length} verified claims`
      : "No research for this job — no company claims will be made.",
  });
  if (!evidence.corpus.facts.length)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage:
        "You have no usable candidate facts yet. Add or review facts in your profile first — drafts are written only from your facts.",
    });

  const headDoc = parseCommunicationDocument(head.content);
  const prefs = await getCommunicationPreferences(actor);
  const strategy = (communication.strategy ?? {}) as Record<string, unknown>;
  const evidenceRefs = new Set(evidence.corpus.facts.map((f) => f.ref));
  // Idempotency: identical settings + context + prompt → the existing generated draft.
  const fingerprint = sha256Hex(
    JSON.stringify([
      promptId,
      GENERATION_ENGINE_VERSION,
      communication.communicationType,
      communication.tone,
      communication.length,
      communication.template,
      recipient,
      communication.recipientType,
      communication.userContext,
      ctx.factsHash,
      ctx.requirementSetId,
      ctx.jobResearchId,
      ctx.match?.id ?? null,
      ctx.resumeVersion?.id ?? null,
      // System-controlled parts carried from the head (not its AI-written body).
      headDoc.signature,
      headDoc.kind === "COVER_LETTER" ? headDoc.header : null,
      prefs,
      strategy,
    ]),
  );
  const existing = await withUserContext(actor.userId, (t) =>
    t.communicationVersion.findFirst({
      where: {
        userId: actor.userId,
        communicationId,
        versionType: "GENERATED",
        generation: { path: ["fingerprint"], equals: fingerprint },
      },
      orderBy: { createdAt: "desc" },
    }),
  );
  if (existing) {
    const { check } = await runCommunicationCheck(actor, existing.id);
    const g = existing.generation as Record<string, unknown>;
    return {
      communicationId,
      communicationVersionId: existing.id,
      contentHash: existing.contentHash,
      qualityReport: pickSummary(check.id, check.summary),
      approvalRequired: true,
      reused: true,
      provider: (g.provider as string) ?? null,
      model: (g.model as string) ?? null,
      removed:
        ((existing.changeSummary as Record<string, unknown>).rejected as RejectedSentence[]) ?? [],
      stages,
    };
  }

  const route = await getAiRoute(actor.userId, task);
  if (!route.steps.length)
    throw new AppError("EXTERNAL_SERVICE_ERROR", {
      publicMessage: `${routeUnavailableReason(route) ?? "No AI provider is available."} You can still write and edit this ${communication.kind === "EMAIL" ? "email" : "cover letter"} yourself.`,
    });

  // Base document: system-controlled greeting, signature and header (never AI-written).
  const greeting = defaultGreeting(
    communication.recipientName,
    communication.recipientType as RecipientType,
    prefs.preferredGreeting,
  );
  const signature =
    headDoc.signature.trim() || (await defaultSignatureFor(actor, communication.signaturePresetId));
  let base: CommunicationDocument;
  if (headDoc.kind === "COVER_LETTER") {
    const profile = await withUserContext(actor.userId, (t) => getProfile(actor, t));
    base = parseCommunicationDocument({
      ...headDoc,
      header:
        headDoc.header.name || headDoc.header.email
          ? headDoc.header
          : {
              name: profile?.fullName ?? null,
              email: profile?.professionalEmail ?? null,
              phone: profile?.phone ?? null,
              location: null,
              links: [],
            },
      date: headDoc.date ?? todayIso(),
      recipient: {
        name: communication.recipientName,
        title: communication.recipientTitle,
        company: communication.recipientCompany ?? evidence.job?.company ?? null,
      },
      greeting,
      signature,
    });
  } else base = parseCommunicationDocument({ ...headDoc, greeting, signature });

  const prompt = buildGenerationPrompt({
    type: communication.communicationType as CommunicationType,
    tone: communication.tone as Tone,
    length: communication.length as Length,
    facts: evidence.corpus.facts,
    resume: evidence.resume?.approved
      ? { label: evidence.resume.label, text: evidence.resume.text }
      : evidence.resume
        ? { label: `${evidence.resume.label} — not approved; rely on facts only`, text: "" }
        : null,
    match: evidence.match,
    research: evidence.corpus.research.map((r) => ({ id: r.id, text: r.text })),
    job: evidence.job,
    userContext: communication.userContext,
    recipient: {
      type: communication.recipientType,
      name: communication.recipientName,
      title: communication.recipientTitle,
    },
    greeting,
    resumeAssociated: Boolean(communication.resumeVersionId),
    preferredClosing: prefs.preferredClosing,
    avoidPhrases: prefs.avoidPhrases,
    strategy: {
      requestedAction: (strategy.requestedAction as string) ?? null,
      primaryEvidence: ((strategy.primaryEvidence as string[]) ?? []).filter((r) =>
        evidenceRefs.has(r),
      ),
      secondaryEvidence: ((strategy.secondaryEvidence as string[]) ?? []).filter((r) =>
        evidenceRefs.has(r),
      ),
    },
  });

  const started = Date.now();
  const result =
    task === "email.generate"
      ? await runAiTask({
          userId: actor.userId,
          agent: "communication-writer",
          task,
          promptVersion: EMAIL_PROMPT_VERSION,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          schema: aiEmailOutputSchema,
        })
      : await runAiTask({
          userId: actor.userId,
          agent: "communication-writer",
          task,
          promptVersion: COVER_LETTER_PROMPT_VERSION,
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
          schema: aiCoverLetterOutputSchema,
        });
  if (!result.ok) {
    stages.push({
      key: "generate",
      label: "Generating",
      status: "failed",
      ms: Date.now() - started,
      detail: result.error.publicMessage,
    });
    await withUserContext(actor.userId, (t) =>
      recordAudit(t, {
        userId: actor.userId,
        action: "communication_generation_failed",
        resourceType: "communication",
        resourceId: communicationId,
        metadata: { task, errorKind: result.errorKind },
      }),
    );
    throw new AppError("EXTERNAL_SERVICE_ERROR", {
      publicMessage:
        result.errorKind === "INVALID_OUTPUT"
          ? "The AI response did not pass validation, so nothing was saved. Try again or write it yourself."
          : `${result.error.publicMessage} Nothing was saved; you can still write it yourself.`,
    });
  }
  const generationMs = Date.now() - started;
  stages.push({
    key: "generate",
    label: "Generating",
    status: "done",
    ms: generationMs,
    detail: `${result.providerKind === "ollama" ? "Ollama (local)" : "Gemini (cloud)"} · ${result.model}`,
  });

  const draft = await stage("validate", "Validating claims", async () =>
    applyGeneratedDraft(result.output, base, evidence.corpus),
  );
  stages[stages.length - 1]!.detail = `${draft.stats.kept} kept · ${draft.stats.removed} removed`;
  const bodyEmpty =
    draft.doc.kind === "EMAIL" ? !draft.doc.bodyParagraphs.length : !draft.doc.paragraphs.length;
  if (bodyEmpty) {
    await withUserContext(actor.userId, (t) =>
      recordAudit(t, {
        userId: actor.userId,
        action: "communication_generation_failed",
        resourceType: "communication",
        resourceId: communicationId,
        metadata: { task, reason: "no_supported_statements", removed: draft.stats.removed },
      }),
    );
    throw new AppError("VALIDATION_ERROR", {
      publicMessage:
        "No statement in the AI draft could be verified against your facts, so nothing was saved.",
    });
  }

  const saved = await stage("save", "Preparing review", () =>
    withUserContext(actor.userId, async (t) => {
      const version = await insertVersion(t, actor, {
        communicationId,
        doc: draft.doc,
        versionType: "GENERATED",
        contentSource: "AI_GENERATED",
        parentId: head.id,
        context: ctx,
        contextParts: {
          type: communication.communicationType,
          tone: communication.tone,
          length: communication.length,
          userContext: communication.userContext,
          recipient,
        },
        generation: {
          method: "AI",
          task,
          promptVersion: promptId,
          provider: result.provider,
          providerKind: result.providerKind,
          model: result.model,
          generationId: result.generationId,
          generatedAt: new Date().toISOString(),
          durationMs: generationMs,
          fingerprint,
          stats: draft.stats,
          researchVersion: evidence.research?.version ?? null,
          strategy: {
            purpose: PURPOSE_BY_TYPE[communication.communicationType as CommunicationType],
            ...strategy,
          },
          preferences: {
            greeting: prefs.preferredGreeting,
            closing: prefs.preferredClosing,
            avoidPhrases: prefs.avoidPhrases.length,
          },
          requirementSetVersion: evidence.requirementSet?.version ?? null,
        },
      });
      await t.communicationVersion.update({
        where: { id: version.id },
        data: {
          changeSummary: {
            rejected: draft.rejected,
            warnings: draft.warnings,
            stats: draft.stats,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await persistClaims(t, actor, version.id, draft.claims);
      await recordAudit(t, {
        userId: actor.userId,
        action: "communication_generated",
        resourceType: "communication_version",
        resourceId: version.id,
        metadata: {
          task,
          provider: result.providerKind,
          model: result.model,
          removed: draft.stats.removed,
          contentHash: version.contentHash,
          generationId: result.generationId,
        },
      });
      return version;
    }),
  );
  logger.info("communication generated", {
    communicationId,
    task,
    kept: draft.stats.kept,
    removed: draft.stats.removed,
    generationId: result.generationId,
  });

  const { check } = await stage("check", "Running communication checks", () =>
    runCommunicationCheck(actor, saved.id),
  );
  return {
    communicationId,
    communicationVersionId: saved.id,
    contentHash: saved.contentHash,
    qualityReport: pickSummary(check.id, check.summary),
    approvalRequired: true,
    reused: false,
    provider: result.providerKind,
    model: result.model,
    removed: draft.rejected,
    stages,
  };
}

async function defaultSignatureFor(actor: ActorRef, presetId: string | null): Promise<string> {
  return withUserContext(actor.userId, async (t) => {
    const preset = presetId
      ? await t.signaturePreset.findFirst({ where: { id: presetId, userId: actor.userId } })
      : await t.signaturePreset.findFirst({ where: { userId: actor.userId, isDefault: true } });
    if (preset) return signatureText(preset.fields as SignatureFields);
    return (await getProfile(actor, t))?.fullName ?? "";
  });
}

function pickSummary(checkId: string, summary: unknown) {
  const s = (summary ?? {}) as Record<string, number>;
  return {
    checkId,
    passed: s.passed ?? 0,
    critical: s.critical ?? 0,
    warnings: s.warnings ?? 0,
    info: s.info ?? 0,
  };
}

/** AI availability for the studio UI (never exposes keys; reflects the real route). */
export async function getGenerationAvailability(actor: ActorRef, kind: "EMAIL" | "COVER_LETTER") {
  const route = await getAiRoute(
    actor.userId,
    kind === "EMAIL" ? "email.generate" : "cover_letter.generate",
  );
  const first = route.steps[0];
  return {
    available: Boolean(first),
    provider: first
      ? `${first.kind === "ollama" ? "Ollama" : "Gemini"} · ${first.choice.model} (${first.kind === "ollama" ? "local — your facts stay on this machine" : "cloud — you opted in to private cloud processing"})`
      : null,
    reason: routeUnavailableReason(route),
  };
}

// --- Workflow contract (Phase 9 nodes WRITE_EMAIL / COVER_LETTER; no visual node here) -------

export const writeCommunicationInput = z.object({
  jobId: z.uuid(),
  resumeVersionId: z.uuid().nullish(),
  communicationType: createCommunicationInput.shape.communicationType,
  recipientContext: z
    .object({
      type: createCommunicationInput.shape.recipientType,
      name: z.string().max(200).nullish(),
      title: z.string().max(200).nullish(),
      email: z.string().max(254).nullish(),
    })
    .partial()
    .nullish(),
  userContext: z.string().max(2000).nullish(),
  options: z
    .object({
      tone: createCommunicationInput.shape.tone,
      length: createCommunicationInput.shape.length,
      template: z.string().max(40).optional(),
    })
    .partial()
    .nullish(),
});
export type WriteCommunicationInput = z.input<typeof writeCommunicationInput>;

/**
 * Reusable capability: create a communication for a job and draft it with AI.
 * Output is always a DRAFT that requires the candidate's approval.
 */
export async function writeCommunication(actor: ActorRef, raw: WriteCommunicationInput) {
  const input = writeCommunicationInput.parse(raw);
  const created = await createCommunication(actor, {
    communicationType: input.communicationType,
    jobId: input.jobId,
    resumeVersionId: input.resumeVersionId ?? null,
    recipientType: input.recipientContext?.type,
    recipientName: input.recipientContext?.name ?? null,
    recipientTitle: input.recipientContext?.title ?? null,
    recipientEmail: input.recipientContext?.email ?? null,
    userContext: input.userContext ?? null,
    tone: input.options?.tone,
    length: input.options?.length,
    template: input.options?.template,
  });
  const result = await generateCommunicationDraft(actor, created.id);
  return {
    communicationId: result.communicationId,
    communicationVersionId: result.communicationVersionId,
    contentHash: result.contentHash,
    qualityReport: result.qualityReport,
    approvalRequired: true as const,
  };
}
