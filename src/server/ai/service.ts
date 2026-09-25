import "server-only";
import { z } from "zod";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { AppError } from "@/server/errors";
import { logger } from "@/server/logger";
import { AI_UNAVAILABLE_MESSAGE } from "./providers/ollama";
import { resolveModels } from "./router";
import type { AiMessage, AiTask } from "./types";

export interface StructuredGenerationInput<T> {
  userId: string;
  agent: string;
  task: AiTask;
  promptVersion: number;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  traceId?: string;
}

export type StructuredGenerationResult<T> =
  | { ok: true; output: T; generationId: string; provider: string; model: string }
  | { ok: false; generationId: string | null; error: AppError };

const log = logger.child({ category: "ai" });

/**
 * Single entry point for AI calls. Responsibilities:
 *   - route to an allowed provider (personal data -> local only)
 *   - validate output with Zod; invalid output is NEVER returned as data
 *   - persist an ai_generations row (metadata + validated output, no prompts)
 *   - log metadata only (never prompt or document content)
 * AI failure is reported as a value so callers can degrade gracefully.
 */
export async function generateStructured<T>(
  input: StructuredGenerationInput<T>,
): Promise<StructuredGenerationResult<T>> {
  const choice = resolveModels(input.task)[0];
  if (!choice) {
    return {
      ok: false,
      generationId: null,
      error: new AppError("AI_ERROR", {
        message: "No AI provider configured",
        publicMessage: AI_UNAVAILABLE_MESSAGE,
      }),
    };
  }

  const inputHash = sha256Hex(JSON.stringify(input.messages));
  const started = Date.now();
  let status = "SUCCEEDED";
  let errorCode: string | null = null;
  let output: T | null = null;
  let usage: { inputTokens?: number; outputTokens?: number } = {};
  let failure: AppError | null = null;

  try {
    const response = await choice.provider.generateStructured({
      model: choice.model,
      messages: input.messages,
      jsonSchema: z.toJSONSchema(input.schema) as Record<string, unknown>,
    });
    usage = response.usage;
    const parsed = input.schema.safeParse(response.json);
    if (parsed.success) {
      output = parsed.data;
    } else {
      status = "SCHEMA_INVALID";
      errorCode = "SCHEMA_INVALID";
      failure = new AppError("AI_ERROR", {
        message: `AI output failed schema validation (${parsed.error.issues.length} issues)`,
        publicMessage: "The AI returned data in an unexpected format. No facts were saved from it.",
      });
    }
  } catch (error) {
    status = "FAILED";
    failure =
      error instanceof AppError
        ? error
        : new AppError("AI_ERROR", { cause: error, publicMessage: AI_UNAVAILABLE_MESSAGE });
    errorCode = failure.code;
  }

  const latencyMs = Date.now() - started;
  const generation = await withUserContext(input.userId, (tx) =>
    tx.aiGeneration.create({
      data: {
        userId: input.userId,
        agent: input.agent,
        task: input.task,
        provider: choice.provider.id,
        model: choice.model,
        promptVersion: input.promptVersion,
        inputHash,
        output: output === null ? undefined : (output as object),
        status,
        errorCode,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        latencyMs,
        traceId: input.traceId ?? null,
      },
      select: { id: true },
    }),
  );

  log.info("ai generation", {
    generationId: generation.id,
    task: input.task,
    provider: choice.provider.id,
    model: choice.model,
    status,
    latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
  });

  if (failure || output === null) {
    return { ok: false, generationId: generation.id, error: failure ?? new AppError("AI_ERROR") };
  }
  return {
    ok: true,
    output,
    generationId: generation.id,
    provider: choice.provider.id,
    model: choice.model,
  };
}
