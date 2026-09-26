import "server-only";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { checkPublicHttpUrl } from "@/lib/safe-url";

/**
 * Research Search Service. Search results are DISCOVERY hints only — never evidence on their own;
 * the underlying pages are fetched (through the SSRF-safe fetcher) and judged separately.
 *
 * Providers: none by default (manual URLs + official-site discovery still work). Optional free
 * provider: a SearXNG instance the operator runs (SEARXNG_URL, JSON API). No paid API is required.
 */

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchProvider {
  id: string;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

let override: SearchProvider | null | undefined;
/** Tests inject a provider (or null for "none"). */
export function setSearchProviderForTests(provider: SearchProvider | null | undefined) {
  override = provider;
}

const searxResponse = z.object({
  results: z
    .array(
      z.object({ url: z.string(), title: z.string().optional(), content: z.string().optional() }),
    )
    .default([]),
});

class SearxngProvider implements SearchProvider {
  readonly id = "searxng";
  constructor(private readonly baseUrl: string) {}
  async search(query: string, limit: number): Promise<SearchResult[]> {
    const url = new URL("/search", this.baseUrl);
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("safesearch", "1");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      // The instance URL is operator configuration (env), not user input.
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`Search provider returned HTTP ${res.status}`);
      const parsed = searxResponse.parse(await res.json());
      return parsed.results
        .filter((r) => checkPublicHttpUrl(r.url).ok)
        .slice(0, limit)
        .map((r) => ({
          url: r.url,
          title: (r.title ?? "").slice(0, 300),
          snippet: (r.content ?? "").slice(0, 500),
        }));
    } finally {
      clearTimeout(timer);
    }
  }
}

export function getSearchProvider(): SearchProvider | null {
  if (override !== undefined) return override;
  const base = getServerEnv().SEARXNG_URL;
  return base ? new SearxngProvider(base) : null;
}
