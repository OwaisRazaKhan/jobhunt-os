import "server-only";
import { ApiError, GoogleGenAI } from "@google/genai";
import { AiProviderError, redactSecrets } from "../errors";
import type {
  AiErrorKind,
  AiMessage,
  AiProvider,
  ProviderCapabilities,
  ProviderHealth,
  StructuredRequest,
  StructuredResponse,
  TextRequest,
  TextResponse,
} from "../types";

/**
 * Google Gemini adapter (optional cloud provider, official @google/genai SDK).
 *  - server-only; the API key is read from env and never logged, returned or stored
 *  - structured output via responseMimeType=application/json + responseJsonSchema
 *  - errors classified (invalid key, quota, rate limit, model unavailable, timeout …);
 *    the SDK is created without retries so quota errors never loop
 */

type ModelsApi = Pick<GoogleGenAI["models"], "generateContent" | "get">;

/**
 * Gemini 3.x models think before answering and thinking tokens count toward maxOutputTokens.
 * Each task limit is for the ANSWER, so this headroom is added (a 64-token limit otherwise
 * returns an empty, truncated response).
 */
export const GEMINI_THINKING_HEADROOM = 2048;

/** JSON Schema keys Gemini's responseJsonSchema does not need/accept. */
function cleanSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => k !== "$schema" && k !== "$id")
        .map(([k, v]) => [k, cleanSchema(v)]),
    );
  }
  return value;
}

function split(messages: AiMessage[]) {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const user = messages
    .filter((m) => m.role === "user")
    .map((m) => m.content)
    .join("\n\n");
  return { system, user };
}

export class GeminiProvider implements AiProvider {
  readonly id = "gemini";
  readonly local = false;
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    longContext: true,
    local: false,
  };
  private readonly models: ModelsApi;

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number,
    models?: ModelsApi,
  ) {
    // retryOptions.attempts = 1: the SDK would otherwise retry 429 (quota) up to 5 times.
    // Retries are decided by the orchestrator's bounded policy instead.
    this.models =
      models ??
      new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      }).models;
  }

  private classify(error: unknown): AiProviderError {
    if (error instanceof AiProviderError) return error;
    const message = redactSecrets(error instanceof Error ? error.message : String(error), [
      this.apiKey,
    ]);
    const status =
      error instanceof ApiError ? error.status : (error as { status?: number })?.status;
    let kind: AiErrorKind = "GENERATION_FAILED";
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /timed? ?out|deadline/i.test(message))
    )
      kind = "TIMEOUT";
    else if (status === 400 && /api key|API_KEY_INVALID/i.test(message)) kind = "INVALID_API_KEY";
    else if (status === 401 || status === 403)
      kind = /api key|permission|unauthenticated|API_KEY/i.test(message)
        ? "INVALID_API_KEY"
        : "MODEL_UNAVAILABLE";
    else if (status === 404) kind = "MODEL_UNAVAILABLE";
    else if (status === 429)
      kind = /quota|RESOURCE_EXHAUSTED|billing/i.test(message) ? "QUOTA_EXCEEDED" : "RATE_LIMITED";
    else if (status === 503 || /high demand|overloaded|UNAVAILABLE/.test(message))
      kind = "RATE_LIMITED";
    else if (status && status >= 500) kind = "GENERATION_FAILED";
    else if (
      !status &&
      /fetch failed|ENOTFOUND|ECONNRESET|ECONNREFUSED|network|EAI_AGAIN/i.test(message)
    )
      kind = "NETWORK_ERROR";
    return new AiProviderError(kind, this.id, `${status ?? ""} ${message}`.trim().slice(0, 300));
  }

  private async call(request: TextRequest, jsonSchema?: Record<string, unknown>) {
    const { system, user } = split(request.messages);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    request.signal?.addEventListener("abort", () => controller.abort());
    try {
      return await this.models.generateContent({
        model: request.model,
        contents: [{ role: "user", parts: [{ text: user }] }],
        config: {
          ...(system ? { systemInstruction: system } : {}),
          temperature: request.temperature ?? 0,
          ...(request.maxOutputTokens
            ? { maxOutputTokens: request.maxOutputTokens + GEMINI_THINKING_HEADROOM }
            : {}),
          ...(jsonSchema
            ? { responseMimeType: "application/json", responseJsonSchema: cleanSchema(jsonSchema) }
            : {}),
          abortSignal: controller.signal,
        },
      });
    } catch (error) {
      if (controller.signal.aborted) throw new AiProviderError("TIMEOUT", this.id);
      throw this.classify(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const response = await this.call(request, request.jsonSchema);
    const text = response.text ?? "";
    if (!text && response.candidates?.[0]?.finishReason === "MAX_TOKENS") {
      throw new AiProviderError(
        "INVALID_OUTPUT",
        this.id,
        "output limit reached before an answer (thinking tokens)",
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new AiProviderError("INVALID_OUTPUT", this.id, "non-JSON output", error);
    }
    return {
      json,
      model: response.modelVersion ?? request.model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  async generateText(request: TextRequest): Promise<TextResponse> {
    const response = await this.call(request);
    return {
      text: response.text ?? "",
      model: response.modelVersion ?? request.model,
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount,
        outputTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  /** Metadata call only (no generation, no tokens): verifies key + model access. */
  async health(model: string): Promise<ProviderHealth> {
    try {
      const info = await this.models.get({ model });
      return {
        ok: true,
        model,
        modelAvailable: true,
        status: "READY",
        info: {
          displayName: info.displayName,
          inputTokenLimit: info.inputTokenLimit,
          outputTokenLimit: info.outputTokenLimit,
        },
      };
    } catch (error) {
      const e = this.classify(error);
      return { ok: false, model, modelAvailable: false, status: e.kind, detail: e.publicMessage };
    }
  }
}
