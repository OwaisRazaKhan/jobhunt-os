import type { AtsSourceKey, BoardEntry } from "../../sources.schemas";
import type { CanonicalJobInput } from "../canonical";

/**
 * Source adapter contract. An adapter knows ONE provider's public API:
 * how to fetch a board (with pagination limits) and how to map a raw posting
 * to the canonical shape. It never writes to the database.
 */

export interface AdapterLimits {
  timeoutMs: number;
  maxPages: number;
  maxJobs: number;
  requestsPerMinute: number;
}

export interface AdapterContext {
  limits: AdapterLimits;
  /** Rate limiting hook, awaited before each HTTP request. */
  beforeRequest: () => Promise<void>;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Source-specific options (e.g. Lever region). */
  options?: Record<string, unknown>;
}

export interface RawPosting {
  externalId: string;
  raw: Record<string, unknown>;
}

export interface BoardFetchResult {
  postings: RawPosting[];
  /** True when limits cut the fetch short — then disappearance of postings means nothing. */
  truncated: boolean;
  requests: number;
  /** URL of the API endpoint used (source attribution). */
  endpoint: string;
}

export interface SourceAdapter {
  key: AtsSourceKey;
  fetchBoard(board: BoardEntry, ctx: AdapterContext): Promise<BoardFetchResult>;
  toCanonical(posting: RawPosting, board: BoardEntry, ctx: Pick<AdapterContext, "options">): CanonicalJobInput;
}

export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const date = (v: unknown): Date | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};
