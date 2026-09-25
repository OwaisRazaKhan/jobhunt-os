import "server-only";

/**
 * Guarded HTTP client for job-source adapters.
 *
 * SSRF protection by construction: requests may only go to an explicit
 * allow-list of provider API hosts over HTTPS. Adapters build URLs from
 * validated board identifiers; user input never supplies a host.
 *
 * Resource limits: per-request timeout, maximum response size (streamed and
 * aborted when exceeded), bounded retries with exponential backoff + jitter.
 * Retries ONLY for transient failures (network, timeout, 429, 5xx). Never for
 * 400/401/403/404 or other client errors (auth, blocked, not found, terms).
 */

export const ALLOWED_HOSTS = new Set([
  "api.ashbyhq.com",
  "api.lever.co",
  "api.eu.lever.co",
  "boards-api.greenhouse.io",
]);

export const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;
const USER_AGENT = "JOBHUNT-OS/0.1 (personal job-search assistant; respects provider rate limits)";

export type FetchErrorKind =
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP_CLIENT"
  | "HTTP_SERVER"
  | "RATE_LIMITED"
  | "TOO_LARGE"
  | "INVALID_JSON"
  | "BLOCKED_HOST";

export class SourceFetchError extends Error {
  constructor(
    readonly kind: FetchErrorKind,
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "SourceFetchError";
  }
}

export interface FetchOptions {
  timeoutMs: number;
  maxRetries?: number;
  maxBytes?: number;
  signal?: AbortSignal;
  /** Called before every attempt (rate limiting). */
  beforeRequest?: () => Promise<void>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function assertAllowedUrl(url: string): URL {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOSTS.has(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    throw new SourceFetchError("BLOCKED_HOST", `Host not allowed: ${parsed.hostname}`);
  }
  return parsed;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes)
    throw new SourceFetchError("TOO_LARGE", `Response too large (${declared} bytes)`);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new SourceFetchError("TOO_LARGE", `Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

function backoffMs(attempt: number, retryAfter: string | null): number {
  const header = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, 30_000);
  const base = 500 * 2 ** attempt;
  return Math.min(base + Math.floor(Math.random() * 250), 8_000);
}

/** GET JSON from an allow-listed provider API with limits and controlled retries. */
export async function fetchJson(url: string, options: FetchOptions): Promise<unknown> {
  assertAllowedUrl(url);
  const maxRetries = options.maxRetries ?? 2;
  const maxBytes = options.maxBytes ?? MAX_RESPONSE_BYTES;
  const doFetch = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: SourceFetchError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) throw new SourceFetchError("TIMEOUT", "Sync aborted");
    await options.beforeRequest?.();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort);
    let retryAfter: string | null = null;
    try {
      const response = await doFetch(url, {
        method: "GET",
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.ok) {
        const text = await readLimited(response, maxBytes);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          throw new SourceFetchError("INVALID_JSON", "Provider returned invalid JSON");
        }
      }
      retryAfter = response.headers.get("retry-after");
      await response.body?.cancel();
      if (response.status === 429) {
        lastError = new SourceFetchError(
          "RATE_LIMITED",
          "Provider rate limit (HTTP 429)",
          429,
          true,
        );
      } else if (response.status >= 500) {
        lastError = new SourceFetchError(
          "HTTP_SERVER",
          `Provider error (HTTP ${response.status})`,
          response.status,
          true,
        );
      } else {
        // 400/401/403/404 etc.: not transient — never retried.
        const reason =
          response.status === 404
            ? "Board not found (HTTP 404) — check the identifier"
            : response.status === 401 || response.status === 403
              ? `Access denied (HTTP ${response.status})`
              : `Request rejected (HTTP ${response.status})`;
        throw new SourceFetchError("HTTP_CLIENT", reason, response.status, false);
      }
    } catch (error) {
      if (error instanceof SourceFetchError) {
        if (!error.retryable) throw error;
        lastError = error;
      } else if (controller.signal.aborted && !options.signal?.aborted) {
        lastError = new SourceFetchError(
          "TIMEOUT",
          `Timed out after ${options.timeoutMs} ms`,
          undefined,
          true,
        );
      } else if (options.signal?.aborted) {
        throw new SourceFetchError("TIMEOUT", "Sync aborted");
      } else {
        const code = (error as { cause?: { code?: string } })?.cause?.code;
        lastError = new SourceFetchError(
          "NETWORK",
          `Network error${code ? ` (${code})` : ""}`,
          undefined,
          true,
        );
      }
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
    if (attempt < maxRetries) await sleep(backoffMs(attempt, retryAfter));
  }
  throw lastError ?? new SourceFetchError("NETWORK", "Request failed");
}
