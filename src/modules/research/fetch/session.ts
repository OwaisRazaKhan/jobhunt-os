import "server-only";
import { RateLimiter } from "@/modules/jobs/discovery/rate-limiter";
import { ALLOW_ALL, DISALLOW_ALL, isAllowed, parseRobots, type RobotsRules } from "./robots";
import {
  assertSafeUrl,
  fetchPublicPage,
  fetchWithRetry,
  ResearchFetchError,
  type FetchedPage,
  type PageFetcher,
} from "./safe-fetch";

/**
 * One research run's fetch budget. Every external request goes through here:
 *  - per-run caps: max pages, max duration (deadline)
 *  - per-user sliding windows: requests / minute and / hour (process-wide)
 *  - per-host spacing (polite crawling) and robots.txt (cached per host for the run)
 *  - bounded concurrency (at most `concurrency` requests in flight)
 *  - controlled retries for transient failures only
 */

let fetcherOverride: PageFetcher | undefined;
/** Tests inject a fake fetcher (no network). */
export function setPageFetcherForTests(fetcher: PageFetcher | undefined) {
  fetcherOverride = fetcher;
}

const hostLimiter = new RateLimiter();

/** Tests only: skip polite waits (host spacing, retry backoff). Budgets and caps still apply. */
let fastMode = false;
export function setFastResearchTimingForTests(on: boolean) {
  fastMode = on;
}

/** Process-wide per-user request log (timestamps) for minute/hour budgets. */
const userWindows = new Map<string, number[]>();

export function resetResearchBudgetsForTests() {
  userWindows.clear();
}

export interface SessionLimits {
  maxPages: number;
  maxDurationMs: number;
  requestsPerMinute: number;
  requestsPerHour: number;
  perHostPerMinute: number;
  concurrency: number;
  maxBytes: number;
  maxRetries: number;
}

export class FetchSession {
  requests = 0;
  pages = 0;
  private readonly robots = new Map<string, Promise<RobotsRules>>();
  private readonly deadline: number;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly userId: string,
    readonly limits: SessionLimits,
    private readonly now: () => number = Date.now,
    private readonly sleep?: (ms: number) => Promise<void>,
  ) {
    this.deadline = now() + limits.maxDurationMs;
  }

  get fetcher(): PageFetcher {
    return fetcherOverride ?? fetchPublicPage;
  }

  timeLeft() {
    return this.deadline - this.now();
  }

  /** Reserve a slot in the user's minute/hour windows or fail with LIMIT_REACHED. */
  private takeBudget() {
    const now = this.now();
    const log = (userWindows.get(this.userId) ?? []).filter((t) => now - t < 3_600_000);
    const lastMinute = log.filter((t) => now - t < 60_000).length;
    if (lastMinute >= this.limits.requestsPerMinute)
      throw new ResearchFetchError("LIMIT_REACHED", "Research request limit per minute reached");
    if (log.length >= this.limits.requestsPerHour)
      throw new ResearchFetchError("LIMIT_REACHED", "Research request limit per hour reached");
    log.push(now);
    userWindows.set(this.userId, log);
    this.requests++;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limits.concurrency)
      await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private robotsFor(origin: string): Promise<RobotsRules> {
    let rules = this.robots.get(origin);
    if (!rules) {
      rules = this.request(`${origin}/robots.txt`, "text", false)
        .then((page) => parseRobots(page.body))
        .catch((error: unknown) => {
          if (error instanceof ResearchFetchError && error.kind === "LIMIT_REACHED") {
            // Budget exhausted: not a robots decision — do not cache, surface the limit.
            this.robots.delete(origin);
            throw error;
          }
          if (error instanceof ResearchFetchError) {
            // No robots.txt (404) or other 4xx → no restrictions. Server / network errors or
            // limits → conservatively treat the whole site as disallowed for this run.
            if (["NOT_FOUND", "HTTP_CLIENT", "BLOCKED", "UNSUPPORTED_TYPE"].includes(error.kind))
              return ALLOW_ALL;
          }
          return DISALLOW_ALL;
        });
      this.robots.set(origin, rules);
    }
    return rules;
  }

  private request(url: string, accept: "html" | "text", countPage: boolean): Promise<FetchedPage> {
    return this.slot(async () => {
      if (this.timeLeft() <= 0)
        throw new ResearchFetchError("LIMIT_REACHED", "Research time limit reached");
      if (countPage && this.pages >= this.limits.maxPages)
        throw new ResearchFetchError(
          "LIMIT_REACHED",
          `Page limit (${this.limits.maxPages}) reached`,
        );
      if (countPage) this.pages++;
      const host = new URL(url).hostname;
      return fetchWithRetry(this.fetcher, url, {
        accept,
        maxBytes: this.limits.maxBytes,
        timeoutMs: Math.max(1000, Math.min(12_000, this.timeLeft())),
        maxRetries: this.limits.maxRetries,
        sleep: fastMode ? async () => undefined : this.sleep,
        beforeRequest: async () => {
          this.takeBudget();
          if (!fastMode)
            await hostLimiter.acquire(`research:${host}`, this.limits.perHostPerMinute);
        },
      });
    });
  }

  /** Fetch a public page (robots-checked, rate-limited, capped). */
  async fetchPage(url: string): Promise<FetchedPage> {
    const parsed = assertSafeUrl(url);
    const rules = await this.robotsFor(parsed.origin);
    if (!isAllowed(rules, parsed.pathname + parsed.search))
      throw new ResearchFetchError("ROBOTS_DISALLOWED", "Disallowed by the site's robots.txt");
    return this.request(url, "html", true);
  }
}
