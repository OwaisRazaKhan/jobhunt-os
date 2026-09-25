import "server-only";
import { AppError } from "@/server/errors";
import type { AiProvider, ProviderHealth, StructuredRequest, StructuredResponse } from "../types";

export const AI_UNAVAILABLE_MESSAGE =
  "AI extraction is currently unavailable. You can enter the information manually.";

interface OllamaChatResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Ollama adapter (local, free). Uses /api/chat with `format` set to a JSON
 * Schema so the model is constrained to structured output.
 */
export class OllamaProvider implements AiProvider {
  readonly id = "ollama";
  readonly local = true;

  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generateStructured(request: StructuredRequest): Promise<StructuredResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    request.signal?.addEventListener("abort", () => controller.abort());
    let response: Response;
    try {
      response = await this.fetchImpl(new URL("/api/chat", this.baseUrl), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: request.model,
          messages: request.messages,
          stream: false,
          format: request.jsonSchema,
          options: { temperature: request.temperature ?? 0 },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AppError("AI_ERROR", {
        message: `Ollama unreachable: ${error instanceof Error ? error.name : "error"}`,
        publicMessage: AI_UNAVAILABLE_MESSAGE,
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new AppError("AI_ERROR", {
        message: `Ollama HTTP ${response.status}`,
        publicMessage:
          response.status === 404
            ? "The configured local AI model is not installed. See docs/setup.md."
            : AI_UNAVAILABLE_MESSAGE,
        retryable: response.status >= 500,
      });
    }

    const body = (await response.json()) as OllamaChatResponse;
    const content = body.message?.content ?? "";
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (error) {
      throw new AppError("AI_ERROR", {
        message: "Ollama returned non-JSON output",
        publicMessage: "The AI returned an unreadable result. No facts were saved.",
        cause: error,
      });
    }
    return {
      json,
      model: body.model ?? request.model,
      usage: { inputTokens: body.prompt_eval_count, outputTokens: body.eval_count },
    };
  }

  async health(model: string): Promise<ProviderHealth> {
    try {
      const response = await this.fetchImpl(new URL("/api/tags", this.baseUrl), {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok)
        return { ok: false, model, modelAvailable: false, detail: `HTTP ${response.status}` };
      const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
      const names = (body.models ?? [])
        .flatMap((m) => [m.name, m.model])
        .filter(Boolean) as string[];
      const wanted = model.includes(":") ? model : `${model}:latest`;
      const modelAvailable = names.some((name) => name === model || name === wanted);
      return {
        ok: true,
        model,
        modelAvailable,
        detail: modelAvailable ? undefined : "Model not pulled",
      };
    } catch {
      return { ok: false, model, modelAvailable: false, detail: "Ollama is not reachable" };
    }
  }
}
