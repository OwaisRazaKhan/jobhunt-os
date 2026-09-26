import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import type { Readable } from "node:stream";
import zlib from "node:zlib";
import { checkPublicHttpUrl } from "@/lib/safe-url";
import { isPrivateAddress } from "./ip";

/**
 * SSRF-safe page fetcher for public research sources.
 *
 *  - URL syntax: only http(s), no credentials, no IP literals, no local/internal names, default ports only
 *    (src/lib/safe-url.ts).
 *  - DNS: every resolved address is checked BEFORE connecting, inside the socket's own lookup, so a
 *    hostname cannot resolve to a private / loopback / link-local / metadata address (no rebinding gap).
 *  - Redirects are followed manually (max 4), and every hop is re-validated.
 *  - Response size is capped while streaming (compressed AND decompressed), with a hard timeout.
 *  - Only text/html, application/xhtml+xml and text/plain are read. Nothing is ever executed.
 */

export const DEFAULT_MAX_BYTES = 1_500_000;
export const MAX_REDIRECTS = 4;
export const USER_AGENT =
  "JOBHUNT-OS-Research/0.1 (personal job-search assistant; respects robots.txt and rate limits)";

export type ResearchFetchErrorKind =
  | "UNSAFE_URL"
  | "BLOCKED"
  | "NOT_FOUND"
  | "HTTP_CLIENT"
  | "HTTP_SERVER"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "TOO_LARGE"
  | "UNSUPPORTED_TYPE"
  | "TOO_MANY_REDIRECTS"
  | "ROBOTS_DISALLOWED"
  | "LIMIT_REACHED";

/** Retry only transient failures; never 401/403/404, blocks, CAPTCHA, unsafe or invalid URLs. */
const RETRYABLE: ReadonlySet<ResearchFetchErrorKind> = new Set([
  "HTTP_SERVER",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK",
]);

export class ResearchFetchError extends Error {
  constructor(
    readonly kind: ResearchFetchErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ResearchFetchError";
  }
  get retryable() {
    return RETRYABLE.has(this.kind);
  }
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
  lastModified: string | null;
}

export interface PageFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: "html" | "text";
}

export type PageFetcher = (url: string, options?: PageFetchOptions) => Promise<FetchedPage>;

/** URL check used before every hop: public http(s), default port only. */
export function assertSafeUrl(input: string): URL {
  const check = checkPublicHttpUrl(input);
  if (!check.ok) throw new ResearchFetchError("UNSAFE_URL", check.reason);
  if (check.url.port && !["80", "443"].includes(check.url.port))
    throw new ResearchFetchError("UNSAFE_URL", "Only default web ports are allowed");
  return check.url;
}

type LookupFn = typeof dnsLookup;

/** DNS lookup that refuses any private / reserved address (used by the socket itself). */
export function makeSafeLookup(resolve: LookupFn = dnsLookup) {
  return ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === "function" ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address?: string | LookupAddress[],
      family?: number,
    ) => void;
    const opts = (typeof options === "object" && options ? options : {}) as { all?: boolean };
    resolve(hostname, { all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = addresses as LookupAddress[];
      if (!list.length || list.some((a) => isPrivateAddress(a.address))) {
        const blocked = new Error(`Blocked address for ${hostname}`) as NodeJS.ErrnoException;
        blocked.code = "EBLOCKEDADDRESS";
        return cb(blocked);
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as LookupFn;
}

const safeLookup = makeSafeLookup();

/** Read a stream with a byte cap (throws TOO_LARGE as soon as the cap is exceeded). */
export async function readLimited(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buf.byteLength;
    if (total > maxBytes) {
      stream.destroy();
      throw new ResearchFetchError("TOO_LARGE", `Response exceeded ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

const TEXT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

function looksLikeChallenge(status: number, headers: http.IncomingHttpHeaders) {
  return (
    headers["cf-mitigated"] === "challenge" ||
    (status === 503 &&
      String(headers["server"] ?? "")
        .toLowerCase()
        .includes("cloudflare"))
  );
}

function requestOnce(url: URL, timeoutMs: number, maxBytes: number, accept: string) {
  return new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer | null;
  }>((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        headers: {
          "user-agent": USER_AGENT,
          accept,
          "accept-encoding": "gzip, deflate, br",
          "accept-language": "en",
        },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: null });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return resolve({ status, headers: res.headers, body: null });
        }
        const type = String(res.headers["content-type"] ?? "").toLowerCase();
        if (!TEXT_TYPES.some((t) => type.includes(t))) {
          res.destroy();
          return reject(
            new ResearchFetchError(
              "UNSUPPORTED_TYPE",
              `Unsupported content type: ${type || "none"}`,
            ),
          );
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(
            new ResearchFetchError("TOO_LARGE", `Response too large (${declared} bytes)`),
          );
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream: Readable =
          encoding === "gzip"
            ? res.pipe(zlib.createGunzip())
            : encoding === "deflate"
              ? res.pipe(zlib.createInflate())
              : encoding === "br"
                ? res.pipe(zlib.createBrotliDecompress())
                : res;
        readLimited(stream, maxBytes)
          .then((body) => resolve({ status, headers: res.headers, body }))
          .catch(reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(new ResearchFetchError("TIMEOUT", `Timed out after ${timeoutMs} ms`)),
    );
    req.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof ResearchFetchError) return reject(error);
      if (error.code === "EBLOCKEDADDRESS")
        return reject(
          new ResearchFetchError(
            "UNSAFE_URL",
            "The host resolves to a private or reserved address",
          ),
        );
      if (error.code === "ENOTFOUND")
        return reject(new ResearchFetchError("HTTP_CLIENT", "Host not found"));
      reject(
        new ResearchFetchError("NETWORK", `Network error${error.code ? ` (${error.code})` : ""}`),
      );
    });
    req.end();
  });
}

/** Fetch one public page (single attempt, redirects re-validated). */
export const fetchPublicPage: PageFetcher = async (input, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const accept =
    options.accept === "text" ? "text/plain,*/*;q=0.1" : "text/html,application/xhtml+xml;q=0.9";
  let url = assertSafeUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await requestOnce(url, timeoutMs, maxBytes, accept);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.location;
      if (!location)
        throw new ResearchFetchError("HTTP_CLIENT", "Redirect without location", res.status);
      url = assertSafeUrl(new URL(location, url).toString());
      continue;
    }
    if (res.body) {
      return {
        url: input,
        finalUrl: url.toString(),
        status: res.status,
        contentType: String(res.headers["content-type"] ?? ""),
        body: new TextDecoder("utf-8").decode(res.body),
        lastModified: (res.headers["last-modified"] as string | undefined) ?? null,
      };
    }
    throw statusError(res.status, res.headers);
  }
  throw new ResearchFetchError("TOO_MANY_REDIRECTS", `More than ${MAX_REDIRECTS} redirects`);
};

export function statusError(status: number, headers: http.IncomingHttpHeaders = {}) {
  if (looksLikeChallenge(status, headers))
    return new ResearchFetchError(
      "BLOCKED",
      "Blocked by an anti-bot challenge (not bypassed)",
      status,
    );
  if (status === 401 || status === 403 || status === 451)
    return new ResearchFetchError(
      "BLOCKED",
      `Access denied (HTTP ${status}) — not bypassed`,
      status,
    );
  if (status === 404 || status === 410)
    return new ResearchFetchError("NOT_FOUND", `Not found (HTTP ${status})`, status);
  if (status === 429)
    return new ResearchFetchError("RATE_LIMITED", "Rate limited (HTTP 429)", status);
  if (status >= 500)
    return new ResearchFetchError("HTTP_SERVER", `Server error (HTTP ${status})`, status);
  return new ResearchFetchError("HTTP_CLIENT", `Request rejected (HTTP ${status})`, status);
}

/** Controlled retries with exponential backoff — only for transient failures. */
export async function fetchWithRetry(
  fetcher: PageFetcher,
  url: string,
  options: PageFetchOptions & {
    maxRetries?: number;
    sleep?: (ms: number) => Promise<void>;
    beforeRequest?: () => Promise<void>;
    onAttempt?: () => void;
  } = {},
): Promise<FetchedPage> {
  const maxRetries = options.maxRetries ?? 2;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: ResearchFetchError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await options.beforeRequest?.();
    options.onAttempt?.();
    try {
      return await fetcher(url, options);
    } catch (error) {
      const e =
        error instanceof ResearchFetchError
          ? error
          : new ResearchFetchError(
              "NETWORK",
              error instanceof Error ? error.message : "Request failed",
            );
      if (!e.retryable) throw e;
      last = e;
    }
    if (attempt < maxRetries)
      await sleep(Math.min(500 * 2 ** attempt + Math.floor(Math.random() * 200), 6000));
  }
  throw last ?? new ResearchFetchError("NETWORK", "Request failed");
}
