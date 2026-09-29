import type { z } from "zod";

/**
 * AI provider contract (docs/ai-architecture.md). Business services never import a provider:
 * they call the orchestrator (orchestrator.ts), which picks a provider per task and privacy
 * policy, validates output and records metadata.
 */

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Provider slot: "ollama" = local/private, "gemini" = cloud/optional. */
export type ProviderKind = "ollama" | "gemini";

interface BaseRequest {
  model: string;
  messages: AiMessage[];
  temperature?: number;
  /** Output token limit (cost/latency control) */
  maxOutputTokens?: number;
  /** Per-request timeout; providers fall back to their configured default */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface StructuredRequest extends BaseRequest {
  /** JSON Schema the provider should constrain output to (derived from Zod). */
  jsonSchema: Record<string, unknown>;
}

export type TextRequest = BaseRequest;

export interface StructuredResponse {
  /** Raw parsed JSON — NOT trusted until validated by the orchestrator. */
  json: unknown;
  usage: TokenUsage;
  model: string;
}

export interface TextResponse {
  text: string;
  usage: TokenUsage;
  model: string;
}

export interface ProviderCapabilities {
  structuredOutput: boolean;
  longContext: boolean;
  local: boolean;
}

export interface ProviderHealth {
  ok: boolean;
  model: string;
  modelAvailable: boolean;
  /** Stable status code (see AiErrorKind) or "READY" */
  status: "READY" | AiErrorKind;
  detail?: string;
  /** Extra non-secret facts (Ollama version, installed models…) */
  info?: Record<string, unknown>;
}

/**
 * Provider adapter contract. Adapters translate to a vendor API and throw AiProviderError with
 * a classified kind. Nothing outside src/server/ai imports an adapter.
 */
export interface AiProvider {
  readonly id: string;
  /** Runs on infrastructure we control (local). Cloud providers are never "local". */
  readonly local: boolean;
  readonly capabilities?: ProviderCapabilities;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
  generateText?(request: TextRequest): Promise<TextResponse>;
  health(model: string): Promise<ProviderHealth>;
}

/** Classified provider failure kinds (shown to users in plain language). */
export const AI_ERROR_KINDS = [
  "NOT_CONFIGURED",
  "OFFLINE",
  "MODEL_MISSING",
  "MODEL_LOADING",
  "INVALID_API_KEY",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "MODEL_UNAVAILABLE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "GENERATION_FAILED",
  "INVALID_OUTPUT",
  "POLICY_DENIED",
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

/** Existing task identifiers (stored in ai_generations.task). See registry.ts. */
export type AiTask =
  | "candidate.extract_facts"
  | "matching.semantic_skills"
  | "research.synthesize"
  | "resume.tailor"
  | "email.generate"
  | "cover_letter.generate"
  | "application.answers"
  | "application.map_fields";

export interface ModelChoice {
  provider: AiProvider;
  model: string;
}

export type ZodSchema<T> = z.ZodType<T>;
