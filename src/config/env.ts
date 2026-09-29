import "server-only";
import { z } from "zod";

/**
 * Server environment contract. The single place that reads process.env.
 * Phase 1 runs entirely on free infrastructure: Supabase (Postgres + Storage)
 * and an optional local Ollama. No paid API key is required.
 */
const optionalString = z
  .string()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const optionalUrl = optionalString.pipe(z.url().optional());

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Database (Supabase Postgres). DATABASE_URL = runtime (pooler), DIRECT_URL = migrations.
  DATABASE_URL: optionalUrl,
  DIRECT_URL: optionalUrl,
  /** Connections per server instance. Use 1 for the single-session local PGlite server. */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  // Auth (Better Auth)
  BETTER_AUTH_SECRET: optionalString.pipe(z.string().min(32).optional()),
  BETTER_AUTH_URL: optionalUrl,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,

  // Field-level encryption for contact details (32 random bytes, base64)
  ENCRYPTION_KEY: optionalString,

  // Supabase Storage (service role key is server-only)
  SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.string().min(3).default("candidate-documents"),
  /** Dev-only fallback when Supabase Storage is not configured. */
  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),

  // Local AI (optional). The app works fully without it.
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  OLLAMA_BASE_URL: z.url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("llama3.1:8b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  /**
   * Upper bound for Ollama's context window (prompt + output tokens). Ollama defaults to 4096,
   * which silently truncates long structured outputs (e.g. a full CV). Each request asks only
   * for what it needs, up to this cap.
   */
  OLLAMA_NUM_CTX: z.coerce.number().int().min(2048).max(262_144).default(16_384),
  /** Provider for tasks without a stronger preference. Private candidate data always stays local by default. */
  AI_DEFAULT_PROVIDER: z.enum(["ollama", "gemini"]).default("ollama"),
  /** Preferred provider for PUBLIC-only tasks (e.g. research synthesis over public sources). */
  AI_PUBLIC_PROVIDER: z.enum(["ollama", "gemini"]).default("gemini"),
  /**
   * Operator master switch. Private candidate data may reach Gemini only when this is "true"
   * AND the user explicitly opts in on the AI settings page. Default: false (local only).
   */
  AI_ALLOW_PRIVATE_GEMINI: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Google Gemini (optional cloud provider). The key is server-only — never NEXT_PUBLIC_.
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: z.string().min(1).default("gemini-3.8-flash"),
  GEMINI_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

  // Scheduled discovery (Phase 2 CP14). Shared secret for the internal cron endpoint;
  // unset = the endpoint is disabled. Generate 32+ random bytes; never NEXT_PUBLIC_.
  CRON_SECRET: optionalString.pipe(z.string().min(32).optional()),
  /** Due profiles started per cron invocation (runs execute one after another). */
  CRON_MAX_PROFILES: z.coerce.number().int().min(1).max(20).default(5),

  // Research (Phase 5). Free-first: no search provider is required. Optional self-hosted SearXNG
  // instance for public web discovery (JSON API enabled). Operator config — never user input.
  SEARXNG_URL: optionalUrl,
  RESEARCH_REQUESTS_PER_MINUTE: z.coerce.number().int().min(1).max(120).default(30),
  RESEARCH_REQUESTS_PER_HOUR: z.coerce.number().int().min(1).max(5000).default(300),
  RESEARCH_PER_HOST_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(12),
  RESEARCH_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(10_000_000)
    .default(1_500_000),

  // Application Engine (Phase 8). Browser automation is OFF unless explicitly enabled; it never
  // bypasses CAPTCHA, 2FA, sign-in or anti-bot checks. The browser is the locally installed Edge/Chrome.
  APPLICATION_AUTOMATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  APPLICATION_BROWSER_HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Installed browser used by playwright-core: msedge | chrome | chromium */
  APPLICATION_BROWSER_CHANNEL: z.enum(["msedge", "chrome", "chromium"]).default("msedge"),
  /** Whole attempt budget (includes waiting for your input) */
  APPLICATION_WORKER_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(30_000)
    .max(3_600_000)
    .default(900_000),
  /** Page load / form discovery / field interaction / upload */
  APPLICATION_STEP_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(120_000).default(30_000),
  /** Waiting for a confirmation page after submit (then: SUBMISSION_UNCERTAIN, never a resubmit) */
  APPLICATION_CONFIRMATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(2_000)
    .max(120_000)
    .default(20_000),
  /** Controlled local test fixture origin (e.g. http://127.0.0.1:4010) — never set in production */
  APPLICATION_FIXTURE_ORIGIN: z.url().optional(),

  // Upload limits
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** Pure parser — exported for tests. Throws with every invalid key listed. */
export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const keys = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    // Only key names are reported — never values, which may be secrets.
    throw new Error(`Invalid server environment variables: ${keys}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** For tests only. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
