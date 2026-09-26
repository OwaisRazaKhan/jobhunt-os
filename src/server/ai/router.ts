import "server-only";
import { getServerEnv } from "@/config/env";
import { OllamaProvider } from "./providers/ollama";
import type { AiProvider, AiTask, ModelChoice } from "./types";

/**
 * Model router: task -> ordered model candidates. Configuration, not call-site
 * logic. Phase 1 registers only the local Ollama provider; cloud adapters can
 * be added later without touching services.
 */
interface TaskPolicy {
  /** Task input contains personal candidate data -> local providers only. */
  personalData: boolean;
}

const TASK_POLICIES: Record<AiTask, TaskPolicy> = {
  "candidate.extract_facts": { personalData: true },
  "matching.semantic_skills": { personalData: true },
};

let providerOverride: AiProvider[] | undefined;

/** Tests inject fake providers. */
export function setProvidersForTests(providers: AiProvider[] | undefined): void {
  providerOverride = providers;
}

function configuredProviders(): AiProvider[] {
  if (providerOverride) return providerOverride;
  const env = getServerEnv();
  if (!env.AI_ENABLED) return [];
  return [new OllamaProvider(env.OLLAMA_BASE_URL, env.OLLAMA_TIMEOUT_MS)];
}

export function resolveModels(task: AiTask): ModelChoice[] {
  const policy = TASK_POLICIES[task];
  const model = getServerEnv().OLLAMA_MODEL;
  return configuredProviders()
    .filter((provider) => !policy.personalData || provider.local)
    .map((provider) => ({ provider, model }));
}

export function isAiConfigured(): boolean {
  return configuredProviders().length > 0;
}

export function primaryProvider(): ModelChoice | null {
  return resolveModels("candidate.extract_facts")[0] ?? null;
}
