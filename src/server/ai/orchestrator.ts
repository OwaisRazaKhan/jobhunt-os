import "server-only";
import { z } from "zod";
import { recordAudit } from "@/server/audit";
import { sha256Hex } from "@/server/crypto";
import { withUserContext } from "@/server/db";
import { logger } from "@/server/logger";
import {
  AI_ERROR_MESSAGES,
  aiErrorKind,
  AiProviderError,
  RETRYABLE_KINDS,
  UNAVAILABLE_KINDS,
} from "./errors";
import { getAiPreferences, type AiPreferencesView } from "./preferences";
import {
  loadIdentifiers,
  redactMessages,
  UNTRUSTED_CONTENT_RULE,
  type Identifiers,
} from "./privacy";
import { taskPolicy } from "./registry";
import { configuredProviders, resolveRoute, type Route } from "./router";
import type { AiErrorKind, AiMessage, AiProvider, AiTask, ProviderKind } from "./types";

/**
 * AI Orchestrator — the only entry point business services use for AI.
 *
 *   task → registry policy → privacy policy + user preferences → route (permitted providers)
 *        → [cloud: privacy filter] → provider (bounded retries) → JSON → Zod schema
 *        → metadata record (ai_generations) → caller's reference/fact/business validation
 *
 * Guarantees:
 *  - private candidate data never reaches a cloud provider unless the operator switch AND the
 *    user's explicit opt-in allow it (enforced here, server-side)
 *  - fallback only to another PERMITTED provider and only when the user enabled it;
 *    otherwise the caller's deterministic path runs
 *  - quota/auth/missing-model/policy failures are never retried; retries are bounded
 *  - invalid output is never returned as data; prompts are never stored or logged
 */

export interface RunAiTaskInput<T> {
  userId: string;
  agent: string;
  task: AiTask;
  promptVersion: number;
  messages: AiMessage[];
  schema: z.ZodType<T>;
  traceId?: string;
  signal?: AbortSignal;
}

export type RunAiTaskResult<T> =
  | {
      ok: true;
      output: T;
      generationId: string;
      provider: string;
      model: string;
      providerKind: ProviderKind;
      cached: boolean;
      route: Route;
    }
  | {
      ok: false;
      generationId: string | null;
      error: AiProviderError;
      errorKind: AiErrorKind;
      route: Route;
    };

const log = logger.child({ category: "ai" });
const CACHE_DAYS = 7;

export async function getAiRoute(
  userId: string,
  task: AiTask,
  prefs?: AiPreferencesView,
): Promise<Route> {
  return resolveRoute(task, prefs ?? (await getAiPreferences(userId)));
}

/** Plain-language reason when a task cannot use AI for this user right now (null = routable). */
export function routeUnavailableReason(route: Route): string | null {
  if (route.steps.length) return null;
  return (
    route.denied.find((d) => d.kind === "ollama")?.reason ??
    route.denied[0]?.reason ??
    AI_ERROR_MESSAGES.NOT_CONFIGURED
  );
}

/** Adds the untrusted-content rule to the task's system instructions (before any data). */
function withSecurityRule(messages: AiMessage[]): AiMessage[] {
  const firstSystem = messages.findIndex((m) => m.role === "system");
  if (firstSystem < 0) return [{ role: "system", content: UNTRUSTED_CONTENT_RULE }, ...messages];
  return messages.map((m, i) =>
    i === firstSystem ? { ...m, content: `${m.content}\n\n${UNTRUSTED_CONTENT_RULE}` } : m,
  );
}

async function record(
  userId: string,
  data: {
    agent: string;
    task: AiTask;
    provider: string;
    model: string;
    promptVersion: number;
    inputHash: string;
    output?: unknown;
    status: string;
    errorCode: string | null;
    inputTokens?: number;
    outputTokens?: number;
    latencyMs: number;
    traceId?: string;
    sensitivity: string;
    attempt: number;
    routeReason: string;
  },
) {
  const row = await withUserContext(userId, (t) =>
    t.aiGeneration.create({
      data: {
        userId,
        agent: data.agent,
        task: data.task,
        provider: data.provider,
        model: data.model,
        promptVersion: data.promptVersion,
        promptKey: `${data.task}@v${data.promptVersion}`,
        inputHash: data.inputHash,
        output: data.output === undefined ? undefined : (data.output as object),
        outputHash: data.output === undefined ? null : sha256Hex(JSON.stringify(data.output)),
        status: data.status,
        errorCode: data.errorCode,
        inputTokens: data.inputTokens ?? null,
        outputTokens: data.outputTokens ?? null,
        latencyMs: data.latencyMs,
        traceId: data.traceId ?? null,
        sensitivity: data.sensitivity,
        attempt: data.attempt,
        routeReason: data.routeReason.slice(0, 300),
      },
      select: { id: true },
    }),
  );
  return row.id;
}

export async function runAiTask<T>(input: RunAiTaskInput<T>): Promise<RunAiTaskResult<T>> {
  const policy = taskPolicy(input.task);
  const prefs = await getAiPreferences(input.userId);
  const route = resolveRoute(input.task, prefs);
  if (!route.steps.length) {
    const kind: AiErrorKind =
      route.denied.some(
        (d) => d.reason.includes("not configured") || d.reason.includes("disabled"),
      ) && !route.denied.some((d) => /stays local|opt in|turned off|locally only/.test(d.reason))
        ? "NOT_CONFIGURED"
        : "POLICY_DENIED";
    return {
      ok: false,
      generationId: null,
      error: new AiProviderError(kind, "router", routeUnavailableReason(route) ?? undefined),
      errorKind: kind,
      route,
    };
  }

  const baseMessages = policy.untrustedContent ? withSecurityRule(input.messages) : input.messages;
  const inputHash = sha256Hex(JSON.stringify([input.task, input.promptVersion, input.messages]));
  const jsonSchema = z.toJSONSchema(input.schema) as Record<string, unknown>;

  // Per-user cache: PUBLIC tasks only (never private results, never across users).
  if (policy.cacheable && policy.sensitivity === "PUBLIC") {
    const since = new Date(Date.now() - CACHE_DAYS * 86_400_000);
    const hit = await withUserContext(input.userId, (t) =>
      t.aiGeneration.findFirst({
        where: {
          userId: input.userId,
          task: input.task,
          inputHash,
          promptVersion: input.promptVersion,
          status: "SUCCEEDED",
          createdAt: { gte: since },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    const parsed = hit?.output ? input.schema.safeParse(hit.output) : null;
    if (hit && parsed?.success) {
      log.info("ai generation cache hit", { task: input.task, generationId: hit.id });
      return {
        ok: true,
        output: parsed.data,
        generationId: hit.id,
        provider: hit.provider,
        model: hit.model,
        providerKind: hit.provider === "gemini" ? "gemini" : "ollama",
        cached: true,
        route,
      };
    }
  }

  let identifiers: Identifiers | null = null;
  let attempt = 0;
  let last: { error: AiProviderError; generationId: string | null } | null = null;
  const steps = prefs.autoFallback ? route.steps : route.steps.slice(0, 1);

  for (const [stepIndex, step] of steps.entries()) {
    const { provider, model } = step.choice;
    let messages = baseMessages;
    if (!provider.local) {
      identifiers ??= await loadIdentifiers(input.userId);
      messages = redactMessages(baseMessages, identifiers);
    }
    for (let retry = 0; retry <= policy.maxRetries; retry++) {
      attempt++;
      const started = Date.now();
      let status = "SUCCEEDED";
      let errorCode: string | null = null;
      let output: T | undefined;
      let usage: { inputTokens?: number; outputTokens?: number } = {};
      let failure: AiProviderError | null = null;
      let respondedModel = model;
      try {
        const response = await provider.generateStructured({
          model,
          messages,
          jsonSchema,
          maxOutputTokens: policy.maxOutputTokens,
          timeoutMs: policy.timeoutMs,
          signal: input.signal,
        });
        usage = response.usage;
        respondedModel = response.model || model;
        const parsed = input.schema.safeParse(response.json);
        if (parsed.success) output = parsed.data;
        else {
          status = "SCHEMA_INVALID";
          errorCode = "INVALID_OUTPUT";
          failure = new AiProviderError(
            "INVALID_OUTPUT",
            provider.id,
            `AI output failed schema validation (${parsed.error.issues.length} issues)`,
          );
        }
      } catch (error) {
        const kind = aiErrorKind(error);
        failure =
          error instanceof AiProviderError
            ? error
            : new AiProviderError(kind, provider.id, undefined, error);
        status = kind === "INVALID_OUTPUT" ? "SCHEMA_INVALID" : "FAILED";
        errorCode = kind;
      }
      const latencyMs = Date.now() - started;
      const generationId = await record(input.userId, {
        agent: input.agent,
        task: input.task,
        provider: provider.id,
        model: respondedModel,
        promptVersion: input.promptVersion,
        inputHash,
        output,
        status,
        errorCode,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs,
        traceId: input.traceId,
        sensitivity: policy.sensitivity,
        attempt,
        routeReason:
          retry > 0
            ? `retry ${retry} (${last?.error.kind ?? ""})`
            : stepIndex > 0
              ? `fallback after ${last?.error.kind ?? "failure"}`
              : step.reason,
      });
      log.info("ai generation", {
        generationId,
        task: input.task,
        provider: provider.id,
        model: respondedModel,
        status,
        errorCode,
        latencyMs,
        attempt,
        promptKey: `${input.task}@v${input.promptVersion}`,
        traceId: input.traceId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      });

      if (output !== undefined && !failure) {
        return {
          ok: true,
          output,
          generationId,
          provider: provider.id,
          model: respondedModel,
          providerKind: step.kind,
          cached: false,
          route,
        };
      }
      last = { error: failure!, generationId };
      if (failure!.kind === "INVALID_OUTPUT") break; // never retried or re-routed: the caller's deterministic path runs
      if (!RETRYABLE_KINDS.has(failure!.kind) || retry === policy.maxRetries) break;
    }
    if (!last || !UNAVAILABLE_KINDS.has(last.error.kind)) break;
  }
  return {
    ok: false,
    generationId: last?.generationId ?? null,
    error: last!.error,
    errorKind: last!.error.kind,
    route,
  };
}

/**
 * Settings "Test" button: a tiny, non-personal structured request to ONE provider, recorded like
 * any generation (task "system.provider_test"). Never uses candidate data.
 */
export async function testProvider(userId: string, kind: ProviderKind) {
  const choice = configuredProviders()[kind];
  if (!choice)
    return {
      ok: false as const,
      kind: "NOT_CONFIGURED" as AiErrorKind,
      message: AI_ERROR_MESSAGES.NOT_CONFIGURED,
      latencyMs: 0,
      model: null,
    };
  const schema = z.strictObject({ status: z.literal("ok"), word: z.string().min(1).max(20) });
  const started = Date.now();
  let result:
    | { ok: true; latencyMs: number; model: string; output: unknown }
    | { ok: false; kind: AiErrorKind; message: string; latencyMs: number; model: string };
  try {
    const response = await choice.provider.generateStructured({
      model: choice.model,
      messages: [
        { role: "system", content: "You are a health check. Reply with JSON only." },
        { role: "user", content: 'Return {"status":"ok","word":"pong"}.' },
      ],
      jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
      maxOutputTokens: 64,
      timeoutMs: kind === "ollama" ? 180_000 : 30_000,
    });
    const parsed = schema.safeParse(response.json);
    result = parsed.success
      ? { ok: true, latencyMs: Date.now() - started, model: response.model, output: parsed.data }
      : {
          ok: false,
          kind: "INVALID_OUTPUT",
          message: AI_ERROR_MESSAGES.INVALID_OUTPUT,
          latencyMs: Date.now() - started,
          model: choice.model,
        };
  } catch (error) {
    const k = aiErrorKind(error);
    result = {
      ok: false,
      kind: k,
      message: error instanceof AiProviderError ? error.publicMessage : AI_ERROR_MESSAGES[k],
      latencyMs: Date.now() - started,
      model: choice.model,
    };
  }
  await withUserContext(userId, async (t) => {
    await t.aiGeneration.create({
      data: {
        userId,
        agent: "SYSTEM",
        task: "system.provider_test",
        provider: choice.provider.id,
        model: result.model,
        promptVersion: 1,
        promptKey: "system.provider_test@v1",
        inputHash: sha256Hex("provider-test-v1"),
        status: result.ok ? "SUCCEEDED" : "FAILED",
        errorCode: result.ok ? null : result.kind,
        latencyMs: result.latencyMs,
        sensitivity: "PUBLIC",
        routeReason: "Manual provider test from AI settings",
      },
    });
    await recordAudit(t, {
      userId,
      action: "ai_provider_tested",
      resourceType: "ai_provider",
      resourceId: choice.provider.id,
      metadata: {
        ok: result.ok,
        kind: result.ok ? null : result.kind,
        latencyMs: result.latencyMs,
      },
    });
  });
  log.info("ai provider test", {
    provider: choice.provider.id,
    model: result.model,
    ok: result.ok,
    kind: result.ok ? undefined : result.kind,
    latencyMs: result.latencyMs,
  });
  return result;
}

export async function recentAiActivity(userId: string, take = 12) {
  return withUserContext(userId, (t) =>
    t.aiGeneration.findMany({
      where: { userId },
      select: {
        id: true,
        task: true,
        provider: true,
        model: true,
        status: true,
        errorCode: true,
        latencyMs: true,
        sensitivity: true,
        attempt: true,
        routeReason: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
  );
}

// --- Provider health (cached briefly so pages do not hammer providers) --------------------

const HEALTH_TTL_MS = 30_000;
const healthCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<AiProvider["health"]>> }
>();

/** Real health checks of the configured providers (Ollama: tags/version/ps; Gemini: model metadata, no tokens). */
export async function providerStatuses(opts: { fresh?: boolean } = {}) {
  const configured = configuredProviders();
  const out: Partial<
    Record<
      ProviderKind,
      {
        id: string;
        model: string;
        local: boolean;
        health: Awaited<ReturnType<AiProvider["health"]>>;
      }
    >
  > = {};
  await Promise.all(
    (
      Object.entries(configured) as [ProviderKind, NonNullable<(typeof configured)[ProviderKind]>][]
    ).map(async ([kind, choice]) => {
      const key = `${kind}|${choice.model}`;
      const cached = healthCache.get(key);
      const health =
        !opts.fresh && cached && Date.now() - cached.at < HEALTH_TTL_MS
          ? cached.value
          : await choice.provider.health(choice.model);
      healthCache.set(key, { at: Date.now(), value: health });
      out[kind] = {
        id: choice.provider.id,
        model: choice.model,
        local: choice.provider.local,
        health,
      };
    }),
  );
  return out;
}
