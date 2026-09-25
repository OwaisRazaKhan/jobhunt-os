/**
 * Simple per-key rate limiter: at most N requests per rolling minute, spaced
 * evenly (minimum interval = 60s / N). In-process only — adequate for the
 * single-process web/scheduler of Phase 2; a shared limiter can replace it later.
 */
export class RateLimiter {
  private readonly next = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
  ) {}

  async acquire(key: string, requestsPerMinute: number): Promise<void> {
    const interval = Math.ceil(60_000 / Math.max(1, requestsPerMinute));
    const current = this.now();
    const slot = Math.max(current, this.next.get(key) ?? 0);
    this.next.set(key, slot + interval);
    const wait = slot - current;
    if (wait > 0) await this.sleep(wait);
  }
}

/** Shared limiter for all adapters in this process. */
export const sourceRateLimiter = new RateLimiter();
