import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ResearchFetchError,
  statusError,
  type FetchedPage,
} from "@/modules/research/fetch/safe-fetch";
import {
  resetResearchBudgetsForTests,
  setFastResearchTimingForTests,
  setPageFetcherForTests,
} from "@/modules/research/fetch/session";
import { executeResearchRun } from "@/modules/research/pipeline";
import {
  addManualSource,
  addNote,
  exportJobResearch,
  getCompanyResearchView,
  getJobResearchView,
  getResearchSettings,
  getRun,
  listCompanies,
  refreshResearch,
  researchJob,
  saveResearchSettings,
  setCompanyTarget,
  startJobResearch,
} from "@/modules/research/research.service";
import { setSearchProviderForTests } from "@/modules/research/search/provider";
import { runResearchNode } from "@/modules/research/workflow";
import { setProvidersForTests } from "@/server/ai/router";
import type { AiProvider } from "@/server/ai/types";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

/** SYNTHETIC fixtures only: fake companies on *.test domains, served by an in-memory fetcher. */

let db: TestDb;
let n = 0;

type Route = { status?: number; body?: string; type?: string; error?: ResearchFetchError };
let site: Record<string, Route> = {};
let requested: string[] = [];

const html = (s: string) => ({ body: `<html>${s}</html>`, type: "text/html" });
const ACME_HOME = html(`<head><title>Acme CRM</title>
  <meta name="description" content="Acme develops CRM software for small businesses.">
  <script type="application/ld+json">{"@type":"Organization","name":"Acme","foundingDate":"2018"}</script></head>
  <body><h1>Sell smarter with AI automation</h1><h2>Marketing automation for teams</h2>
  <a href="/about">About</a><a href="/careers">Careers</a><a href="/products/crm">Acme CRM</a><a href="/news">News</a></body>`);

function defaultSite(): Record<string, Route> {
  return {
    "https://acme.test/robots.txt": {
      body: "User-agent: *\nDisallow: /private",
      type: "text/plain",
    },
    "https://acme.test": ACME_HOME,
    "https://acme.test/": ACME_HOME,
    "https://acme.test/about": html(
      "<body><h1>About Acme</h1><p>Acme was founded in 2017 in Berlin.</p></body>",
    ),
    "https://acme.test/careers": { status: 403 },
    "https://acme.test/products/crm": html(
      "<body><h1>Acme CRM</h1><h2>AI assistant for sales teams</h2></body>",
    ),
    "https://acme.test/news": html(
      `<body><article><h2>Acme launches AI assistant</h2><time datetime="2026-07-01">July</time></article>
       <article><h2>Acme opens Berlin office</h2><time datetime="2024-02-01">2024</time></article></body>`,
    ),
    "https://news.test/robots.txt": { status: 404 },
    "https://news.test/acme-partnership": html(`<head><title>Acme partners with Globex</title>
      <meta name="description" content="Acme announced a partnership with Globex."><meta property="article:published_time" content="2026-08-01"></head><body><p>Acme and Globex…</p></body>`),
  };
}

function fakeFetch() {
  setPageFetcherForTests(async (url): Promise<FetchedPage> => {
    requested.push(url);
    const route = site[url] ?? site[url.replace(/\/$/, "")];
    if (!route) throw statusError(404);
    if (route.error) throw route.error;
    if (route.status && route.status !== 200) throw statusError(route.status);
    return {
      url,
      finalUrl: url,
      status: 200,
      contentType: route.type ?? "text/html",
      body: route.body ?? "",
      lastModified: null,
    };
  });
}

const JD = [
  "About the role",
  "We are looking for a Growth Marketer to help us build a new AI automation function.",
  "What you'll do",
  "• Run marketing automation campaigns for small businesses",
  "• Build AI workflow automations with Zapier",
  "• Report campaign analytics weekly",
  "Requirements",
  "• 2+ years of experience in growth marketing",
  "• Hands-on experience with HubSpot",
  "How to apply",
  "Please include a portfolio link with your application.",
].join("\n");

async function company(name: string) {
  return db.prisma.company.create({
    data: { name, nameNormalized: `${name.toLowerCase().replace(/\W/g, "")}${++n}` },
  });
}

async function job(
  companyId: string,
  data: { title?: string; jobUrl?: string; privateFor?: string; description?: string } = {},
) {
  const manual = Boolean(data.privateFor);
  return db.prisma.job.create({
    data: {
      companyId,
      sourceKey: manual ? "MANUAL" : "ASHBY",
      sourceType: manual ? "MANUAL" : "ATS_PUBLIC_API",
      sourceStatus: manual ? "USER_ENTERED" : "DISCOVERED",
      title: data.title ?? "Growth Marketer",
      normalizedTitle: "growth marketer",
      description: data.description ?? JD,
      locationRaw: "Berlin, Germany",
      city: "Berlin",
      countryCode: "DE",
      remoteStatus: "HYBRID",
      employmentType: "FULL_TIME",
      jobUrl: data.jobUrl ?? `https://acme.test/careers/job-${++n}`,
      contentHash: String(++n).padStart(64, "0"),
      visibility: manual ? "PRIVATE" : "PUBLIC",
      createdByUserId: data.privateFor ?? null,
    },
  });
}

beforeAll(async () => {
  db = await startTestDb();
  setFastResearchTimingForTests(true);
});
afterAll(async () => {
  setFastResearchTimingForTests(false);
  await db.stop();
});
beforeEach(() => {
  site = defaultSite();
  requested = [];
  resetResearchBudgetsForTests();
  fakeFetch();
  setSearchProviderForTests(null);
});
afterEach(() => {
  setPageFetcherForTests(undefined);
  setSearchProviderForTests(undefined);
  setProvidersForTests(undefined);
});

describe("job + company research", () => {
  it("researches a job end-to-end: official sources, evidence, partial result, conflicts kept", async () => {
    const user = await createTestUser(db.prisma, "Research A");
    const acme = await company("Acme");
    const jobA = await job(acme.id);
    const result = await researchJob(user, { jobId: jobA.id, options: { depth: "STANDARD" } });

    // Careers page 403 → PARTIAL; valid evidence retained.
    expect(result.status).toBe("PARTIAL");
    expect(result.jobResearch?.version).toBe(1);
    expect(result.companyResearch?.version).toBe(1);
    expect(result.evidenceIds.length).toBeGreaterThan(5);
    expect(requested).toContain("https://acme.test/robots.txt");
    expect(requested.some((u) => u.includes("/private"))).toBe(false);

    const view = await getJobResearchView(user, jobA.id);
    const r = view.research!;
    expect(r.claims.find((c) => c.section === "ROLE_PURPOSE")?.claim).toMatch(
      /new AI automation function/,
    );
    expect(r.claims.filter((c) => c.section === "RESPONSIBILITY")).toHaveLength(3);
    expect(r.claims.find((c) => c.section === "APPLICATION")?.claim).toMatch(/portfolio link/);
    expect(
      r.claims.some((c) => c.section === "RELEVANT_CONTEXT" && c.claimType === "INTERPRETATION"),
    ).toBe(true);
    for (const c of r.claims.filter((x) => x.claimType === "FACT"))
      expect(c.evidence.length).toBeGreaterThan(0);

    const cr = view.companyResearch!;
    expect(cr.claims.find((c) => c.section === "WHAT_THEY_DO")?.claim).toMatch(
      /develops CRM software/,
    );
    expect(cr.claims.find((c) => c.section === "PRODUCTS")?.claim).toMatch(/Acme CRM/);
    const activity = cr.claims.filter((c) => c.section === "ACTIVITY");
    expect(activity.map((a) => a.temporal).sort()).toEqual(["CURRENT", "HISTORICAL"]);
    // Required conflict: 2018 (official JSON-LD) vs 2017 (about page) — both kept.
    const founded = cr.claims.filter((c) => c.valueKey === "founded_year");
    expect(founded.map((c) => c.value).sort()).toEqual(["2017", "2018"]);
    expect(founded.every((c) => c.verification === "CONFLICTING")).toBe(true);

    // Failed source is recorded with its reason; run steps reflect real work.
    const careers = view.runSources.find((s) => s.source.url === "https://acme.test/careers");
    expect(careers).toMatchObject({ outcome: "FAILED" });
    expect(careers!.source.fetchStatus).toBe("BLOCKED");
    const steps = (view.lastRun!.steps as { key: string; status: string }[]).map(
      (s) => `${s.key}:${s.status}`,
    );
    expect(steps).toEqual(
      expect.arrayContaining([
        "LOAD_JOB:DONE",
        "IDENTIFY_COMPANY:DONE",
        "COMPANY_SITE:DONE",
        "OFFICIAL_PAGES:DONE",
        "SEARCH:SKIPPED",
        "OFFICIAL_JOB:DONE",
        "JOB_EVIDENCE:DONE",
        "AI:SKIPPED",
        "VALIDATE:DONE",
        "BRIEF:DONE",
        "COMPLETE:DONE",
      ]),
    );
    const completeness = (r.completeness as { dimensions: { key: string; state: string }[] })
      .dimensions;
    expect(completeness.find((d) => d.key === "COMPANY_CAREERS")?.state).toBe("PARTIAL");

    // The shared company entity learns its website from the public job URL (system, LIKELY).
    expect(await db.prisma.company.findUnique({ where: { id: acme.id } })).toMatchObject({
      officialWebsite: "https://acme.test",
      websiteConfidence: "LIKELY",
    });
    const actions = (await db.prisma.auditLog.findMany({ where: { userId: user.userId } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "research_started",
        "research_completed",
        "claim_created",
        "claim_conflict",
      ]),
    );

    const md = await exportJobResearch(user, jobA.id, "md");
    expect(md).toMatch(/## Conflicting information/);
    expect(md).toMatch(/## Sources/);
    const json = JSON.parse(await exportJobResearch(user, jobA.id, "json"));
    expect(json.forTailoring.rolePriorities.length).toBeGreaterThan(0);
  });

  it("reuses company research across jobs of the same company", async () => {
    const user = await createTestUser(db.prisma, "Research Reuse");
    const acme = await company("Acme Reuse");
    const [a, b] = [await job(acme.id), await job(acme.id)];
    await researchJob(user, { jobId: a.id });
    const before = requested.length;
    const resB = await researchJob(user, { jobId: b.id });
    expect(
      await db.prisma.companyResearch.count({ where: { userId: user.userId, companyId: acme.id } }),
    ).toBe(1);
    expect(resB.companyResearch?.version).toBe(1);
    expect(requested.length).toBe(before); // no company page re-fetched
    const view = await getJobResearchView(user, b.id);
    expect(view.research!.companyResearchVersion).toBe(1);
    expect((view.lastRun!.steps as { key: string }[]).some((s) => s.key === "COMPANY_REUSED")).toBe(
      true,
    );
    // refreshCompany forces a new company version (history kept).
    await researchJob(user, { jobId: b.id, options: { refreshCompany: true } });
    expect(
      await db.prisma.companyResearch.count({ where: { userId: user.userId, companyId: acme.id } }),
    ).toBe(2);
    // Job A's research now references an older company version → STALE with the reason.
    const viewA = await getJobResearchView(user, a.id);
    expect(viewA.freshness).toMatchObject({
      freshness: "STALE",
      reasons: ["Company research was refreshed since"],
    });
  });

  it("refresh creates a new version and keeps history; stale by age and by job change", async () => {
    const user = await createTestUser(db.prisma, "Research Versions");
    const acme = await company("Acme Versions");
    const j = await job(acme.id);
    await researchJob(user, { jobId: j.id, options: { depth: "QUICK" } });
    let view = await getJobResearchView(user, j.id);
    expect(view.freshness.freshness).toBe("FRESH");

    // Required stale case: older than the freshness threshold.
    await db.prisma.jobResearch.updateMany({
      where: { jobId: j.id },
      data: { researchedAt: new Date(Date.now() - 60 * 86_400_000) },
    });
    view = await getJobResearchView(user, j.id);
    expect(view.freshness).toMatchObject({ freshness: "STALE", reasons: ["Older than 45 days"] });

    const run = await refreshResearch(user, { researchId: view.research!.id });
    expect(run.trigger).toBe("REFRESH");
    await executeResearchRun(user, run.id);
    view = await getJobResearchView(user, j.id);
    expect(view.research!.version).toBe(2);
    expect(view.history.map((h) => [h.version, h.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect((await getJobResearchView(user, j.id, view.history[1]!.id)).research!.version).toBe(1);
    expect(
      (
        await db.prisma.auditLog.findMany({
          where: { userId: user.userId, action: "research_refreshed" },
        })
      ).length,
    ).toBe(1);

    await db.prisma.job.update({ where: { id: j.id }, data: { contentHash: "f".repeat(64) } });
    view = await getJobResearchView(user, j.id);
    expect(view.freshness.reasons).toContain("The job description changed");
  });

  it("manual sources are fetched through the safe pipeline, invalidate research and feed the next run", async () => {
    const user = await createTestUser(db.prisma, "Research Manual");
    const acme = await company("Acme Manual");
    const j = await job(acme.id);
    await researchJob(user, { jobId: j.id, options: { depth: "QUICK" } });
    await expect(
      addManualSource(user, { jobId: j.id, url: "http://127.0.0.1/admin" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      addManualSource(user, { jobId: j.id, url: "file:///etc/passwd" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const src = await addManualSource(user, {
      companyId: acme.id,
      url: "https://news.test/acme-partnership",
    });
    expect(src).toMatchObject({
      sourceType: "MANUAL",
      addedByUser: true,
      fetchStatus: "OK",
      reliability: "SECONDARY",
    });
    const stale = await getJobResearchView(user, j.id);
    expect(stale.freshness.freshness).toBe("STALE");
    const res = await researchJob(user, {
      jobId: j.id,
      options: { depth: "QUICK", refreshCompany: true },
    });
    const view = await getCompanyResearchView(user, acme.id);
    expect(
      view.research!.claims.some((c) => c.section === "ACTIVITY" && /Globex/.test(c.claim)),
    ).toBe(true);
    expect(res.status).not.toBe("FAILED");
    expect(
      (
        await db.prisma.auditLog.findMany({
          where: { userId: user.userId, action: "source_added" },
        })
      ).length,
    ).toBe(1);
  });

  it("unknown website stays unknown; nothing fetched from a guessed domain", async () => {
    const user = await createTestUser(db.prisma, "Research Unknown");
    const globex = await company("Globex");
    const j = await job(globex.id, { jobUrl: "https://jobs.ashbyhq.com/globex/123" });
    const res = await researchJob(user, { jobId: j.id, options: { depth: "QUICK" } });
    expect(requested.filter((u) => !u.includes("ashbyhq"))).toEqual([]);
    expect(res.unknowns).toContain("Company website could not be confidently identified.");
    expect(res.status).toBe("PARTIAL");
    const view = await getJobResearchView(user, j.id);
    const site = (view.lastRun!.steps as { key: string; status: string; detail: string }[]).find(
      (s) => s.key === "COMPANY_SITE",
    );
    expect(site).toMatchObject({
      status: "SKIPPED",
      detail: "Company website could not be confidently identified.",
    });
    // The user confirms the website → company research invalidated and uses it next time.
    await setCompanyTarget(user, globex.id, { websiteUrl: "https://acme.test", careersUrl: "" });
    expect((await getCompanyResearchView(user, globex.id)).freshness.freshness).toBe("STALE");
    await expect(
      setCompanyTarget(user, globex.id, { websiteUrl: "http://localhost:3000", careersUrl: "" }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("source failures are isolated: unreachable site still yields job research (PARTIAL)", async () => {
    const user = await createTestUser(db.prisma, "Research Down");
    const acme = await company("Acme Down");
    const j = await job(acme.id);
    site = {
      "https://acme.test/robots.txt": { status: 404 },
      "https://acme.test": {
        error: new ResearchFetchError("NETWORK", "Network error (ECONNRESET)"),
      },
    };
    const res = await researchJob(user, { jobId: j.id, options: { depth: "QUICK" } });
    expect(res.status).toBe("PARTIAL");
    expect(res.jobResearch).not.toBeNull();
    expect(res.companyResearch!.brief).toBeTruthy();
    // Transient network errors were retried (1 + 2 retries), then recorded as failed.
    expect(requested.filter((u) => u === "https://acme.test").length).toBe(3);
    expect(res.companyResearch!.version).toBe(1);
    expect(
      (await db.prisma.companyResearch.findFirstOrThrow({ where: { userId: user.userId } })).status,
    ).toBe("FAILED");
    // A FAILED company research is never reused: the next job at this company retries it.
    site = defaultSite();
    const other = await job(acme.id);
    const again = await researchJob(user, { jobId: other.id, options: { depth: "QUICK" } });
    expect(again.companyResearch!.version).toBe(2);
    expect(requested).toContain("https://acme.test/about");
  });

  it("one active run per user; runs and research are private", async () => {
    const a = await createTestUser(db.prisma, "Research Iso A");
    const b = await createTestUser(db.prisma, "Research Iso B");
    const acme = await company("Acme Iso");
    const j = await job(acme.id);
    const run = await startJobResearch(a, j.id);
    await expect(startJobResearch(a, j.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(getRun(b, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await executeResearchRun(a, run.id);
    expect((await getRun(a, run.id)).status).not.toBe("RUNNING");

    await addNote(a, {
      jobId: j.id,
      body: "Looked at their careers page — several marketing roles.",
    });
    await saveResearchSettings(a, {
      defaultDepth: "DEEP",
      freshDays: 7,
      staleDays: 30,
      aiSynthesis: false,
    });
    expect((await getResearchSettings(b)).defaultDepth).toBe("STANDARD");
    const viewB = await getJobResearchView(b, j.id);
    expect(viewB.research).toBeNull();
    expect(viewB.notes).toHaveLength(0);
    const seen = await withUserContext(b.userId, async (t) => ({
      notes: await t.researchNote.count({ where: { userId: a.userId } }),
      jobResearch: await t.jobResearch.count({ where: { userId: a.userId } }),
      companyResearch: await t.companyResearch.count({ where: { userId: a.userId } }),
      claims: await t.researchClaim.count({ where: { userId: a.userId } }),
      evidence: await t.researchClaimEvidence.count({ where: { userId: a.userId } }),
      sources: await t.researchSource.count({ where: { userId: a.userId } }),
      runs: await t.researchRun.count({ where: { userId: a.userId } }),
      settings: await t.researchSettings.count({ where: { userId: a.userId } }),
    }));
    expect(seen).toEqual({
      notes: 0,
      jobResearch: 0,
      companyResearch: 0,
      claims: 0,
      evidence: 0,
      sources: 0,
      runs: 0,
      settings: 0,
    });
    // B cannot write into A's research through RLS.
    const aResearch = await db.prisma.jobResearch.findFirstOrThrow({ where: { userId: a.userId } });
    await expect(
      withUserContext(b.userId, (t) =>
        t.researchClaim.create({
          data: {
            userId: b.userId,
            jobResearchId: aResearch.id,
            section: "X",
            claim: "x",
            claimType: "FACT",
            verification: "VERIFIED_FROM_SOURCE",
          },
        }),
      ),
    ).rejects.toThrow();
    // Shared company facts stay visible to both users.
    expect((await listCompanies(b, { q: "Acme Iso" })).map((c) => c.name)).toEqual(["Acme Iso"]);
    // Private job of A is invisible to B.
    const priv = await job(acme.id, { privateFor: a.userId });
    await expect(startJobResearch(b, priv.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("AI synthesis (optional, validated)", () => {
  function provider(claims: unknown): AiProvider {
    return {
      id: "fake",
      local: true,
      async generateStructured(req) {
        const evidence = req.messages[1]!.content;
        const firstId = /\b(E\d+): .*CRM software/.exec(evidence)?.[1] ?? "E1";
        return {
          json:
            typeof claims === "function" ? (claims as (id: string) => unknown)(firstId) : claims,
          usage: {},
          model: req.model,
        };
      },
      async health(model) {
        return { ok: true, model, modelAvailable: true };
      },
    };
  }

  it("required: an unsupported AI claim (Dubai office) is rejected and never verified", async () => {
    const user = await createTestUser(db.prisma, "Research AI");
    await saveResearchSettings(user, {
      defaultDepth: "QUICK",
      freshDays: 14,
      staleDays: 45,
      aiSynthesis: true,
    });
    setProvidersForTests([
      provider((id: string) => ({
        claims: [
          { text: "The company opened a Dubai office.", type: "FACT", evidenceIds: [id] },
          {
            text: "Acme develops CRM software for small businesses.",
            type: "FACT",
            evidenceIds: [id],
          },
          {
            text: "The role appears focused on automation.",
            type: "INTERPRETATION",
            evidenceIds: [],
          },
        ],
      })),
    ]);
    const acme = await company("Acme AI");
    const j = await job(acme.id);
    await researchJob(user, { jobId: j.id });
    const view = await getJobResearchView(user, j.id);
    // The AI ran for the company research and for the job research.
    const companyAi = view.companyResearch!.claims.filter((c) => c.method === "AI");
    const jobAi = view.research!.claims.filter((c) => c.method === "AI");
    for (const ai of [companyAi, jobAi]) {
      const dubai = ai.find((c) => /Dubai/.test(c.claim))!;
      expect(dubai.verification).toBe("REJECTED");
      expect(dubai.rejectionReason).toMatch(/No supporting source.*Dubai/);
      expect(ai.find((c) => /focused on automation/.test(c.claim))?.rejectionReason).toBe(
        "No supporting source cited.",
      );
      expect(ai.some((c) => c.verification === "VERIFIED_FROM_SOURCE")).toBe(false);
    }
    // Supported by the cited homepage description → kept, but only as PENDING_REVIEW.
    const crm = companyAi.find((c) => /develops CRM/.test(c.claim))!;
    expect(crm.verification).toBe("PENDING_REVIEW");
    expect(crm.evidence[0]!.excerpt).toMatch(/CRM software/);
    const brief = view.research!.brief as { aiSynthesis: { text: string }[] };
    expect(brief.aiSynthesis.map((b) => b.text)).not.toContain(
      "The company opened a Dubai office.",
    );
    expect(view.lastRun).toMatchObject({ aiUsed: true, aiProvider: "fake" });
    // The database itself refuses an AI claim marked verified.
    await expect(
      withUserContext(user.userId, (t) =>
        t.researchClaim.create({
          data: {
            userId: user.userId,
            jobResearchId: view.research!.id,
            section: "AI_SYNTHESIS",
            claim: "x",
            claimType: "FACT",
            verification: "VERIFIED_FROM_SOURCE",
            method: "AI",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("invalid AI output is discarded; the deterministic research stands", async () => {
    const user = await createTestUser(db.prisma, "Research AI Bad");
    await saveResearchSettings(user, {
      defaultDepth: "QUICK",
      freshDays: 14,
      staleDays: 45,
      aiSynthesis: true,
    });
    setProvidersForTests([provider({ nonsense: true })]);
    const acme = await company("Acme AI Bad");
    const j = await job(acme.id);
    const res = await researchJob(user, { jobId: j.id });
    expect(res.jobResearch).not.toBeNull();
    const view = await getJobResearchView(user, j.id);
    expect(view.research!.claims.some((c) => c.method === "AI")).toBe(false);
    expect(
      (view.lastRun!.steps as { key: string; status: string }[]).find((s) => s.key === "AI")
        ?.status,
    ).toBe("FAILED");
  });
});

describe("workflow node", () => {
  it("returns current fresh research without a new run, and a versioned serializable result", async () => {
    const user = await createTestUser(db.prisma, "Research Node");
    const acme = await company("Acme Node");
    const j = await job(acme.id);
    const first = await runResearchNode(user, { jobId: j.id, options: { depth: "QUICK" } });
    const again = await runResearchNode(user, { jobId: j.id });
    expect(again).toMatchObject({ schemaVersion: 1, status: first.status });
    expect((again as unknown as { jobResearch: { version: number } }).jobResearch.version).toBe(1);
    expect(await db.prisma.researchRun.count({ where: { userId: user.userId } })).toBe(1);
    expect(() => JSON.stringify(again)).not.toThrow();
    await expect(runResearchNode(user, { jobId: j.id, companyId: acme.id })).rejects.toThrow();
  });
});
