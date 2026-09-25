/**
 * Verifies the local Ollama setup used for optional CV extraction.
 *   npm run ai:check
 * Sends only a synthetic test prompt — never candidate data.
 */
try {
  process.loadEnvFile(".env");
} catch {
  // rely on the process environment
}

const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const model = process.env.OLLAMA_MODEL || "llama3.1:8b";

async function main() {
  console.warn(`Checking Ollama at ${baseUrl} (model: ${model})`);
  const tags = await fetch(new URL("/api/tags", baseUrl), {
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  if (!tags?.ok) {
    console.error(
      "✗ Ollama is not reachable. Install it from https://ollama.com and make sure it is running (`ollama serve`).",
    );
    console.error(
      "  The app still works without AI — extraction falls back to rule-based parsing.",
    );
    process.exit(1);
  }
  const { models = [] } = (await tags.json()) as { models?: { name: string }[] };
  const wanted = model.includes(":") ? model : `${model}:latest`;
  if (!models.some((m) => m.name === model || m.name === wanted)) {
    console.error(`✗ Model "${model}" is not installed. Run: ollama pull ${model}`);
    console.error(`  Installed: ${models.map((m) => m.name).join(", ") || "none"}`);
    process.exit(1);
  }
  console.warn("✓ Ollama reachable and model installed. Testing structured output…");
  const started = Date.now();
  const res = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      options: { temperature: 0 },
      format: {
        type: "object",
        properties: { skills: { type: "array", items: { type: "string" } } },
        required: ["skills"],
      },
      messages: [
        { role: "user", content: 'Extract the skills from: "Skills: Excel, Figma". Return JSON.' },
      ],
    }),
  });
  const body = (await res.json()) as { message?: { content?: string } };
  const parsed = JSON.parse(body.message?.content ?? "{}") as { skills?: unknown };
  if (!Array.isArray(parsed.skills)) {
    console.error(
      "✗ The model did not return the expected JSON structure. Try a different model (see docs/setup.md).",
    );
    process.exit(1);
  }
  console.warn(
    `✓ Structured output works (${Date.now() - started} ms): ${JSON.stringify(parsed.skills)}`,
  );
}

main().catch((error) => {
  console.error("✗ AI check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
