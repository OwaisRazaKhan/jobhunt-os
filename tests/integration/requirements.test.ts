import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { replaceJobRequirements } from "@/modules/matching/match.service";
import { EXTRACTOR_VERSION } from "@/modules/matching/requirements/extract";
import {
  ensureJobRequirements,
  listRequirementSets,
  refreshRequirementsForJobs,
} from "@/modules/matching/requirements/requirements.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };
let publicJob: string;
let privateJobB: string;

const JD = [
  "Requirements",
  "• 2+ years of experience in digital marketing",
  "• Hands-on experience with GA4",
  "Nice to have",
  "• HubSpot",
].join("\n");

async function job(data: {
  title: string;
  description: string;
  privateFor?: string;
  hash?: string;
}) {
  const company = await db.prisma.company.upsert({
    where: { nameNormalized: "req test co" },
    create: { name: "Req Test Co", nameNormalized: "req test co" },
    update: {},
  });
  const manual = Boolean(data.privateFor);
  return (
    await db.prisma.job.create({
      data: {
        companyId: company.id,
        sourceKey: manual ? "MANUAL" : "ASHBY",
        sourceType: manual ? "MANUAL" : "ATS_PUBLIC_API",
        sourceStatus: manual ? "USER_ENTERED" : "DISCOVERED",
        title: data.title,
        normalizedTitle: data.title.toLowerCase(),
        description: data.description,
        locationRaw: "Pune, India",
        city: "Pune",
        countryCode: "IN",
        remoteStatus: "HYBRID",
        employmentType: "FULL_TIME",
        jobUrl: "https://example.test/req",
        contentHash: data.hash ?? "a".repeat(64),
        visibility: manual ? "PRIVATE" : "PUBLIC",
        createdByUserId: data.privateFor ?? null,
      },
    })
  ).id;
}

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Req A");
  userB = await createTestUser(db.prisma, "Test Req B");
  publicJob = await job({ title: "Growth Marketing Associate", description: JD });
  privateJobB = await job({ title: "Private Role", description: JD, privateFor: userB.userId });
});
afterAll(async () => db.stop());

describe("requirement extraction and versioning", () => {
  it("extracts once, then reuses the current set", async () => {
    const first = await ensureJobRequirements(userA, publicJob);
    expect(first.extracted).toBe(true);
    expect(first.set).toMatchObject({
      version: 1,
      extractorVersion: EXTRACTOR_VERSION,
      isCurrent: true,
    });
    const summary = first.set.requirements.map(
      (r) => `${r.requirementType}:${r.category}:${r.text}`,
    );
    expect(summary).toEqual(
      expect.arrayContaining([
        "REQUIRED:WORK_MODE:Hybrid",
        "REQUIRED:EMPLOYMENT:Full time",
        "REQUIRED:SKILL:Google Analytics 4",
        "PREFERRED:SKILL:HubSpot",
      ]),
    );
    expect(first.set.requirementCount).toBe(first.set.requirements.length);
    const ga4 = first.set.requirements.find((r) => r.text === "Google Analytics 4")!;
    expect(ga4).toMatchObject({
      sourceText: "Hands-on experience with GA4",
      sourceReference: "description:L3",
      extractionMethod: "RULE",
    });
    // Another user sees the same shared requirements; nothing is re-extracted.
    const again = await ensureJobRequirements(userB, publicJob);
    expect(again).toMatchObject({ extracted: false, set: { id: first.set.id } });
  });

  it("creates a new version when the job content changes and keeps the old one", async () => {
    await db.prisma.job.update({
      where: { id: publicJob },
      data: { description: `${JD}\n• Fluent English`, contentHash: "b".repeat(64) },
    });
    const next = await ensureJobRequirements(userA, publicJob);
    expect(next).toMatchObject({ extracted: true, set: { version: 2, isCurrent: true } });
    expect(next.set.requirements.some((r) => r.category === "LANGUAGE")).toBe(true);
    const sets = await listRequirementSets(userA, publicJob);
    expect(sets.map((s) => [s.version, s.isCurrent])).toEqual([
      [2, true],
      [1, false],
    ]);
    // Old requirement rows are still there (traceability of earlier matches).
    expect(await db.prisma.jobRequirement.count({ where: { jobId: publicJob } })).toBeGreaterThan(
      next.set.requirements.length,
    );
  });

  it("concurrent requests do not create two current sets", async () => {
    await db.prisma.job.update({ where: { id: publicJob }, data: { contentHash: "c".repeat(64) } });
    const results = await Promise.all([
      ensureJobRequirements(userA, publicJob),
      ensureJobRequirements(userB, publicJob),
    ]);
    expect(new Set(results.map((r) => r.set.id)).size).toBe(1);
    expect(
      await db.prisma.jobRequirementSet.count({ where: { jobId: publicJob, isCurrent: true } }),
    ).toBe(1);
  });

  it("system refresh skips jobs whose set is current", async () => {
    expect(await refreshRequirementsForJobs([publicJob])).toBe(0);
    await db.prisma.job.update({ where: { id: publicJob }, data: { contentHash: "d".repeat(64) } });
    expect(await refreshRequirementsForJobs([publicJob])).toBe(1);
  });
});

describe("ownership and RLS", () => {
  it("another user's private job is invisible, including its requirement sets", async () => {
    await ensureJobRequirements(userB, privateJobB);
    await expect(ensureJobRequirements(userA, privateJobB)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const leaked = await withUserContext(userA.userId, (t) =>
      Promise.all([
        t.jobRequirementSet.findMany({ where: { jobId: privateJobB } }),
        t.jobRequirement.findMany({ where: { jobId: privateJobB } }),
      ]),
    );
    expect(leaked).toEqual([[], []]);
  });

  it("users cannot write requirement sets for shared jobs; owners can edit their private job's requirements", async () => {
    await expect(
      withUserContext(userA.userId, (t) =>
        t.jobRequirementSet.create({
          data: {
            jobId: publicJob,
            version: 99,
            extractorVersion: "forged",
            jobContentHash: "e".repeat(64),
            isCurrent: false,
          },
        }),
      ),
    ).rejects.toBeTruthy();
    await expect(replaceJobRequirements(userA, publicJob, [])).rejects.toMatchObject({
      code: "PERMISSION_ERROR",
    });
    const set = await replaceJobRequirements(userB, privateJobB, [
      {
        category: "SKILL",
        requirementType: "REQUIRED",
        text: "Python",
        normalizedValue: { skill: "python" },
        sourceText: "Python (added by me)",
        confidence: 1,
        sourceReference: "user",
        extractionMethod: "USER",
        extractorVersion: "user",
      },
    ]);
    expect(set).toMatchObject({ extractorVersion: "user", isCurrent: true });
    // A user-maintained set is kept even though the extractor would produce something else.
    expect((await ensureJobRequirements(userB, privateJobB)).extracted).toBe(false);
  });
});

describe("pending migration detection", () => {
  it("recognises a missing table as 'database behind the code'", async () => {
    const { isSchemaOutOfDate } = await import("@/server/db");
    await db.pg.exec(`ALTER TABLE "job_requirement_sets" RENAME TO "job_requirement_sets_off"`);
    try {
      const error = await ensureJobRequirements(userA, publicJob).catch((e: unknown) => e);
      expect(isSchemaOutOfDate(error)).toBe(true);
    } finally {
      await db.pg.exec(`ALTER TABLE "job_requirement_sets_off" RENAME TO "job_requirement_sets"`);
    }
    expect(isSchemaOutOfDate(new Error("connection refused"))).toBe(false);
  });
});
