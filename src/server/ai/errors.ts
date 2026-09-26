import { AppError } from "@/server/errors";
import type { AiErrorKind } from "./types";

/** Plain-language messages for every classified failure (never technical jargon or secrets). */
export const AI_ERROR_MESSAGES: Record<AiErrorKind, string> = {
  NOT_CONFIGURED: "This AI provider is not configured.",
  OFFLINE: "The local AI (Ollama) is not running.",
  MODEL_MISSING: "Ollama is running but the configured model is not installed.",
  MODEL_LOADING: "The local AI model is still loading. Try again in a moment.",
  INVALID_API_KEY: "The Gemini API key was rejected. Check GEMINI_API_KEY.",
  QUOTA_EXCEEDED:
    "The Gemini API quota is exhausted for now (API usage is billed/limited separately from Google consumer plans).",
  RATE_LIMITED: "The AI provider is busy or rate-limiting requests right now. Try again shortly.",
  MODEL_UNAVAILABLE: "The configured Gemini model is not available for this API key.",
  NETWORK_ERROR: "The AI provider could not be reached (network error).",
  TIMEOUT: "The AI provider did not answer in time.",
  GENERATION_FAILED: "AI generation could not be completed because the provider returned an error.",
  INVALID_OUTPUT: "The AI returned data in an unexpected format, so it was not used.",
  POLICY_DENIED: "Your privacy settings do not allow any configured AI provider for this task.",
};

/** Kinds worth a (bounded) retry. Quota, auth, missing models and policy denials never retry. */
export const RETRYABLE_KINDS: ReadonlySet<AiErrorKind> = new Set([
  "TIMEOUT",
  "NETWORK_ERROR",
  "GENERATION_FAILED",
  "MODEL_LOADING",
]);

/** Kinds meaning "this provider is not usable right now" — a permitted fallback provider may be tried. */
export const UNAVAILABLE_KINDS: ReadonlySet<AiErrorKind> = new Set([
  "NOT_CONFIGURED",
  "OFFLINE",
  "MODEL_MISSING",
  "MODEL_LOADING",
  "INVALID_API_KEY",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
  "MODEL_UNAVAILABLE",
  "NETWORK_ERROR",
  "TIMEOUT",
  "GENERATION_FAILED",
]);

export class AiProviderError extends AppError {
  readonly kind: AiErrorKind;
  readonly provider: string;
  constructor(kind: AiErrorKind, provider: string, detail?: string, cause?: unknown) {
    super("AI_ERROR", {
      message: `[${provider}] ${kind}${detail ? `: ${detail}` : ""}`,
      publicMessage: AI_ERROR_MESSAGES[kind],
      retryable: RETRYABLE_KINDS.has(kind),
      cause,
    });
    this.kind = kind;
    this.provider = provider;
  }
}

export function aiErrorKind(error: unknown): AiErrorKind {
  if (error instanceof AiProviderError) return error.kind;
  return "GENERATION_FAILED";
}

/** Removes a secret (and common key patterns) from text before it can reach logs or the UI. */
export function redactSecrets(text: string, secrets: (string | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[REDACTED]");
  return out
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]");
}
