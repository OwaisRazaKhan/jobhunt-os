import "server-only";
import { getServerEnv } from "@/config/env";
import { DEFAULT_AI_PREFERENCES, type AiPreferencesView } from "./preferences";
import { GeminiProvider } from "./providers/gemini";
import { OllamaProvider } from "./providers/ollama";
import { taskPolicy, type Sensitivity } from "./registry";
import type { AiProvider, AiTask, ModelChoice, ProviderKind } from "./types";

/**
 * Provider router: (task policy × privacy policy × user preferences × configuration) →
 * ordered list of PERMITTED providers. Privacy rules are applied first and cannot be
 * overridden by preferences or request values:
 *
 *   PUBLIC            → Gemini or Ollama (Gemini only if the user allows it for public tasks)
 *   INTERNAL          → Ollama preferred, Gemini allowed
 *   PRIVATE_CANDIDATE → Ollama; Gemini ONLY if AI_ALLOW_PRIVATE_GEMINI=true AND the user opted in
 *   HIGH_SENSITIVITY  → Ollama only
 */

let providerOverride: AiProvider[] | undefined;

/** Tests inject fake providers (local=true fills the Ollama slot, local=false the Gemini slot). */
export function setProvidersForTests(providers: AiProvider[] | undefined): void {
  providerOverride = providers;
}

const providerCache = new Map<string, AiProvider>();

/** Configured providers by slot. Endpoints/keys come only from server configuration. */
export function configuredProviders(): Partial<Record<ProviderKind, ModelChoice>> {
  const env = getServerEnv();
  if (providerOverride) {
    const out: Partial<Record<ProviderKind, ModelChoice>> = {};
    for (const p of providerOverride) {
      const kind: ProviderKind = p.local ? "ollama" : "gemini";
      out[kind] ??= { provider: p, model: kind === "ollama" ? env.OLLAMA_MODEL : env.GEMINI_MODEL };
    }
    return out;
  }
  if (!env.AI_ENABLED) return {};
  const out: Partial<Record<ProviderKind, ModelChoice>> = {};
  const ollamaKey = `ollama|${env.OLLAMA_BASE_URL}|${env.OLLAMA_TIMEOUT_MS}`;
  if (!providerCache.has(ollamaKey))
    providerCache.set(ollamaKey, new OllamaProvider(env.OLLAMA_BASE_URL, env.OLLAMA_TIMEOUT_MS));
  out.ollama = { provider: providerCache.get(ollamaKey)!, model: env.OLLAMA_MODEL };
  if (env.GEMINI_API_KEY) {
    const geminiKey = `gemini|${env.GEMINI_TIMEOUT_MS}|${env.GEMINI_API_KEY.length}`;
    if (!providerCache.has(geminiKey))
      providerCache.set(geminiKey, new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_TIMEOUT_MS));
    out.gemini = { provider: providerCache.get(geminiKey)!, model: env.GEMINI_MODEL };
  }
  return out;
}

export interface RouteStep {
  kind: ProviderKind;
  choice: ModelChoice;
  reason: string;
}

export interface Route {
  task: AiTask;
  sensitivity: Sensitivity;
  steps: RouteStep[];
  /** Providers that exist but were refused, with the reason (for the settings page and errors) */
  denied: { kind: ProviderKind; reason: string }[];
}

/** Privacy decision for one provider slot. Returns a refusal reason or null when permitted. */
export function privacyRefusal(
  kind: ProviderKind,
  sensitivity: Sensitivity,
  prefs: AiPreferencesView,
  allowPrivateCloud: boolean,
): string | null {
  if (kind === "ollama") return null;
  switch (sensitivity) {
    case "PUBLIC":
      return prefs.geminiForPublic ? null : "You turned off Gemini for public tasks.";
    case "INTERNAL":
      return null;
    case "PRIVATE_CANDIDATE":
      if (!allowPrivateCloud)
        return "Private candidate data stays local: cloud processing is disabled on this server.";
      if (!prefs.allowPrivateCloud)
        return "Private candidate data stays local unless you opt in to cloud processing.";
      return null;
    case "HIGH_SENSITIVITY":
      return "Highly sensitive data is processed locally only.";
  }
}

export function resolveRoute(
  task: AiTask,
  prefs: AiPreferencesView = DEFAULT_AI_PREFERENCES,
): Route {
  const env = getServerEnv();
  const policy = taskPolicy(task);
  const configured = configuredProviders();
  const denied: Route["denied"] = [];
  const permitted: ProviderKind[] = [];
  for (const kind of ["ollama", "gemini"] as const) {
    if (!policy.allowedProviders.includes(kind)) continue;
    if (!configured[kind]) {
      if (kind === "gemini" || env.AI_ENABLED)
        denied.push({
          kind,
          reason:
            kind === "gemini" ? "Gemini is not configured (no GEMINI_API_KEY)." : "AI is disabled.",
        });
      continue;
    }
    const refusal = privacyRefusal(kind, policy.sensitivity, prefs, env.AI_ALLOW_PRIVATE_GEMINI);
    if (refusal) denied.push({ kind, reason: refusal });
    else permitted.push(kind);
  }

  const taskDefault: ProviderKind =
    policy.defaultProvider === "public"
      ? env.AI_PUBLIC_PROVIDER
      : policy.defaultProvider === "default"
        ? env.AI_DEFAULT_PROVIDER
        : policy.defaultProvider;
  // Private data defaults to local even if a user prefers Gemini in general (unless opted in).
  const preferred: ProviderKind =
    prefs.primaryProvider === "auto"
      ? policy.sensitivity === "PUBLIC"
        ? taskDefault
        : policy.sensitivity === "PRIVATE_CANDIDATE" && !prefs.allowPrivateCloud
          ? "ollama"
          : taskDefault
      : prefs.primaryProvider;
  const ordered = [...permitted].sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : 0));
  const steps = ordered.map((kind, i) => ({
    kind,
    choice: configured[kind]!,
    reason:
      i === 0
        ? kind === preferred
          ? prefs.primaryProvider === "auto"
            ? `Task default for ${policy.sensitivity.toLowerCase().replace("_", " ")} data`
            : "Your preferred provider"
          : `Only permitted provider (${kind === "ollama" ? "local" : "cloud"})`
        : "Permitted fallback",
  }));
  return { task, sensitivity: policy.sensitivity, steps, denied };
}

/** True when AI is enabled and at least one provider is configured (UI hint only). */
export function isAiConfigured(): boolean {
  return Object.keys(configuredProviders()).length > 0;
}

/** The local provider (used for health display). */
export function primaryProvider(): ModelChoice | null {
  return configuredProviders().ollama ?? null;
}
