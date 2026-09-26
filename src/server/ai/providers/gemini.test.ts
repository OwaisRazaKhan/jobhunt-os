import { ApiError } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { GeminiProvider } from "./gemini";

const KEY = "test-key-0123456789abcdefghijklmnop";
const request = {
  model: "gemini-3.8-flash",
  messages: [
    { role: "system" as const, content: "rules" },
    { role: "user" as const, content: "data" },
  ],
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: { a: { type: "string" } },
  },
  maxOutputTokens: 128,
};

function models(overrides: {
  generateContent?: (...a: unknown[]) => unknown;
  get?: (...a: unknown[]) => unknown;
}) {
  return {
    generateContent: vi.fn(overrides.generateContent ?? (async () => ({ text: '{"a":"b"}' }))),
    get: vi.fn(overrides.get ?? (async () => ({ displayName: "Gemini" }))),
  };
}

const apiError = (status: number, message: string) => new ApiError({ status, message });

describe("GeminiProvider", () => {
  it("uses native structured output (JSON schema, no $schema), system instruction and output limit", async () => {
    const m = models({
      generateContent: async () => ({
        text: '{"a":"b"}',
        modelVersion: "gemini-3.8-flash",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4 },
      }),
    });
    const provider = new GeminiProvider(KEY, 5000, m as never);
    const out = await provider.generateStructured(request);
    expect(out).toMatchObject({ json: { a: "b" }, usage: { inputTokens: 10, outputTokens: 4 } });
    const call = m.generateContent.mock.calls[0]![0] as {
      model: string;
      contents: unknown;
      config: Record<string, unknown>;
    };
    expect(call.model).toBe("gemini-3.8-flash");
    expect(call.config).toMatchObject({
      systemInstruction: "rules",
      responseMimeType: "application/json",
      maxOutputTokens: 128 + 2048,
      temperature: 0,
    });
    expect(call.config.responseJsonSchema).toEqual({
      type: "object",
      properties: { a: { type: "string" } },
    });
    expect(JSON.stringify(call.contents)).toContain("data");
    expect(JSON.stringify(call.contents)).not.toContain("rules");
  });

  it.each([
    [apiError(400, "API key not valid. Please pass a valid API key."), "INVALID_API_KEY"],
    [apiError(403, "Permission denied: API key"), "INVALID_API_KEY"],
    [
      apiError(429, "Resource has been exhausted (e.g. check quota). RESOURCE_EXHAUSTED"),
      "QUOTA_EXCEEDED",
    ],
    [apiError(429, "Too many requests"), "RATE_LIMITED"],
    [apiError(404, "models/gemini-9 is not found"), "MODEL_UNAVAILABLE"],
    [apiError(503, "This model is currently experiencing high demand."), "RATE_LIMITED"],
    [apiError(500, "Internal error"), "GENERATION_FAILED"],
    [new TypeError("fetch failed"), "NETWORK_ERROR"],
  ])("classifies %s as %s", async (error, kind) => {
    const provider = new GeminiProvider(
      KEY,
      5000,
      models({
        generateContent: async () => {
          throw error;
        },
      }) as never,
    );
    await expect(provider.generateStructured(request)).rejects.toMatchObject({ kind });
  });

  it("never leaks the API key in error messages", async () => {
    const provider = new GeminiProvider(
      KEY,
      5000,
      models({
        generateContent: async () => {
          throw apiError(400, `API key not valid: ${KEY} ?key=${KEY}`);
        },
      }) as never,
    );
    const error = await provider
      .generateStructured(request)
      .catch((e) => e as Error & { publicMessage: string });
    expect(error.message).not.toContain(KEY);
    expect(error.publicMessage).not.toContain(KEY);
  });

  it("reports a thinking-truncated empty answer as invalid output", async () => {
    const provider = new GeminiProvider(
      KEY,
      5000,
      models({
        generateContent: async () => ({ text: "", candidates: [{ finishReason: "MAX_TOKENS" }] }),
      }) as never,
    );
    await expect(provider.generateStructured(request)).rejects.toMatchObject({
      kind: "INVALID_OUTPUT",
      message: expect.stringContaining("output limit"),
    });
  });

  it("rejects non-JSON output and times out", async () => {
    await expect(
      new GeminiProvider(
        KEY,
        5000,
        models({ generateContent: async () => ({ text: "prose" }) }) as never,
      ).generateStructured(request),
    ).rejects.toMatchObject({ kind: "INVALID_OUTPUT" });
    const slow = models({
      generateContent: (p: unknown) =>
        new Promise((_, reject) =>
          (p as { config: { abortSignal: AbortSignal } }).config.abortSignal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
          ),
        ),
    });
    await expect(
      new GeminiProvider(KEY, 20, slow as never).generateStructured(request),
    ).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("health uses model metadata only (no generation) and classifies failures", async () => {
    const ok = models({});
    expect(
      await new GeminiProvider(KEY, 5000, ok as never).health("gemini-3.8-flash"),
    ).toMatchObject({ ok: true, status: "READY" });
    expect(ok.generateContent).not.toHaveBeenCalled();
    const bad = models({
      get: async () => {
        throw apiError(400, "API key not valid");
      },
    });
    expect(
      await new GeminiProvider(KEY, 5000, bad as never).health("gemini-3.8-flash"),
    ).toMatchObject({ ok: false, status: "INVALID_API_KEY" });
  });
});
