import { describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama";

const request = {
  model: "llama3.1:8b",
  messages: [{ role: "user" as const, content: "x" }],
  jsonSchema: { type: "object" },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OllamaProvider", () => {
  it("posts to /api/chat with the JSON schema as `format` and parses the content", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        model: "llama3.1:8b",
        message: { content: '{"facts":[]}' },
        prompt_eval_count: 12,
        eval_count: 3,
      }),
    );
    const provider = new OllamaProvider(
      "http://127.0.0.1:11434",
      5000,
      fetchMock as unknown as typeof fetch,
    );
    const result = await provider.generateStructured(request);
    expect(result.json).toEqual({ facts: [] });
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "llama3.1:8b", stream: false, format: { type: "object" } });
  });

  it("maps an unreachable server to a friendly AI_ERROR", async () => {
    const provider = new OllamaProvider("http://127.0.0.1:1", 5000, (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      code: "AI_ERROR",
      publicMessage:
        "AI extraction is currently unavailable. You can enter the information manually.",
    });
  });

  it("explains a missing model (HTTP 404) and rejects non-JSON output", async () => {
    const missing = new OllamaProvider("http://x", 5000, (async () =>
      jsonResponse({ error: "model not found" }, 404)) as unknown as typeof fetch);
    await expect(missing.generateStructured(request)).rejects.toMatchObject({
      publicMessage: expect.stringMatching(/not installed/),
    });
    const garbage = new OllamaProvider("http://x", 5000, (async () =>
      jsonResponse({ message: { content: "not json" } })) as unknown as typeof fetch);
    await expect(garbage.generateStructured(request)).rejects.toMatchObject({ code: "AI_ERROR" });
  });

  it("health reports reachability and whether the model is pulled", async () => {
    const ok = new OllamaProvider("http://x", 5000, (async () =>
      jsonResponse({ models: [{ name: "llama3.1:8b" }] })) as unknown as typeof fetch);
    expect(await ok.health("llama3.1:8b")).toMatchObject({ ok: true, modelAvailable: true });
    expect(await ok.health("qwen2.5:7b")).toMatchObject({ ok: true, modelAvailable: false });
    const down = new OllamaProvider("http://x", 5000, (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch);
    expect(await down.health("llama3.1:8b")).toMatchObject({
      ok: false,
      detail: "Ollama is not reachable",
    });
  });
});
