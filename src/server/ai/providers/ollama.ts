import "server-only";
import { AiProviderError } from "../errors";
import type {
  AiProvider,
  ProviderCapabilities,
  ProviderHealth,
  StructuredRequest,
  StructuredResponse,
  TextRequest,
  TextResponse,
} from "../types";

export const AI_UNAVAILABLE_MESSAGE =
  "AI extraction is currently unavailable. You can enter the information manually.";

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string; thinking?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Ollama adapter (local, free). /api/chat with `format` = JSON Schema for structured output.
 * Thinking-capable models (e.g. qwen3.5) are called with `think: false` so the answer is the
 * JSON itself. The endpoint comes only from trusted server configuration (never user input),
 * and models are never downloaded automatically.
 */
export class OllamaProvider implements AiProvider {
  readonly id = "ollama";
  readonly local = true;
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    longContext: false,
    local: true,
  };
  private readonly thinking = new Map<string, boolean>();

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** Whether the model advertises "thinking" (cached per model; /api/show). */
  private async supportsThinking(model: string): Promise<boolean> {
    const known = this.thinking.get(model);
    if (known !== undefined) return known;
    try {
      const res = await this.fetchImpl(new URL("/api/show", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(5000),
      });
      const body = res.ok ? ((await res.json()) as { capabilities?: string[] }) : {};
      const value = Array.isArray(body.capabilities) && body.capabilities.includes("thinking");
      this.thinking.set(model, value);
      return value;
    } catch {
      return false;
    }
  }

  private async chat(
    request: TextRequest,
    format?: Record<string, unknown>,
  ): Promise<{ content: string; body: OllamaChatResponse }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? this.timeoutMs);
    request.signal?.addEventListener("abort", () => controller.abort());
    const think = await this.supportsThinking(request.model);
    let response: Response;
    try {
      response = await this.fetchImpl(new URL("/api/chat", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          ...(format ? { format } : {}),
          ...(think ? { think: false } : {}),
          options: {
            temperature: request.temperature ?? 0,
            ...(request.maxOutputTokens ? { num_predict: request.maxOutputTokens } : {}),
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      const aborted =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      throw new AiProviderError(
        aborted ? "TIMEOUT" : "OFFLINE",
        this.id,
        error instanceof Error ? error.name : "error",
        error,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 404 || /not found|pull/i.test(text))
        throw new AiProviderError("MODEL_MISSING", this.id, `HTTP ${response.status}`);
      if (response.status === 503 && /loading/i.test(text))
        throw new AiProviderError("MODEL_LOADING", this.id);
      throw new AiProviderError("GENERATION_FAILED", this.id, `HTTP ${response.status}`);
    }
    const body = (await response.json()) as OllamaChatResponse;
    if (body.error)
      throw new AiProviderError("GENERATION_FAILED", this.id, body.error.slice(0, 200));
    return { content: body.message?.content ?? "", body };
  }

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const { content, body } = await this.chat(request, request.jsonSchema);
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (error) {
      throw new AiProviderError("INVALID_OUTPUT", this.id, "non-JSON output", error);
    }
    return {
      json,
      model: body.model ?? request.model,
      usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
    };
  }

  async generateText(request: TextRequest): Promise<TextResponse> {
    const { content, body } = await this.chat(request);
    return {
      text: content,
      model: body.model ?? request.model,
      usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
    };
  }

  async health(model: string): Promise<ProviderHealth> {
    try {
      const [tags, version, ps] = await Promise.all([
        this.fetchImpl(new URL("/api/tags", this.baseUrl), { signal: AbortSignal.timeout(3000) }),
        this.fetchImpl(new URL("/api/version", this.baseUrl), {
          signal: AbortSignal.timeout(3000),
        }).catch(() => null),
        this.fetchImpl(new URL("/api/ps", this.baseUrl), {
          signal: AbortSignal.timeout(3000),
        }).catch(() => null),
      ]);
      if (!tags.ok)
        return {
          ok: false,
          model,
          modelAvailable: false,
          status: "OFFLINE",
          detail: `HTTP ${tags.status}`,
        };
      const body = (await tags.json()) as {
        models?: Array<{ name?: string; model?: string; size?: number }>;
      };
      const installed = (body.models ?? [])
        .map((m) => ({ name: m.name ?? m.model ?? "", size: m.size ?? 0 }))
        .filter((m) => m.name);
      const wanted = model.includes(":") ? model : `${model}:latest`;
      const modelAvailable = installed.some((m) => m.name === model || m.name === wanted);
      const loaded = ps?.ok
        ? (((await ps.json()) as { models?: Array<{ name?: string }> }).models ?? []).map(
            (m) => m.name,
          )
        : [];
      const ver = version?.ok
        ? ((await version.json()) as { version?: string }).version
        : undefined;
      return {
        ok: modelAvailable,
        model,
        modelAvailable,
        status: modelAvailable ? "READY" : "MODEL_MISSING",
        detail: modelAvailable
          ? undefined
          : "Ollama is running but the configured model is not installed. Install it yourself with `ollama pull` — JOBHUNT OS never downloads models.",
        info: {
          version: ver,
          installed: installed.map((m) => `${m.name} (${(m.size / 1e9).toFixed(1)} GB)`),
          loaded: loaded.includes(model) || loaded.includes(wanted),
        },
      };
    } catch {
      return {
        ok: false,
        model,
        modelAvailable: false,
        status: "OFFLINE",
        detail: "Ollama is not reachable at the configured address.",
      };
    }
  }
}
