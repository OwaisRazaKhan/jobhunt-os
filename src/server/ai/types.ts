import type { z } from "zod";

export interface AiMessage {
  role: "system" | "user";
  content: string;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface StructuredRequest {
  model: string;
  messages: AiMessage[];
  /** JSON Schema the provider should constrain output to (derived from Zod). */
  jsonSchema: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
}

export interface StructuredResponse {
  /** Raw parsed JSON — NOT trusted until validated by the AI service. */
  json: unknown;
  usage: TokenUsage;
  model: string;
}

export interface ProviderHealth {
  ok: boolean;
  model: string;
  modelAvailable: boolean;
  detail?: string;
}

/**
 * Provider adapter contract. Adapters translate to a vendor API and map
 * failures to AppError("AI_ERROR"). Nothing outside src/server/ai imports an adapter.
 */
export interface AiProvider {
  readonly id: string;
  /** Runs on infrastructure we control. Personal data may only go to local providers in Phase 1. */
  readonly local: boolean;
  generateStructured(request: StructuredRequest): Promise<StructuredResponse>;
  health(model: string): Promise<ProviderHealth>;
}

export type AiTask = "candidate.extract_facts";

export interface ModelChoice {
  provider: AiProvider;
  model: string;
}

export type ZodSchema<T> = z.ZodType<T>;
