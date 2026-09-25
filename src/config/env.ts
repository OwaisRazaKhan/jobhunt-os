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
