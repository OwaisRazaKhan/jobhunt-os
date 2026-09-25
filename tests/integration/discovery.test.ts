import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { canonicalJobSchema, type CanonicalJob } from "@/modules/jobs/discovery/canonical";
import { ingestBoard } from "@/modules/jobs/discovery/ingest";
import {
  executeDiscoveryRun,
  getDiscoveryRun,
  startDiscovery,
} from "@/modules/jobs/discovery/run.service";
import {
  getSourceByKey,
  setSourceEnabled,
  updateSourceConfiguration,
} from "@/modules/jobs/sources.service";
import {
  addCategory,
  addLocation,
  addTerm,
  deleteCategory,
  deleteLocation,
  deleteTerm,
  listCategories,
  listLocations,
} from "@/modules/search-profiles/config.service";
import {
  createSearchProfile,
  deleteSearchProfile,
  duplicateSearchProfile,
  getSearchProfile,
  listSearchProfiles,
  setSearchProfileEnabled,
  updateSearchProfile,
} from "@/modules/search-profiles/profiles.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };
let ids: { bengaluru: string; pune: string; dubai: string; ai: string; marketing: string };

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Discovery A");
  userB = await createTestUser(db.prisma, "Test Discovery B");
  const locations = await listLocations(userA);
  const categories = await listCategories(userA);
  const loc = (name: string) => locations.find((l) => l.name === name)!.id;
  const cat = (key: string) => categories.find((c) => c.key === key)!.id;
  ids = {
    bengaluru: loc("Bengaluru"),
    pune: loc("Pune"),
    dubai: loc("Dubai"),
    ai: cat("ai-automation"),
    marketing: cat("digital-marketing"),
  };
});
afterAll(async () => db.stop());

describe("seeded configuration", () => {
  it("treats India as a target market with configurable Indian locations", async () => {
    const india = await db.prisma.country.findUnique({ where: { code: "IN" } });
    expect(india?.isTargetMarket).toBe(true);
    const names = (await listLocations(userA))
      .filter((l) => l.countryCode === "IN")
      .map((l) => l.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Kolkata",
        "Bengaluru",
        "Hyderabad",
        "Mumbai",
        "Delhi NCR",
        "Gurugram",
        "Noida",
        "Pune",
        "Chennai",
        "Ahmedabad",
        "Remote / Anywhere in India",
      ]),
    );
  });
  it("has 16 data-driven categories with search terms; users add their own terms", async () => {
    const categories = await listCategories(userA);
    expect(categories).toHaveLength(16);
    expect(categories.find((c) => c.key === "ai-automation")!.terms.map((t) => t.term)).toEqual(
      expect.arrayContaining(["n8n", "Zapier", "Make.com"]),
    );
    await addTerm(userA, { categoryId: ids.ai, term: "Automation Analyst" });
    const mine = (await listCategories(userA))
      .find((c) => c.id === ids.ai)!
      .terms.find((t) => t.term === "Automation Analyst");
    expect(mine?.own).toBe(true);
    // Another user never sees it.
    expect(
      (await listCategories(userB))
        .find((c) => c.id === ids.ai)!
        .terms.some((t) => t.term === "Automation Analyst"),
    ).toBe(false);
  });
});

describe("search configuration management (locations, categories, terms)", () => {
  it("adds and removes own locations; system locations are read-only; others never see them", async () => {
    const kochi = await addLocation(userA, {
      countryCode: "IN",
      name: "Kochi",
      kind: "CITY",
      aliases: "Cochin\ncochin",
    });
    expect(kochi.aliases).toEqual(["cochin"]);
    expect((await listLocations(userA)).find((l) => l.id === kochi.id)?.own).toBe(true);
    expect((await listLocations(userB)).some((l) => l.id === kochi.id)).toBe(false);
    await expect(
      addLocation(userA, { countryCode: "ZZ", name: "Nowhere", aliases: "" }),
    ).rejects.toBeTruthy();
    await expect(deleteLocation(userA, ids.bengaluru)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(deleteLocation(userB, kochi.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteLocation(userA, kochi.id);
    expect((await listLocations(userA)).some((l) => l.id === kochi.id)).toBe(false);
  });

  it("custom categories with terms; duplicate terms rejected; system terms protected", async () => {
    const growth = await addCategory(userA, { name: "Growth", description: "" });
    expect(growth.key).toBe("my-growth");
    const term = await addTerm(userA, { categoryId: growth.id, term: "Growth Associate" });
    await expect(
      addTerm(userA, { categoryId: growth.id, term: "growth associate" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(addTerm(userB, { categoryId: growth.id, term: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const systemTerm = (await listCategories(userA))
      .find((c) => c.id === ids.ai)!
      .terms.find((t) => !t.own)!;
    await expect(deleteTerm(userA, systemTerm.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteCategory(userA, ids.ai)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await deleteTerm(userA, term.id);
    await deleteCategory(userA, growth.id);
    expect((await listCategories(userA)).some((c) => c.id === growth.id)).toBe(false);
  });
});

describe("search profile CRUD and ownership", () => {
  let profileId = "";
  const india = () => ({
    name: "India — AI & Automation",
    countryCodes: ["IN"],
    locationIds: [ids.bengaluru, ids.pune],
    categoryIds: [ids.ai],
    workModes: ["REMOTE", "HYBRID"],
    employmentTypes: ["FULL_TIME", "INTERNSHIP"],
    experienceLevels: ["ENTRY_LEVEL"],
    searchTerms: "AI Workflow\nLLM Operations",
  });

  it("creates a profile with countries, cities, categories, work modes, job types and experience", async () => {
    const created = await createSearchProfile(userA, india());
    profileId = created.id;
    const p = await getSearchProfile(userA, created.id);
    expect(p).toMatchObject({
      name: "India — AI & Automation",
      countryCodes: ["IN"],
      workModes: ["REMOTE", "HYBRID"],
      employmentTypes: ["FULL_TIME", "INTERNSHIP"],
      experienceLevels: ["ENTRY_LEVEL"],
      searchTerms: ["AI Workflow", "LLM Operations"],
      visaPreference: "UNKNOWN",
      enabled: true,
    });
    expect(p.locations.map((l) => l.location.name).sort()).toEqual(["Bengaluru", "Pune"]);
    expect(p.categories.map((c) => c.category.key)).toEqual(["ai-automation"]);
  });

  it("rejects a location outside the selected countries and a salary without currency", async () => {
    await expect(
      createSearchProfile(userA, { ...india(), name: "Bad", locationIds: [ids.dubai] }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(
      createSearchProfile(userA, { ...india(), name: "Bad 2", salaryMin: "500000" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("rejects duplicate names per user but allows the same name for another user", async () => {
    await expect(createSearchProfile(userA, india())).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    const other = await createSearchProfile(userB, {
      name: "India — AI & Automation",
      countryCodes: ["IN"],
    });
    expect(other.userId).toBe(userB.userId);
  });

  it("updates, duplicates (disabled copy), disables and enables", async () => {
    await updateSearchProfile(userA, profileId, {
      ...india(),
      salaryMin: "400000",
      salaryCurrency: "inr",
      salaryPeriod: "YEAR",
      visaPreference: "SPONSORSHIP_NOT_REQUIRED",
    });
    expect(await getSearchProfile(userA, profileId)).toMatchObject({
      salaryMin: 400000,
      salaryCurrency: "INR",
      visaPreference: "SPONSORSHIP_NOT_REQUIRED",
    });
    const copy = await duplicateSearchProfile(userA, profileId);
    expect(copy).toMatchObject({ name: "India — AI & Automation (copy)", enabled: false });
    expect((await getSearchProfile(userA, copy.id)).locations).toHaveLength(2);
    await setSearchProfileEnabled(userA, profileId, false);
    expect((await getSearchProfile(userA, profileId)).enabled).toBe(false);
    await setSearchProfileEnabled(userA, profileId, true);
    await deleteSearchProfile(userA, copy.id);
    await expect(getSearchProfile(userA, copy.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("user B can never see or change user A's profiles (service + RLS)", async () => {
    expect((await listSearchProfiles(userB)).every((p) => p.userId === userB.userId)).toBe(true);
    await expect(getSearchProfile(userB, profileId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateSearchProfile(userB, profileId, { name: "Hijack" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(deleteSearchProfile(userB, profileId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const raw = await withUserContext(userB.userId, (t) =>
      t.searchProfile.findMany({ where: { id: profileId } }),
    );
    expect(raw).toEqual([]);
    const forged = withUserContext(userB.userId, (t) =>
      t.searchProfileLocation.create({
        data: { profileId, locationId: ids.pune, userId: userB.userId },
      }),
    );
    await expect(forged).rejects.toBeTruthy();
  });
});

function canonical(over: Partial<CanonicalJob> & { externalJobId: string }): CanonicalJob {
  return canonicalJobSchema.parse({
    sourceKey: "GREENHOUSE",
    board: "testco",
    title: "Growth Marketing Manager",
    companyName: "Test Ingest Co",
    description: "Synthetic description for ingestion tests. ".repeat(10),
    locationRaw: "Bengaluru, India",
    city: "Bengaluru",
    region: null,
    countryCode: "IN",
    employmentType: "FULL_TIME",
    employmentTypeRaw: "Full-time",
    remoteStatus: "HYBRID",
    remoteStatusRaw: null,
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    salaryRaw: null,
    postedAt: null,
    sourceUpdatedAt: null,
    jobUrl: `https://boards.greenhouse.io/testco/jobs/${over.externalJobId}`,
    applicationUrl: null,
    sourceUrl: null,
    department: null,
    team: null,
    visaTextRaw: null,
    raw: {},
    ...over,
  });
}

describe("ingestion and deduplication", () => {
  let sourceId = "";
  const categories: { id: string; terms: string[] }[] = [];
  beforeAll(async () => {
    sourceId = (await getSourceByKey(userA, "GREENHOUSE")).id;
    categories.push({ id: ids.marketing, terms: ["Growth Marketing", "Digital Marketing"] });
  });
  const ingest = (jobs: CanonicalJob[], over: Partial<Parameters<typeof ingestBoard>[0]> = {}) =>
    ingestBoard({
      sourceKey: "GREENHOUSE",
      board: "testco",
      sourceId,
      jobs,
      complete: true,
      categories,
      ...over,
    });

  it("layer 1: creates once, then reports unchanged / updated", async () => {
    const first = await ingest([
      canonical({ externalJobId: "1" }),
      canonical({ externalJobId: "2", title: "Junior Data Analyst" }),
    ]);
    expect(first).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    const again = await ingest([
      canonical({ externalJobId: "1" }),
      canonical({ externalJobId: "2", title: "Junior Data Analyst" }),
    ]);
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    const changed = await ingest([
      canonical({
        externalJobId: "1",
        salaryMin: 900000,
        salaryMax: 1200000,
        salaryCurrency: "INR",
        salaryPeriod: "YEAR",
      }),
      canonical({ externalJobId: "2", title: "Junior Data Analyst" }),
    ]);
    expect(changed).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const job = await db.prisma.job.findFirst({
      where: { externalJobId: "2", sourceKey: "GREENHOUSE" },
    });
    expect(job).toMatchObject({
      visibility: "PUBLIC",
      sourceStatus: "DISCOVERED",
      experienceLevel: "JUNIOR",
      experienceLevelRaw: "Junior",
    });
    const assignment = await db.prisma.jobCategoryAssignment.findFirst({
      where: { job: { externalJobId: "1" }, userId: null },
    });
    expect(assignment).toMatchObject({
      categoryId: ids.marketing,
      method: "RULE",
      matchedTerms: ["Growth Marketing"],
    });
  });

  it("layer 2: the same job on another board becomes a second source posting, not a duplicate job", async () => {
    const before = await db.prisma.job.count();
    const other = await ingest([canonical({ externalJobId: "x-1", board: "testco-careers" })], {
      board: "testco-careers",
    });
    expect(other).toMatchObject({ created: 0, duplicates: 1 });
    expect(await db.prisma.job.count()).toBe(before);
    const job = await db.prisma.job.findFirst({
      where: { externalJobId: "1", sourceKey: "GREENHOUSE" },
      include: { postings: true },
    });
    expect(job!.postings.map((p) => p.board).sort()).toEqual(["testco", "testco-careers"]);
  });

  it("layer 3: an uncertain cross-source match is created AND flagged, never merged", async () => {
    const flagged = await ingest(
      [
        canonical({
          externalJobId: "y-1",
          board: "testco-eu",
          title: "Growth Marketing Manager (Bengaluru)",
          city: null,
          locationRaw: "India",
        }),
      ],
      { board: "testco-eu" },
    );
    expect(flagged).toMatchObject({ created: 1, flagged: 1 });
    const candidate = await db.prisma.jobDuplicateCandidate.findFirst({
      where: { job: { externalJobId: "y-1" } },
    });
    expect(candidate).toMatchObject({ status: "PENDING", reason: "SAME_CONTENT" });
  });

  it("closes jobs only after a complete fetch, never after a truncated one", async () => {
    const truncated = await ingest([canonical({ externalJobId: "1" })], { complete: false });
    expect(truncated.closed).toBe(0);
    const complete = await ingest([canonical({ externalJobId: "1" })]);
    expect(complete.closed).toBe(1);
    expect(
      (await db.prisma.job.findFirst({ where: { externalJobId: "2", sourceKey: "GREENHOUSE" } }))
        ?.status,
    ).toBe("CLOSED");
    // Job 1 stays open: it is still listed (here and on testco-careers).
    expect(
      (await db.prisma.job.findFirst({ where: { externalJobId: "1", sourceKey: "GREENHOUSE" } }))
        ?.status,
    ).toBe("OPEN");
  });
});

// Synthetic Ashby board (field names follow the public Job Posting API).
const ashbyJob = (
  id: string,
  title: string,
  city: string,
  country: string,
  workplaceType: string,
  employmentType = "FullTime",
) => ({
  id,
  title,
  department: "Marketing",
  team: null,
  employmentType,
  location: `${city}, ${country}`,
  secondaryLocations: [],
  publishedAt: "2026-09-20T10:00:00.000+00:00",
  isListed: true,
  isRemote: workplaceType === "Remote",
  workplaceType,
  address: { postalAddress: { addressLocality: city, addressCountry: country } },
  jobUrl: `https://jobs.ashbyhq.com/indiatest/${id}`,
  applyUrl: null,
  descriptionPlain: `Synthetic role: ${title}.`,
});
const ASHBY_INDIA = {
  jobs: [
    ashbyJob(
      "aaaaaaaa-0000-4000-8000-000000000001",
      "AI Automation Specialist",
      "Bengaluru",
      "India",
      "Hybrid",
    ),
    ashbyJob(
      "aaaaaaaa-0000-4000-8000-000000000002",
      "Digital Marketing Intern",
      "Bengaluru",
      "India",
      "Hybrid",
      "Intern",
    ),
    ashbyJob(
      "aaaaaaaa-0000-4000-8000-000000000003",
      "AI Automation Specialist",
      "Dubai",
      "United Arab Emirates",
      "OnSite",
    ),
    ashbyJob(
      "aaaaaaaa-0000-4000-8000-000000000004",
      "Backend Engineer",
      "Berlin",
      "Germany",
      "Remote",
    ),
  ],
};

describe("search profile → discovery run → job relationship", () => {
  it("runs the selected profile, saves canonical jobs once and links every profile that found them", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    await updateSourceConfiguration(userA, ashby.id, { boards: "indiatest = India Test Co" });
    await setSourceEnabled(userA, ashby.id, true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(ASHBY_INDIA), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    try {
      const ai = await createSearchProfile(userA, {
        name: "India — AI Remote/Hybrid",
        countryCodes: ["IN"],
        categoryIds: [ids.ai],
        workModes: ["REMOTE", "HYBRID"],
        sourceKeys: ["ASHBY"],
      });
      const blr = await createSearchProfile(userA, {
        name: "India — Bengaluru Hybrid",
        countryCodes: ["IN"],
        locationIds: [ids.bengaluru],
        workModes: ["HYBRID"],
        sourceKeys: ["ASHBY"],
      });
      const uae = await createSearchProfile(userA, {
        name: "UAE — AI Onsite Dubai",
        countryCodes: ["AE"],
        locationIds: [ids.dubai],
        categoryIds: [ids.ai],
        workModes: ["ONSITE"],
        sourceKeys: ["ASHBY"],
      });

      const run1 = await startDiscovery(userA, ai.id);
      await expect(startDiscovery(userA, blr.id)).rejects.toMatchObject({ code: "CONFLICT" });
      await executeDiscoveryRun(userA, run1.id);
      const done1 = await getDiscoveryRun(userA, run1.id);
      expect(done1).toMatchObject({
        status: "SUCCEEDED",
        stage: "DONE",
        sourcesTotal: 1,
        sourcesDone: 1,
        fetched: 4,
        valid: 4,
        created: 4,
        matched: 1,
      });
      expect(done1.syncRuns[0]).toMatchObject({
        status: "SUCCEEDED",
        kind: "SYNC",
        board: "indiatest",
        created: 4,
      });

      for (const profile of [blr, uae]) {
        const run = await startDiscovery(userA, profile.id);
        await executeDiscoveryRun(userA, run.id);
        expect((await getDiscoveryRun(userA, run.id)).status).toBe("SUCCEEDED");
      }
      const hits = await withUserContext(userA.userId, (t) =>
        t.jobSearchProfileHit.findMany({
          include: { job: { select: { title: true, city: true } } },
        }),
      );
      const byProfile = (id: string) =>
        hits
          .filter((h) => h.profileId === id)
          .map((h) => `${h.job.title} @ ${h.job.city}`)
          .sort();
      expect(byProfile(ai.id)).toEqual(["AI Automation Specialist @ Bengaluru"]);
      expect(byProfile(blr.id)).toEqual([
        "AI Automation Specialist @ Bengaluru",
        "Digital Marketing Intern @ Bengaluru",
      ]);
      expect(byProfile(uae.id)).toEqual(["AI Automation Specialist @ Dubai"]);
      // One canonical job, found by two profiles.
      const blrAi = hits.filter(
        (h) => h.job.title === "AI Automation Specialist" && h.job.city === "Bengaluru",
      );
      expect(new Set(blrAi.map((h) => h.jobId)).size).toBe(1);
      expect(blrAi).toHaveLength(2);
      const intern = await db.prisma.job.findFirst({
        where: { title: "Digital Marketing Intern" },
      });
      expect(intern).toMatchObject({
        employmentType: "INTERNSHIP",
        experienceLevel: "INTERNSHIP",
        remoteStatus: "HYBRID",
        countryCode: "IN",
      });
      // Profile hits are private to their owner.
      expect(await withUserContext(userB.userId, (t) => t.jobSearchProfileHit.count())).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to run a disabled profile or another user's profile", async () => {
    const p = await createSearchProfile(userA, { name: "Disabled one", countryCodes: ["IN"] });
    await setSearchProfileEnabled(userA, p.id, false);
    await expect(startDiscovery(userA, p.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(startDiscovery(userB, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
