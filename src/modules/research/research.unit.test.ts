import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  computeCompleteness,
  computeStats,
  researchStatus,
  salientTokens,
  validateAiClaims,
} from "./claims";
import {
  domainMatchesName,
  resolveWebsite,
  uncertainMatches,
  websiteFromJob,
  websiteFromSearch,
} from "./company-resolution";
import { extractCompanyClaims, markConflicts, type SourcePage } from "./extract/company";
import { extractJobClaims } from "./extract/job";
import { normalizeUrl, parsePage } from "./extract/page";
import { isPrivateAddress } from "./fetch/ip";
import { isAllowed, parseRobots } from "./fetch/robots";
import {
  assertSafeUrl,
  fetchWithRetry,
  makeSafeLookup,
  readLimited,
  ResearchFetchError,
  statusError,
  type FetchedPage,
} from "./fetch/safe-fetch";
import {
  FetchSession,
  resetResearchBudgetsForTests,
  setPageFetcherForTests,
} from "./fetch/session";
import { classifyOfficialLink } from "./pipeline";
import { freshnessOf, RESEARCH_ENGINE_VERSION, type DraftClaim } from "./types";

const page = (html: string, url = "https://acme.io/") => parsePage(html, url);
const src = (
  key: string,
  sourceType: SourcePage["sourceType"],
  html: string,
  reliability: SourcePage["reliability"] = "AUTHORITATIVE",
): SourcePage => ({
  key,
  url: key,
  sourceType,
  reliability,
  page: page(html, key),
});

describe("SSRF protection", () => {
  it("rejects unsafe URLs before any request", () => {
    for (const url of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/",
      "file:///etc/passwd",
      "ftp://example.com/x",
      "http://[::1]/",
      "http://10.0.0.5/",
      "http://user:pass@acme.io/",
      "https://acme.io:8443/",
      "http://intranet.corp/",
      "javascript:alert(1)",
    ])
      expect(() => assertSafeUrl(url), url).toThrow(ResearchFetchError);
    expect(assertSafeUrl("https://acme.io/about").hostname).toBe("acme.io");
  });

  it("classifies private, reserved and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "224.0.0.1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });

  it("DNS lookup refuses hostnames that resolve to private addresses (no rebinding gap)", async () => {
    const fakeResolve = ((
      host: string,
      _o: unknown,
      cb: (e: null, a: { address: string; family: number }[]) => void,
    ) =>
      cb(
        null,
        host === "evil.test"
          ? [{ address: "127.0.0.1", family: 4 }]
          : [{ address: "93.184.216.34", family: 4 }],
      )) as never;
    const lookup = makeSafeLookup(fakeResolve) as unknown as (
      h: string,
      o: object,
      cb: (e: NodeJS.ErrnoException | null, a?: unknown) => void,
    ) => void;
    const bad = await new Promise<NodeJS.ErrnoException | null>((r) =>
      lookup("evil.test", {}, (e) => r(e)),
    );
    expect(bad?.code).toBe("EBLOCKEDADDRESS");
    const good = await new Promise<unknown>((r) => lookup("acme.io", {}, (_e, a) => r(a)));
    expect(good).toBe("93.184.216.34");
  });

  it("rejects oversized responses while streaming", async () => {
    const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(readLimited(big, 1000)).rejects.toMatchObject({ kind: "TOO_LARGE" });
    expect((await readLimited(Readable.from([Buffer.from("ok")]), 1000)).toString()).toBe("ok");
  });
});

describe("retries and blocking", () => {
  const ok: FetchedPage = {
    url: "u",
    finalUrl: "u",
    status: 200,
    contentType: "text/html",
    body: "<p>x</p>",
    lastModified: null,
  };
  it("retries transient failures (5xx, timeout) with backoff", async () => {
    let calls = 0;
    const res = await fetchWithRetry(
      async () => {
        calls++;
        if (calls < 3)
          throw calls === 1 ? statusError(503) : new ResearchFetchError("TIMEOUT", "t");
        return ok;
      },
      "https://acme.io",
      { sleep: async () => undefined },
    );
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("never retries 401/403/404, CAPTCHA challenges or unsafe URLs", async () => {
    for (const err of [
      statusError(403),
      statusError(401),
      statusError(404),
      statusError(403, { "cf-mitigated": "challenge" }),
      new ResearchFetchError("UNSAFE_URL", "x"),
    ]) {
      let calls = 0;
      await expect(
        fetchWithRetry(
          async () => {
            calls++;
            throw err;
          },
          "https://acme.io",
          { sleep: async () => undefined },
        ),
      ).rejects.toBe(err);
      expect(calls).toBe(1);
    }
    expect(statusError(403).kind).toBe("BLOCKED");
    expect(statusError(503, { "cf-mitigated": "challenge" }).kind).toBe("BLOCKED");
  });
});

describe("robots.txt and rate limits", () => {
  it("parses groups and longest-match rules", () => {
    const rules = parseRobots(
      "User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n",
    );
    expect(isAllowed(rules, "/about")).toBe(true);
    expect(isAllowed(rules, "/private/x")).toBe(false);
    expect(isAllowed(rules, "/private/ok/1")).toBe(true);
    expect(isAllowed(rules, "/a.pdf")).toBe(false);
    expect(isAllowed(parseRobots("User-agent: *\nDisallow: /"), "/")).toBe(false);
  });

  it("enforces robots.txt, per-run page caps and per-user request budgets", async () => {
    resetResearchBudgetsForTests();
    const served: string[] = [];
    setPageFetcherForTests(async (url) => {
      served.push(url);
      if (url.endsWith("/robots.txt"))
        return {
          url,
          finalUrl: url,
          status: 200,
          contentType: "text/plain",
          body: "User-agent: *\nDisallow: /secret",
          lastModified: null,
        };
      return {
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        body: "<title>x</title>",
        lastModified: null,
      };
    });
    try {
      const limits = {
        maxPages: 2,
        maxDurationMs: 60_000,
        requestsPerMinute: 4,
        requestsPerHour: 100,
        perHostPerMinute: 600,
        concurrency: 2,
        maxBytes: 10_000,
        maxRetries: 0,
      };
      const s = new FetchSession("user-a", limits);
      await expect(s.fetchPage("https://acme.io/secret")).rejects.toMatchObject({
        kind: "ROBOTS_DISALLOWED",
      });
      await s.fetchPage("https://acme.io/a");
      await s.fetchPage("https://acme.io/b");
      await expect(s.fetchPage("https://acme.io/c")).rejects.toMatchObject({
        kind: "LIMIT_REACHED",
      });
      expect(served.filter((u) => u.endsWith("robots.txt"))).toHaveLength(1);
      // Per-user minute budget (4 requests) is shared across sessions: robots + a + b used 3.
      const s2 = new FetchSession("user-a", { ...limits, maxPages: 10 });
      await expect(s2.fetchPage("https://other.io/x")).rejects.toMatchObject({
        kind: "LIMIT_REACHED",
      });
      await expect(s2.fetchPage("https://acme.io/d")).rejects.toMatchObject({
        kind: "LIMIT_REACHED",
      });
      // Another user has their own budget.
      await new FetchSession("user-b", limits).fetchPage("https://acme.io/a");
    } finally {
      setPageFetcherForTests(undefined);
      resetResearchBudgetsForTests();
    }
  });
});

describe("page extraction", () => {
  const html = `<html><head><title>Acme — CRM for small businesses</title>
    <meta name="description" content="Acme develops CRM software for small businesses.">
    <script>alert("x")</script>
    <script type="application/ld+json">{"@type":"Organization","name":"Acme","foundingDate":"2018-03-01","address":{"addressLocality":"Berlin","addressCountry":"DE"}}</script>
    </head><body><nav><a href="/products/crm">Acme CRM</a><a href="/about">About</a><a href="/careers">Careers</a><a href="javascript:evil()">x</a></nav>
    <h1>Grow with Acme</h1><article><h2>Acme launches AI assistant</h2><time datetime="2026-06-01">June 1</time></article>
    <p onclick="steal()">We help teams sell.</p></body></html>`;

  it("extracts metadata, JSON-LD, links and dated items; drops scripts", () => {
    const p = page(html);
    expect(p.title).toBe("Acme — CRM for small businesses");
    expect(p.description).toBe("Acme develops CRM software for small businesses.");
    expect(p.jsonLd[0]?.foundingDate).toBe("2018-03-01");
    expect(p.links.map((l) => l.href)).toContain("https://acme.io/products/crm");
    expect(p.links.some((l) => l.href.startsWith("javascript"))).toBe(false);
    expect(p.datedItems[0]).toEqual({ date: "2026-06-01", title: "Acme launches AI assistant" });
    expect(p.text).not.toMatch(/alert|steal|<p/);
  });

  it("normalizes and classifies URLs", () => {
    expect(normalizeUrl("https://www.Acme.io/about/?utm_source=x#top")).toBe(
      "https://acme.io/about",
    );
    expect(classifyOfficialLink("https://acme.io/careers", "acme.io")).toBe("careers");
    expect(classifyOfficialLink("https://acme.io/products/crm", "acme.io")).toBe("product");
    expect(classifyOfficialLink("https://blog.acme.io/", "acme.io")).toBe("blog");
    expect(classifyOfficialLink("https://evil.io/careers", "acme.io")).toBeNull();
  });

  it("company claims: self-description, products, founded, activity; unknowns stay unknown", () => {
    const { claims, unknowns } = extractCompanyClaims(
      "Acme",
      [src("https://acme.io/", "OFFICIAL_COMPANY", html)],
      new Date("2026-09-01"),
    );
    expect(claims.find((c) => c.section === "WHAT_THEY_DO")?.claim).toMatch(
      /develops CRM software/,
    );
    expect(claims.find((c) => c.section === "PRODUCTS")?.claim).toMatch(/Acme CRM/);
    expect(claims.find((c) => c.valueKey === "founded_year")?.value).toBe("2018");
    expect(unknowns).toContain("Industry is not stated in the sources.");
    for (const c of claims.filter((x) => x.claimType === "FACT"))
      expect(c.evidence.length).toBeGreaterThan(0);
  });
});

describe("required: source conflict", () => {
  it("founded 2018 vs 2017 → both CONFLICTING, both retained", () => {
    const a = src(
      "A",
      "OFFICIAL_COMPANY",
      `<script type="application/ld+json">{"@type":"Organization","foundingDate":"2018"}</script>`,
    );
    const b = src(
      "B",
      "PUBLIC_DATABASE",
      "<p>Acme was founded in 2017 in Berlin.</p>",
      "SECONDARY",
    );
    const { claims } = extractCompanyClaims("Acme", [a, b]);
    const founded = claims.filter((c) => c.valueKey === "founded_year");
    expect(founded).toHaveLength(2);
    expect(founded.map((c) => c.value).sort()).toEqual(["2017", "2018"]);
    for (const c of founded) {
      expect(c.claimType).toBe("CONFLICTING");
      expect(c.verification).toBe("CONFLICTING");
    }
    expect(founded.map((c) => c.evidence[0]!.sourceKey).sort()).toEqual(["A", "B"]);
  });

  it("the same value from two sources is one claim with both sources", () => {
    const base: DraftClaim = {
      section: "FACTS",
      claim: "Founded in 2018.",
      claimType: "FACT",
      verification: "VERIFIED_FROM_SOURCE",
      method: "RULE",
      valueKey: "founded_year",
      value: "2018",
      evidence: [{ sourceKey: "A", excerpt: "2018" }],
    };
    const merged = markConflicts([
      base,
      { ...base, evidence: [{ sourceKey: "B", excerpt: "2018" }] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.evidence).toHaveLength(2);
    expect(merged[0]!.claimType).toBe("FACT");
  });
});

describe("required: AI hallucination rejection", () => {
  const evidence = [{ id: "E1", sourceKey: "S1", excerpt: "Company develops CRM software." }];
  it("rejects “opened a Dubai office” — no supporting source", () => {
    const { accepted, rejected } = validateAiClaims(
      {
        claims: [{ text: "The company opened a Dubai office.", type: "FACT", evidenceIds: ["E1"] }],
      },
      evidence,
      "AI_SYNTHESIS",
    );
    expect(accepted).toHaveLength(0);
    expect(rejected[0]!.verification).toBe("REJECTED");
    expect(rejected[0]!.rejectionReason).toMatch(/No supporting source.*Dubai/);
  });

  it("rejects claims without citations or with unknown evidence ids; supported claims stay PENDING_REVIEW", () => {
    const { accepted, rejected } = validateAiClaims(
      {
        claims: [
          { text: "The company builds CRM software.", type: "FACT", evidenceIds: [] },
          { text: "The company builds CRM software.", type: "FACT", evidenceIds: ["E9"] },
          { text: "The company develops CRM software.", type: "FACT", evidenceIds: ["E1"] },
        ],
      },
      evidence,
      "AI_SYNTHESIS",
    );
    expect(rejected.map((r) => r.rejectionReason)).toEqual([
      "No supporting source cited.",
      "Cites evidence that does not exist.",
    ]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.verification).toBe("PENDING_REVIEW");
    expect(accepted[0]!.method).toBe("AI");
  });

  it("salient tokens are numbers and proper nouns", () => {
    expect(salientTokens("In 2024 the company opened offices in Dubai and London.")).toEqual([
      "2024",
      "Dubai",
      "London",
    ]);
  });
});

describe("job extraction", () => {
  const description = [
    "About the role",
    "We are looking for a Growth Marketer to help us build a new automation function.",
    "What you'll do",
    "• Run paid social campaigns on Meta and LinkedIn",
    "• Build AI workflow automations with Zapier",
    "• Report on campaign analytics weekly",
    "Requirements",
    "• 2+ years of experience in growth marketing",
    "How to apply",
    "Please include a portfolio link with your application.",
  ].join("\n");
  it("quotes the posting: summary, purpose, responsibilities, instructions; priorities are interpretations", () => {
    const r = extractJobClaims(
      { title: "Growth Marketer", description, sourceKey: "ASHBY" },
      [],
      "JOB",
    );
    expect(r.claims.find((c) => c.section === "ROLE_PURPOSE")?.claim).toMatch(
      /new automation function/,
    );
    expect(r.claims.filter((c) => c.section === "RESPONSIBILITY")).toHaveLength(3);
    expect(r.claims.find((c) => c.section === "APPLICATION")?.claim).toMatch(/portfolio link/);
    const pri = r.claims.filter((c) => c.section === "PRIORITY");
    expect(pri.length).toBeGreaterThan(0);
    for (const p of pri) expect(p.claimType).toBe("INTERPRETATION");
    expect(r.openQuestions).toContain("Salary is not stated in the posting.");
    expect(r.terms.map((t) => t.term.toLowerCase())).toContain("zapier");
  });

  it("no stated purpose → UNKNOWN, never guessed", () => {
    const r = extractJobClaims(
      {
        title: "Analyst",
        description: "Analyst role.\nResponsibilities\n• Build reports",
        sourceKey: "MANUAL",
      },
      [],
      "JOB",
    );
    const purpose = r.claims.find((c) => c.section === "ROLE_PURPOSE")!;
    expect(purpose.claimType).toBe("UNKNOWN");
    expect(purpose.evidence).toHaveLength(0);
  });
});

describe("status, completeness, freshness, identity", () => {
  it("required partial case: company ok, careers 403, newsroom ok → PARTIAL", () => {
    const stats = computeStats(
      [
        {
          key: "home",
          ok: true,
          failed: false,
          reliability: "AUTHORITATIVE",
          sourceType: "OFFICIAL_COMPANY",
        },
        {
          key: "careers",
          ok: false,
          failed: true,
          reliability: "AUTHORITATIVE",
          sourceType: "OFFICIAL_CAREERS",
        },
        {
          key: "news",
          ok: true,
          failed: false,
          reliability: "AUTHORITATIVE",
          sourceType: "OFFICIAL_NEWS",
        },
      ],
      [],
    );
    expect(researchStatus(stats)).toBe("PARTIAL");
    expect(researchStatus({ ...stats, sourcesFailed: 0 })).toBe("COMPLETED");
    expect(researchStatus({ ...stats, sourcesFound: 0 })).toBe("FAILED");
    const dims = computeCompleteness({
      websiteIdentified: true,
      websiteFetched: true,
      careers: "FAILED",
      activityChecked: true,
      activityFound: 0,
      stats,
    });
    expect(dims.find((d) => d.key === "COMPANY_CAREERS")?.state).toBe("PARTIAL");
    expect(dims.find((d) => d.key === "PUBLIC_ACTIVITY")?.detail).toBe("Checked — none found");
  });

  it("freshness: FRESH → AGING → STALE; invalidated or older engine → STALE", () => {
    const now = new Date("2026-09-30");
    const at = (days: number) => ({
      researchedAt: new Date(now.getTime() - days * 86_400_000),
      invalidatedAt: null,
      engineVersion: RESEARCH_ENGINE_VERSION,
    });
    const policy = { freshDays: 14, staleDays: 45 };
    expect(freshnessOf(at(3), policy, now)).toBe("FRESH");
    expect(freshnessOf(at(20), policy, now)).toBe("AGING");
    expect(freshnessOf(at(60), policy, now)).toBe("STALE");
    expect(freshnessOf({ ...at(1), invalidatedAt: now }, policy, now)).toBe("STALE");
    expect(freshnessOf({ ...at(1), engineVersion: "old" }, policy, now)).toBe("STALE");
    expect(freshnessOf(null, policy, now)).toBe("UNKNOWN");
  });

  it("company identity: job boards are never the company site; similar names are not merged", () => {
    expect(
      websiteFromJob({ jobUrl: "https://jobs.ashbyhq.com/acme/1", applicationUrl: null }),
    ).toBeNull();
    expect(
      websiteFromJob({ jobUrl: "https://careers.acme.io/jobs/1", applicationUrl: null }),
    ).toMatchObject({ url: "https://careers.acme.io", confidence: "LIKELY" });
    expect(domainMatchesName("www.acme.io", "Acme Inc.")).toBe("EXACT");
    expect(
      websiteFromSearch([{ url: "https://acmetechnologies-blog.net/x" }], "Acme")?.confidence,
    ).toBe("UNCERTAIN");
    expect(
      resolveWebsite([{ url: "https://x.io", confidence: "UNCERTAIN", source: "SEARCH" }]),
    ).toBeNull();
    const companies = [
      { id: "1", name: "Acme" },
      { id: "2", name: "Acme Technologies" },
      { id: "3", name: "Zenith" },
    ];
    expect(uncertainMatches(companies[0]!, companies).map((c) => c.id)).toEqual(["2"]);
  });
});
