import { describe, expect, it, vi } from "vitest";
import { ASHBY_BOARD, GREENHOUSE_BOARD, leverPosting } from "../../../../tests/fixtures/sources";
import { ADAPTERS } from "./adapters";
import type { AdapterContext } from "./adapters/types";
import { canonicalJobSchema, dedupeFingerprint } from "./canonical";
import { fetchJson, SourceFetchError } from "./http";
import { RateLimiter } from "./rate-limiter";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function ctx(
  fetchImpl: typeof fetch,
  over: Partial<AdapterContext["limits"]> = {},
  options?: Record<string, unknown>,
): AdapterContext {
  return {
    limits: { timeoutMs: 5000, maxPages: 10, maxJobs: 1000, requestsPerMinute: 60, ...over },
    beforeRequest: async () => undefined,
    fetchImpl,
    sleep: async () => undefined,
    options,
  };
}

describe("guarded HTTP client", () => {
  it("only allows provider API hosts over https", async () => {
    await expect(
      fetchJson("https://evil.example.com/x", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "BLOCKED_HOST" });
    await expect(fetchJson("http://api.ashbyhq.com/x", { timeoutMs: 1000 })).rejects.toMatchObject({
      kind: "BLOCKED_HOST",
    });
    await expect(
      fetchJson("https://169.254.169.254/latest", { timeoutMs: 1000 }),
    ).rejects.toMatchObject({ kind: "BLOCKED_HOST" });
  });

  it("retries transient failures (5xx, 429, network) with backoff, then succeeds", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(json({ ok: true }));
    const sleep = vi.fn(async () => undefined);
    expect(
      await fetchJson("https://api.ashbyhq.com/posting-api/job-board/x", {
        timeoutMs: 1000,
        fetchImpl: f as unknown as typeof fetch,
        sleep,
      }),
    ).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("never retries 401/403/404", async () => {
    for (const status of [401, 403, 404]) {
      const f = vi.fn().mockResolvedValue(json({}, status));
      await expect(
        fetchJson("https://api.ashbyhq.com/x", {
          timeoutMs: 1000,
          fetchImpl: f as unknown as typeof fetch,
          sleep: async () => undefined,
        }),
      ).rejects.toMatchObject({ kind: "HTTP_CLIENT", status });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after bounded retries and enforces the size limit", async () => {
    const f = vi.fn().mockResolvedValue(json({}, 500));
    await expect(
      fetchJson("https://api.ashbyhq.com/x", {
        timeoutMs: 1000,
        maxRetries: 2,
        fetchImpl: f as unknown as typeof fetch,
        sleep: async () => undefined,
      }),
    ).rejects.toBeInstanceOf(SourceFetchError);
    expect(f).toHaveBeenCalledTimes(3);
    const big = vi.fn().mockResolvedValue(json({ data: "x".repeat(5000) }));
    await expect(
      fetchJson("https://api.ashbyhq.com/x", {
        timeoutMs: 1000,
        maxBytes: 1000,
        fetchImpl: big as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "TOO_LARGE" });
  });

  it("times out slow responses", async () => {
    const slow = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          ),
        ),
    );
    await expect(
      fetchJson("https://api.ashbyhq.com/x", {
        timeoutMs: 20,
        maxRetries: 0,
        fetchImpl: slow as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ kind: "TIMEOUT" });
  });
});

describe("rate limiter", () => {
  it("spaces requests evenly per key", async () => {
    let now = 0;
    const waits: number[] = [];
    const limiter = new RateLimiter(
      () => now,
      async (ms) => void waits.push(ms),
    );
    await limiter.acquire("ASHBY", 60);
    await limiter.acquire("ASHBY", 60);
    await limiter.acquire("LEVER", 60);
    expect(waits).toEqual([1000]);
    now = 5000;
    await limiter.acquire("ASHBY", 60);
    expect(waits).toEqual([1000]);
  });
});

describe("Ashby adapter", () => {
  it("fetches listed postings and maps them to valid canonical jobs", async () => {
    const f = vi.fn().mockResolvedValue(json(ASHBY_BOARD));
    const board = { id: "testco", name: "Test Company" };
    const result = await ADAPTERS.ASHBY.fetchBoard(board, ctx(f as unknown as typeof fetch));
    expect(String(f.mock.calls[0]![0])).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/testco?includeCompensation=true",
    );
    expect(result.postings.map((p) => p.externalId)).toHaveLength(2); // unlisted excluded
    expect(result.truncated).toBe(false);

    const job = canonicalJobSchema.parse(
      ADAPTERS.ASHBY.toCanonical(result.postings[0]!, board, {}),
    );
    expect(job).toMatchObject({
      title: "Marketing Operations Specialist",
      companyName: "Test Company",
      city: "Berlin",
      countryCode: "DE",
      remoteStatus: "HYBRID",
      employmentType: "FULL_TIME",
      salaryMin: 50000,
      salaryMax: 65000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      department: "Marketing",
      team: "Growth",
      visaTextRaw: "Visa sponsorship is available for this role.",
    });
    expect(job.locationRaw).toBe("Berlin, Germany; Amsterdam");

    const remote = canonicalJobSchema.parse(
      ADAPTERS.ASHBY.toCanonical(result.postings[1]!, { id: "testco", name: null }, {}),
    );
    expect(remote).toMatchObject({
      companyName: "testco",
      remoteStatus: "REMOTE",
      countryCode: null,
      city: null,
      salaryMin: null,
      salaryCurrency: null,
      employmentType: "CONTRACT",
      visaTextRaw: null,
    });
  });

  it("respects maxJobs and reports truncation", async () => {
    const f = vi.fn().mockResolvedValue(json(ASHBY_BOARD));
    const result = await ADAPTERS.ASHBY.fetchBoard(
      { id: "testco", name: null },
      ctx(f as unknown as typeof fetch, { maxJobs: 1 }),
    );
    expect(result.postings).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });
});

describe("Lever adapter", () => {
  it("paginates with skip/limit on the EU instance and maps fields", async () => {
    const page1 = Array.from({ length: 2 }, (_, i) => leverPosting(i));
    const page2 = [leverPosting(2)];
    const f = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json(page2));
    const result = await ADAPTERS.LEVER.fetchBoard(
      { id: "testco", name: "Test Company" },
      ctx(f as unknown as typeof fetch, { maxJobs: 2 }, { region: "EU" }),
    );
    // maxJobs 2 -> pageSize 2 -> stops after collecting 2 and reports truncation
    expect(String(f.mock.calls[0]![0])).toBe(
      "https://api.eu.lever.co/v0/postings/testco?mode=json&skip=0&limit=2",
    );
    expect(result.postings).toHaveLength(2);

    const f2 = vi.fn().mockResolvedValueOnce(json(page1)).mockResolvedValueOnce(json(page2));
    const full = await ADAPTERS.LEVER.fetchBoard(
      { id: "testco", name: null },
      ctx(f2 as unknown as typeof fetch, { maxJobs: 1000 }),
    );
    expect(String(f2.mock.calls[0]![0])).toContain(
      "https://api.lever.co/v0/postings/testco?mode=json&skip=0&limit=100",
    );
    expect(full.postings).toHaveLength(2);
    expect(full.truncated).toBe(false);

    const job = canonicalJobSchema.parse(
      ADAPTERS.LEVER.toCanonical(
        full.postings[0]!,
        { id: "testco", name: "Test Company" },
        { options: { region: "EU" } },
      ),
    );
    expect(job).toMatchObject({
      city: "Dubai",
      countryCode: "AE",
      remoteStatus: "ONSITE",
      employmentType: "FULL_TIME",
      salaryMin: 12000,
      salaryMax: 15000,
      salaryCurrency: "AED",
      salaryPeriod: "MONTH",
      department: "Marketing",
      visaTextRaw: "Applicants must already have the right to work in the UAE.",
    });
    expect(job.description).toContain("Requirements\n• 3+ years experience");
  });

  it("stops at maxPages and flags truncation", async () => {
    const full = Array.from({ length: 100 }, (_, i) => leverPosting(i));
    const f = vi.fn().mockImplementation(async () => json(full));
    const result = await ADAPTERS.LEVER.fetchBoard(
      { id: "big", name: null },
      ctx(f as unknown as typeof fetch, { maxPages: 2 }),
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(result.truncated).toBe(true);
  });
});

describe("Greenhouse adapter", () => {
  it("maps escaped HTML content, pay ranges (period unknown) and explicit metadata", async () => {
    const f = vi.fn().mockResolvedValue(json(GREENHOUSE_BOARD));
    const board = { id: "testco", name: null };
    const result = await ADAPTERS.GREENHOUSE.fetchBoard(board, ctx(f as unknown as typeof fetch));
    expect(String(f.mock.calls[0]![0])).toBe(
      "https://boards-api.greenhouse.io/v1/boards/testco/jobs?content=true&pay_transparency=true",
    );
    const [a, b] = result.postings.map((p) =>
      canonicalJobSchema.parse(ADAPTERS.GREENHOUSE.toCanonical(p, board, {})),
    );
    expect(a).toMatchObject({
      companyName: "Test Company",
      city: "Toronto",
      region: "Ontario",
      countryCode: "CA",
      employmentType: "FULL_TIME",
      salaryMin: 60000,
      salaryMax: 75000,
      salaryCurrency: "CAD",
      salaryPeriod: null,
      salaryRaw: "Canada Salary Range",
      department: "Sales",
      remoteStatus: "UNKNOWN",
    });
    expect(a!.description).toBe("Grow our pipeline.\n\nMust be authorized to work in Canada.");
    expect(a!.visaTextRaw).toBe("Must be authorized to work in Canada.");
    expect(b).toMatchObject({
      remoteStatus: "REMOTE",
      countryCode: "US",
      employmentType: "UNKNOWN",
      salaryMin: null,
    });
  });
});

describe("canonical validation & fingerprint", () => {
  it("rejects invalid postings and fingerprints normalised identity", () => {
    const base = ADAPTERS.GREENHOUSE.toCanonical(
      { externalId: "4001", raw: GREENHOUSE_BOARD.jobs[0]! as Record<string, unknown> },
      { id: "t", name: null },
      {},
    );
    expect(canonicalJobSchema.safeParse({ ...base, title: "" }).success).toBe(false);
    expect(canonicalJobSchema.safeParse({ ...base, jobUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(canonicalJobSchema.safeParse({ ...base, salaryMin: 10, salaryMax: 5 }).success).toBe(
      false,
    );
    const job = canonicalJobSchema.parse(base);
    expect(dedupeFingerprint(job)).toBe(
      dedupeFingerprint({
        ...job,
        companyName: "TEST COMPANY Inc.",
        title: "  business development representative ",
      }),
    );
    expect(dedupeFingerprint(job)).not.toBe(dedupeFingerprint({ ...job, city: "Vancouver" }));
  });
});
