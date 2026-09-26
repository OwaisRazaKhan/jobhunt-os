import { describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama";

const request = {
  model: "qwen3.5:9b",
  messages: [{ role: "user" as const, content: "x" }],
  jsonSchema: { type: "object" },
  maxOutputTokens: 256,
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Route-aware fetch mock for the Ollama endpoints. */
function ollama(
  handlers: Partial<
    Record<
      "/api/chat" | "/api/show" | "/api/tags" | "/api/version" | "/api/ps",
      () => Response | Promise<Response>
    >
  >,
) {
  return vi.fn(async (url: URL | string) => {
    const path = new URL(String(url)).pathname as keyof typeof handlers;
    const handler = handlers[path];
    if (!handler) return json({ error: "not mocked" }, 500);
    return handler();
  });
}

describe("OllamaProvider", () => {
  it("posts to /api/chat with the JSON schema as `format`, disables thinking and limits output", async () => {
    const fetchMock = ollama({
      "/api/show": () => json({ capabilities: ["completion", "thinking"] }),
      "/api/chat": () =>
        json({
          model: "qwen3.5:9b",
          message: { content: '{"facts":[]}' },
          prompt_eval_count: 12,
          eval_count: 3,
        }),
    });
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      5000,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.generateStructured(request);
    expect(result).toMatchObject({
      json: { facts: [] },
      usage: { inputTokens: 12, outputTokens: 3 },
      model: "qwen3.5:9b",
    });
    const chat = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/chat")) as unknown as [
      URL,
      RequestInit,
    ];
    const body = JSON.parse(String(chat[1].body));
    expect(body).toMatchObject({
      model: "qwen3.5:9b",
      stream: false,
      format: { type: "object" },
      think: false,
      options: { temperature: 0, num_predict: 256 },
    });
  });

  it("does not send `think` to models without the thinking capability", async () => {
    const fetchMock = ollama({
      "/api/show": () => json({ capabilities: ["completion"] }),
      "/api/chat": () => json({ message: { content: "{}" } }),
    });
    await new OllamaProvider(
      "http://x",
      5000,
      fetchMock as unknown as typeof fetch,
    ).generateStructured(request);
    const chat = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/api/chat")) as unknown as [
      URL,
      RequestInit,
    ];
    expect(JSON.parse(String(chat[1].body))).not.toHaveProperty("think");
  });

  it("classifies failures: offline, missing model, invalid output, timeout", async () => {
    const offline = new OllamaProvider("http://127.0.0.1:1", 5000, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(offline.generateStructured(request)).rejects.toMatchObject({
      code: "AI_ERROR",
      kind: "OFFLINE",
      publicMessage: "The local AI (Ollama) is not running.",
    });

    const missing = new OllamaProvider(
      "http://x",
      5000,
      ollama({
        "/api/show": () => json({}, 404),
        "/api/chat": () =>
          json({ error: 'model "qwen3.5:9b" not found, try pulling it first' }, 404),
      }) as unknown as typeof fetch,
    );
    await expect(missing.generateStructured(request)).rejects.toMatchObject({
      kind: "MODEL_MISSING",
      publicMessage: expect.stringMatching(/not installed/),
    });

    const garbage = new OllamaProvider(
      "http://x",
      5000,
      ollama({
        "/api/show": () => json({}),
        "/api/chat": () => json({ message: { content: "not json" } }),
      }) as unknown as typeof fetch,
    );
    await expect(garbage.generateStructured(request)).rejects.toMatchObject({
      kind: "INVALID_OUTPUT",
    });

    const slow = new OllamaProvider("http://x", 30, ((url: URL, init: RequestInit) =>
      String(url).endsWith("/api/show")
        ? Promise.resolve(json({}))
        : new Promise((_, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            ),
          )) as unknown as typeof fetch);
    await expect(slow.generateStructured(request)).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("health reports version, installed models and whether the configured model exists (never pulls)", async () => {
    const fetchMock = ollama({
      "/api/tags": () => json({ models: [{ name: "qwen3.5:9b", size: 6_594_474_711 }] }),
      "/api/version": () => json({ version: "0.34.4" }),
      "/api/ps": () => json({ models: [] }),
    });
    const provider = new OllamaProvider("http://x", 5000, fetchMock as unknown as typeof fetch);
    expect(await provider.health("qwen3.5:9b")).toMatchObject({
      ok: true,
      modelAvailable: true,
      status: "READY",
      info: { version: "0.34.4", loaded: false },
    });
    expect(await provider.health("llama3.1:8b")).toMatchObject({
      ok: false,
      modelAvailable: false,
      status: "MODEL_MISSING",
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/pull"))).toBe(false);
    const down = new OllamaProvider("http://x", 5000, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(await down.health("qwen3.5:9b")).toMatchObject({ ok: false, status: "OFFLINE" });
  });
});
