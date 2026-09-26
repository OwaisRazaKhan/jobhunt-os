import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  EMPTY_SEARCH,
  parseSearchParams,
  type JobSearchParams,
} from "@/modules/jobs/search/params";
import { countJobStates, setJobState } from "@/modules/jobs/search/job-state.service";
import {
  createSavedSearch,
  deleteSavedSearch,
  duplicateSavedSearch,
  getSavedSearch,
  listSavedSearches,
  runSavedSearch,
  updateSavedSearch,
} from "@/modules/jobs/search/saved-searches.service";
import { loadSearchOptions, searchJobs } from "@/modules/jobs/search/search.service";
import { listCategories, listLocations } from "@/modules/search-profiles/config.service";
import { createSearchProfile } from "@/modules/search-profiles/profiles.service";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

/** Synthetic catalog in a disposable test database only — never seeded anywhere else. */

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };
const NOW = new Date("2026-09-26T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const J: Record<string, string> = {};
let ids: { ai: string; dm: string; blr: string; dubai: string; remoteIn: string; pune: string };

interface Seed {
  key: string;
  title: string;
  company: string;
  locationRaw: string;
  city?: string | null;
  countryCode: string | null;
  remoteStatus?: string;
  employmentType?: string;
  experienceLevel?: string;
  salary?: [number | null, number | null, string, string];
  sourceKey?: string;
  status?: string;
  postedAt?: Date | null;
  discoveredAt?: Date;
  lastSeenAt?: Date;
  categories?: string[];
  privateFor?: string;
  description?: string;
}

async function seed(s: Seed) {
  const company = await db.prisma.company.upsert({
    where: { nameNormalized: s.company.toLowerCase() },
    create: { name: s.company, nameNormalized: s.company.toLowerCase() },
    update: {},
  });
  const manual = s.sourceKey === "MANUAL";
  const job = await db.prisma.job.create({
    data: {
      companyId: company.id,
      sourceKey: s.sourceKey ?? "ASHBY",
      sourceType: manual ? "MANUAL" : "ATS_PUBLIC_API",
      sourceStatus: manual ? "USER_ENTERED" : "DISCOVERED",
      title: s.title,
      normalizedTitle: s.title.toLowerCase(),
      description: s.description ?? `Synthetic test description for ${s.title}.`,
      locationRaw: s.locationRaw,
      city: s.city ?? null,
      countryCode: s.countryCode,
      remoteStatus: s.remoteStatus ?? "UNKNOWN",
      employmentType: s.employmentType ?? "UNKNOWN",
      experienceLevel: s.experienceLevel ?? "UNKNOWN",
      salaryMin: s.salary?.[0] ?? null,
      salaryMax: s.salary?.[1] ?? null,
      salaryCurrency: s.salary?.[2] ?? null,
      salaryPeriod: s.salary?.[3] ?? null,
      postedAt: s.postedAt === undefined ? daysAgo(3) : s.postedAt,
      discoveredAt: s.discoveredAt ?? daysAgo(2),
      lastSeenAt: s.lastSeenAt ?? daysAgo(1),
      jobUrl: `https://example.test/jobs/${s.key}`,
      contentHash: "0".repeat(64),
      status: s.status ?? "OPEN",
      visibility: s.privateFor ? "PRIVATE" : "PUBLIC",
      createdByUserId: s.privateFor ?? null,
    },
  });
  for (const categoryId of s.categories ?? [])
    await db.prisma.jobCategoryAssignment.create({
      data: {
        jobId: job.id,
        categoryId,
        method: "RULE",
        confidence: 0.9,
        classifierVersion: "test",
      },
    });
  J[s.key] = job.id;
  return job;
}

const P = (over: Partial<JobSearchParams> = {}): JobSearchParams => ({ ...EMPTY_SEARCH, ...over });
const keysOf = async (
  actor: { userId: string },
  over: Partial<JobSearchParams>,
  view?: "all" | "bookmarked" | "hidden",
) => {
  const r = await searchJobs(actor, P(over), { now: NOW, view });
  return r.items.map((i) => Object.keys(J).find((k) => J[k] === i.id)).sort();
};

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Search A");
  userB = await createTestUser(db.prisma, "Test Search B");
  const locations = await listLocations(userA);
  const categories = await listCategories(userA);
  const loc = (name: string) => locations.find((l) => l.name === name)!.id;
  const cat = (key: string) => categories.find((c) => c.key === key)!.id;
  ids = {
    ai: cat("ai-automation"),
    dm: cat("digital-marketing"),
    blr: loc("Bengaluru"),
    dubai: loc("Dubai"),
    remoteIn: loc("Remote / Anywhere in India"),
    pune: loc("Pune"),
  };
  await seed({
    key: "j1",
    title: "AI Automation Specialist",
    company: "Acme AI",
    locationRaw: "Bengaluru, Karnataka, India",
    city: "Bengaluru",
    countryCode: "IN",
    remoteStatus: "HYBRID",
    employmentType: "FULL_TIME",
    experienceLevel: "ENTRY_LEVEL",
    salary: [600000, 900000, "INR", "YEAR"],
    sourceKey: "ASHBY",
    postedAt: daysAgo(2),
    categories: [ids.ai],
  });
  const j2 = await seed({
    key: "j2",
    title: "Digital Marketing Intern",
    company: "Growthly",
    locationRaw: "Bangalore",
    city: "Bangalore",
    countryCode: "IN",
    remoteStatus: "HYBRID",
    employmentType: "INTERNSHIP",
    experienceLevel: "INTERNSHIP",
    sourceKey: "LEVER",
    postedAt: daysAgo(20),
    categories: [ids.dm],
  });
  await db.prisma.jobSourcePosting.create({
    data: {
      jobId: j2.id,
      sourceKey: "GREENHOUSE",
      board: "growthly",
      externalJobId: "gh-1",
      jobUrl: "https://example.test/gh-1",
      contentHash: "1".repeat(64),
    },
  });
  await seed({
    key: "j3",
    title: "AI Engineer",
    company: "Berlin Labs",
    locationRaw: "Remote - Germany",
    countryCode: "DE",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    salary: [50000, 65000, "EUR", "YEAR"],
    sourceKey: "GREENHOUSE",
    postedAt: daysAgo(5),
    categories: [ids.ai],
  });
  await seed({
    key: "j4",
    title: "Digital Marketing Specialist",
    company: "Dubai Media",
    locationRaw: "Dubai, UAE",
    city: "Dubai",
    countryCode: "AE",
    remoteStatus: "ONSITE",
    employmentType: "FULL_TIME",
    experienceLevel: "JUNIOR",
    salary: [8000, 8000, "AED", "MONTH"],
    sourceKey: "ASHBY",
    status: "STALE",
    postedAt: null,
    discoveredAt: daysAgo(60),
    lastSeenAt: daysAgo(40),
    categories: [ids.dm],
  });
  await seed({
    key: "j5",
    title: "Automation Analyst",
    company: "Kolkata Works",
    locationRaw: "Remote, India",
    countryCode: "IN",
    remoteStatus: "REMOTE",
    employmentType: "FULL_TIME",
    experienceLevel: "ENTRY_LEVEL",
    salary: [300000, 400000, "INR", "YEAR"],
    sourceKey: "LEVER",
    status: "CLOSED",
    postedAt: daysAgo(10),
    categories: [ids.ai],
  });
  await seed({
    key: "j6",
    title: "Operations Associate",
    company: "Pune Co",
    locationRaw: "Pune",
    city: "Pune",
    countryCode: "IN",
    sourceKey: "GREENHOUSE",
    postedAt: daysAgo(4),
  });
  await seed({
    key: "j7",
    title: "Secret AI Automation role",
    company: "Private Co",
    locationRaw: "India",
    countryCode: "IN",
    sourceKey: "MANUAL",
    privateFor: userB.userId,
  });
});
afterAll(async () => db.stop());

describe("catalog visibility and search", () => {
  it("lists visible jobs only; another user's private job never appears", async () => {
    expect(await keysOf(userA, {})).toEqual(["j1", "j2", "j3", "j4", "j5", "j6"]);
    expect(await keysOf(userB, {})).toContain("j7");
  });

  it("searches title, company and location with prefix matching", async () => {
    expect(await keysOf(userA, { q: "automation" })).toEqual(["j1", "j5"]);
    expect(await keysOf(userA, { q: "AI automation" })).toEqual(["j1"]);
    expect(await keysOf(userA, { q: "acme" })).toEqual(["j1"]);
    expect(await keysOf(userA, { q: "berlin labs" })).toEqual(["j3"]);
    expect(await keysOf(userA, { q: "bengal" })).toEqual(["j1"]);
    expect(await keysOf(userA, { q: "Synthetic test description" })).toHaveLength(6);
  });

  it("treats hostile query text as plain text", async () => {
    for (const q of ["'; DROP TABLE jobs; --", "a & b | !c", ":*", "%_\\", "(((", "ümlaut ÄI"]) {
      await expect(searchJobs(userA, P({ q }), { now: NOW })).resolves.toBeDefined();
    }
    expect(await db.prisma.job.count()).toBe(7);
  });
});

describe("filters", () => {
  it("India + AI & Automation + Remote", async () => {
    expect(await keysOf(userA, { country: ["IN"], cat: [ids.ai], mode: ["REMOTE"] })).toEqual([
      "j5",
    ]);
  });

  it("India + Bengaluru + Hybrid (Bangalore alias included)", async () => {
    expect(await keysOf(userA, { country: ["IN"], loc: [ids.blr], mode: ["HYBRID"] })).toEqual([
      "j1",
      "j2",
    ]);
  });

  it("UAE + Dubai + Onsite + Digital Marketing", async () => {
    expect(
      await keysOf(userA, { country: ["AE"], loc: [ids.dubai], mode: ["ONSITE"], cat: [ids.dm] }),
    ).toEqual(["j4"]);
  });

  it("Germany + Remote + AI", async () => {
    expect(await keysOf(userA, { country: ["DE"], mode: ["REMOTE"], cat: [ids.ai] })).toEqual([
      "j3",
    ]);
  });

  it("Remote / Anywhere in India matches remote Indian jobs only; locations constrain only their own country", async () => {
    expect(await keysOf(userA, { country: ["IN"], loc: [ids.remoteIn] })).toEqual(["j5"]);
    expect(await keysOf(userA, { loc: [ids.pune] })).toEqual(["j6"]);
    expect(await keysOf(userA, { country: ["IN", "DE"], loc: [ids.blr] })).toEqual([
      "j1",
      "j2",
      "j3",
    ]);
  });

  it("multiple categories; uncategorised jobs are excluded by a category filter", async () => {
    expect(await keysOf(userA, { cat: [ids.ai, ids.dm] })).toEqual(["j1", "j2", "j3", "j4", "j5"]);
  });

  it("work mode: UNKNOWN is never treated as remote, and is selectable on its own", async () => {
    expect(await keysOf(userA, { mode: ["REMOTE"] })).toEqual(["j3", "j5"]);
    expect(await keysOf(userA, { mode: ["UNKNOWN"] })).toEqual(["j6"]);
    expect(await keysOf(userA, { mode: ["REMOTE", "HYBRID"] })).toEqual(["j1", "j2", "j3", "j5"]);
  });

  it("employment type and experience level", async () => {
    expect(await keysOf(userA, { type: ["INTERNSHIP"] })).toEqual(["j2"]);
    expect(await keysOf(userA, { exp: ["ENTRY_LEVEL", "GRADUATE"] })).toEqual(["j1", "j5"]);
    expect(await keysOf(userA, { exp: ["UNKNOWN"] })).toEqual(["j3", "j6"]);
  });

  it("salary: only same-currency salaries are compared; others and unknown are kept and labelled", async () => {
    const r = await searchJobs(userA, P({ salMin: 500000, cur: "INR" }), { now: NOW });
    const label = Object.fromEntries(
      r.items.map((i) => [Object.keys(J).find((k) => J[k] === i.id), i.salaryComparison]),
    );
    expect(label).toEqual({
      j1: "WITHIN_RANGE",
      j2: "NOT_STATED",
      j3: "CURRENCY_NOT_COMPARABLE",
      j4: "CURRENCY_NOT_COMPARABLE",
      j6: "NOT_STATED",
    }); // j5 (INR 300k–400k) is below the minimum → excluded; unknown is never zero
    expect(await keysOf(userA, { salMin: 500000, cur: "INR", salOnly: true })).toEqual(["j1"]);
    // Different period is not comparable either.
    const monthly = await searchJobs(userA, P({ salMin: 500000, cur: "INR", per: "MONTH" }), {
      now: NOW,
    });
    expect(monthly.items.find((i) => i.id === J.j1)?.salaryComparison).toBe(
      "PERIOD_NOT_COMPARABLE",
    );
    expect(await keysOf(userA, { salMax: 350000, cur: "INR", salOnly: true })).toEqual(["j5"]);
  });

  it("source filter includes additional postings; counts are real distinct jobs", async () => {
    expect(await keysOf(userA, { src: ["GREENHOUSE"] })).toEqual(["j2", "j3", "j6"]);
    const r = await searchJobs(userA, P({ src: ["GREENHOUSE"] }), { now: NOW });
    expect(Object.fromEntries(r.sourceCounts)).toEqual({ ASHBY: 2, GREENHOUSE: 3, LEVER: 2 });
    const india = await searchJobs(userA, P({ country: ["IN"] }), { now: NOW });
    expect(Object.fromEntries(india.sourceCounts)).toEqual({ ASHBY: 1, GREENHOUSE: 2, LEVER: 2 });
  });

  it("status and freshness", async () => {
    expect(await keysOf(userA, { status: ["STALE"] })).toEqual(["j4"]);
    expect(await keysOf(userA, { status: ["OPEN"] })).toEqual(["j1", "j2", "j3", "j6"]);
    expect(await keysOf(userA, { posted: 7 })).toEqual(["j1", "j3", "j6"]);
    expect(await keysOf(userA, { disc: 30 })).toEqual(["j1", "j2", "j3", "j5", "j6"]);
    expect(await keysOf(userA, { seen: 30 })).toEqual(["j1", "j2", "j3", "j5", "j6"]);
  });

  it("search profile filter uses the owner's hits only", async () => {
    const profile = await createSearchProfile(userA, { name: "India — AI" });
    await db.prisma.jobSearchProfileHit.create({
      data: { userId: userA.userId, profileId: profile.id, jobId: J.j1! },
    });
    expect(await keysOf(userA, { profile: profile.id })).toEqual(["j1"]);
    expect(await keysOf(userB, { profile: profile.id })).toEqual([]);
  });
});

describe("sorting and pagination", () => {
  it("sorts by allowlisted keys", async () => {
    const titles = async (over: Partial<JobSearchParams>) =>
      (await searchJobs(userA, P(over), { now: NOW })).items.map((i) => i.title);
    expect(await titles({ sort: "title" })).toEqual([
      "AI Automation Specialist",
      "AI Engineer",
      "Automation Analyst",
      "Digital Marketing Intern",
      "Digital Marketing Specialist",
      "Operations Associate",
    ]);
    expect((await titles({ sort: "newest" }))[0]).toBe("AI Automation Specialist");
    expect((await titles({ sort: "newest" })).at(-1)).toBe("Digital Marketing Specialist"); // no posted date → last
    expect((await titles({ sort: "company" }))[0]).toBe("AI Automation Specialist"); // Acme AI
    expect((await titles({ sort: "salary", cur: "INR" })).slice(0, 2)).toEqual([
      "AI Automation Specialist",
      "Automation Analyst",
    ]);
    const noCur = await searchJobs(userA, P({ sort: "salary" }), { now: NOW });
    expect(noCur.sortNote).toMatch(/needs a currency/);
  });

  it("pages server-side (25 per page)", async () => {
    for (let i = 0; i < 26; i++)
      await seed({
        key: `bulk${String(i).padStart(2, "0")}`,
        title: `Bulk Role ${i}`,
        company: "Bulk Co",
        locationRaw: "Tallinn",
        countryCode: "EE",
        sourceKey: "LEVER",
        postedAt: daysAgo(30 + i),
      });
    const p1 = await searchJobs(userA, P({ country: ["EE"] }), { now: NOW });
    const p2 = await searchJobs(userA, P({ country: ["EE"], page: 2 }), { now: NOW });
    expect([p1.total, p1.items.length, p1.pageCount]).toEqual([26, 25, 2]);
    expect(p2.items.map((i) => i.title)).toEqual(["Bulk Role 25"]);
    const beyond = await searchJobs(userA, P({ country: ["EE"], page: 9 }), { now: NOW });
    expect(beyond.items).toEqual([]);
  });
});

describe("bookmarks and hidden jobs", () => {
  it("bookmark, hide and restore are per-user and never touch the job", async () => {
    await setJobState(userA, J.j1!, "bookmark");
    await setJobState(userA, J.j6!, "hide");
    expect(await keysOf(userA, { country: ["IN"] })).toEqual(["j1", "j2", "j5"]);
    expect(await keysOf(userA, {}, "bookmarked")).toEqual(["j1"]);
    expect(await keysOf(userA, {}, "hidden")).toEqual(["j6"]);
    expect(await countJobStates(userA)).toEqual({ bookmarked: 1, hidden: 1 });
    // User B is unaffected.
    expect(await keysOf(userB, {}, "bookmarked")).toEqual([]);
    expect(await keysOf(userB, { country: ["IN"] })).toContain("j6");
    const item = (await searchJobs(userA, P({ q: "acme" }), { now: NOW })).items[0]!;
    expect(item).toMatchObject({ bookmarked: true, hidden: false });

    await setJobState(userA, J.j6!, "restore");
    expect(await keysOf(userA, {}, "hidden")).toEqual([]);
    expect(await keysOf(userA, { country: ["IN"] })).toContain("j6");
    await setJobState(userA, J.j1!, "unbookmark");
    expect(await db.prisma.userJobState.count({ where: { userId: userA.userId } })).toBe(0);
    expect(await db.prisma.job.count({ where: { id: { in: [J.j1!, J.j6!] } } })).toBe(2);
  });

  it("cannot bookmark a job the user cannot see; RLS blocks forged rows", async () => {
    await expect(setJobState(userA, J.j7!, "bookmark")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await setJobState(userB, J.j7!, "bookmark");
    const { withUserContext } = await import("@/server/db");
    const seenByA = await withUserContext(userA.userId, (t) => t.userJobState.findMany());
    expect(seenByA).toEqual([]);
    await expect(
      withUserContext(userA.userId, (t) =>
        t.userJobState.create({
          data: { userId: userB.userId, jobId: J.j1!, hiddenAt: new Date() },
        }),
      ),
    ).rejects.toBeTruthy();
  });
});

describe("saved searches", () => {
  it("stores canonical, validated params; runs, renames, duplicates, deletes", async () => {
    const saved = await createSavedSearch(userA, {
      name: "India Remote AI",
      params: {
        q: "AI automation",
        country: "in",
        mode: ["REMOTE", "BOGUS"],
        sort: "hack;--",
        page: "4",
      },
    });
    expect(saved.params).toEqual({ q: "AI automation", country: "IN", mode: "REMOTE" });
    const { params } = await runSavedSearch(userA, saved.id);
    expect(params).toMatchObject({
      q: "AI automation",
      country: ["IN"],
      mode: ["REMOTE"],
      page: 1,
    });
    expect((await getSavedSearch(userA, saved.id)).lastRunAt).not.toBeNull();

    await expect(
      createSavedSearch(userA, { name: "India Remote AI", params: {} }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(createSavedSearch(userA, { name: "  ", params: {} })).rejects.toBeInstanceOf(
      ZodError,
    );
    const renamed = await updateSavedSearch(userA, saved.id, {
      name: "India Remote AI (entry)",
      params: { country: "IN", exp: "ENTRY_LEVEL" },
    });
    expect(renamed).toMatchObject({
      name: "India Remote AI (entry)",
      params: { country: "IN", exp: "ENTRY_LEVEL" },
    });
    const copy = await duplicateSavedSearch(userA, saved.id);
    expect(copy.name).toBe("India Remote AI (entry) (copy)");
    expect((await listSavedSearches(userA)).map((s) => s.name).sort()).toEqual([
      "India Remote AI (entry)",
      "India Remote AI (entry) (copy)",
    ]);
    await deleteSavedSearch(userA, copy.id);
    expect(await listSavedSearches(userA)).toHaveLength(1);
  });

  it("another user can never read, run, change or delete them", async () => {
    const [mine] = await listSavedSearches(userA);
    expect(await listSavedSearches(userB)).toEqual([]);
    for (const attempt of [
      () => getSavedSearch(userB, mine!.id),
      () => runSavedSearch(userB, mine!.id),
      () => updateSavedSearch(userB, mine!.id, { name: "x" }),
      () => duplicateSavedSearch(userB, mine!.id),
      () => deleteSavedSearch(userB, mine!.id),
    ])
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("filter options come from the database", () => {
  it("lists countries (with real catalog counts), locations, categories and own profiles", async () => {
    const opts = await loadSearchOptions(userA);
    expect(opts.countries.find((c) => c.code === "IN")).toMatchObject({
      isTargetMarket: true,
      jobs: 4,
    });
    expect(opts.locations.some((l) => l.name === "Kolkata")).toBe(true);
    expect(opts.categories).toHaveLength(16);
    expect(opts.profiles.map((p) => p.name)).toEqual(["India — AI"]);
    expect((await loadSearchOptions(userB)).profiles).toEqual([]);
  });

  it("URL parsing drops invalid values and never passes them on", () => {
    const { params, invalid } = parseSearchParams({
      q: "x".repeat(500),
      country: ["IN", "india", "de"],
      loc: "not-a-uuid",
      mode: "REMOTE,SPACESHIP",
      salMin: "-5",
      sort: "1; DROP TABLE",
      page: "99999",
      posted: "2",
    });
    expect(params).toMatchObject({
      country: ["IN", "DE"],
      loc: [],
      mode: ["REMOTE"],
      salMin: null,
      sort: "newest",
      page: 1,
      posted: null,
    });
    expect(params.q).toHaveLength(200);
    expect(invalid.sort()).toEqual([
      "country",
      "loc",
      "mode",
      "page",
      "posted",
      "q",
      "salMin",
      "sort",
    ]);
    // A salary without currency is not applied.
    expect(parseSearchParams({ salMin: "500000" }).params.salMin).toBeNull();
  });
});
