import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  createManualJob,
  deleteManualJob,
  getJob,
  jobCountsBySource,
  listJobs,
  purgeDeletedJobs,
  updateManualJob,
} from "@/modules/jobs/jobs.service";
import { getSourceByKey, setSourceEnabled } from "@/modules/jobs/sources.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };

const job = (over: Record<string, unknown> = {}) => ({
  title: "Test Marketing Specialist",
  company: "Test Company GmbH",
  jobUrl: "https://jobs.example.com/test-1",
  locationRaw: "Berlin, Germany",
  countryCode: "DE",
  description: "Synthetic job description for tests.",
  ...over,
});

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Jobs A");
  userB = await createTestUser(db.prisma, "Test Jobs B");
});
afterAll(async () => db.stop());

describe("manual job creation", () => {
  it("creates a job with manual attribution, private visibility and a company", async () => {
    const created = await createManualJob(
      userA,
      job({
        salaryMin: "50000",
        salaryMax: "65000",
        salaryCurrency: "EUR",
        salaryPeriod: "YEAR",
        remoteStatus: "HYBRID",
        employmentType: "FULL_TIME",
        visaTextRaw: "Visa sponsorship available",
        postedAt: "2026-09-01",
        notes: "My note",
      }),
    );
    expect(created).toMatchObject({
      sourceKey: "MANUAL",
      sourceType: "MANUAL",
      sourceStatus: "USER_ENTERED",
      visibility: "PRIVATE",
      createdByUserId: userA.userId,
      status: "OPEN",
      salaryMin: 50000,
      salaryMax: 65000,
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      remoteStatus: "HYBRID",
      jobUrl: "https://jobs.example.com/test-1",
      normalizedTitle: "test marketing specialist",
    });
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const manual = await getSourceByKey(userA, "MANUAL");
    expect(created.sourceId).toBe(manual.id);
    const company = await db.prisma.company.findUniqueOrThrow({ where: { id: created.companyId } });
    expect(company).toMatchObject({ name: "Test Company GmbH", nameNormalized: "testcompany" });
  });

  it("reuses the company for name variants (no obvious duplicates)", async () => {
    const second = await createManualJob(
      userA,
      job({ company: "test company", jobUrl: "https://jobs.example.com/test-2" }),
    );
    const third = await createManualJob(
      userB,
      job({ company: "TEST COMPANY", jobUrl: "https://jobs.example.com/test-3" }),
    );
    const first = (await listJobs(userA)).find((j) => j.title === "Test Marketing Specialist")!;
    const a = await getJob(userA, first.id);
    expect(second.companyId).toBe(a.job.companyId);
    expect(third.companyId).toBe(a.job.companyId);
    expect(await db.prisma.company.count({ where: { nameNormalized: "testcompany" } })).toBe(1);
  });

  it("rejects invalid input without saving anything", async () => {
    const before = await db.prisma.job.count();
    await expect(createManualJob(userA, job({ title: "" }))).rejects.toBeInstanceOf(ZodError);
    await expect(createManualJob(userA, job({ jobUrl: "not a url" }))).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(
      createManualJob(userA, job({ jobUrl: "file:///etc/passwd" })),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      createManualJob(
        userA,
        job({ salaryMin: "90000", salaryMax: "10000", salaryCurrency: "EUR" }),
      ),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(createManualJob(userA, job({ countryCode: "QQ" }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(await db.prisma.job.count()).toBe(before);
  });

  it("refuses manual entry while the Manual source is disabled", async () => {
    const manual = await getSourceByKey(userA, "MANUAL");
    await setSourceEnabled(userA, manual.id, false);
    await expect(
      createManualJob(userA, job({ jobUrl: "https://jobs.example.com/x" })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await setSourceEnabled(userA, manual.id, true);
  });
});

describe("listing, detail, counts", () => {
  it("lists only the caller's jobs with '—'-able unknowns", async () => {
    const aJobs = await listJobs(userA);
    expect(aJobs.length).toBe(2);
    expect(aJobs.every((j) => j.sourceName === "Manual Entry")).toBe(true);
    const unknown = aJobs.find((j) => j.salaryMin === null)!;
    expect(unknown.employmentType).toBeNull();
    expect(unknown.remoteStatus).toBe("UNKNOWN");
    expect((await listJobs(userB)).length).toBe(1);
  });

  it("returns detail with canEdit for the creator", async () => {
    const [first] = await listJobs(userA);
    const detail = await getJob(userA, first!.id);
    expect(detail.canEdit).toBe(true);
    expect(detail.job.company.name).toBeTruthy();
  });

  it("counts jobs per source from real rows", async () => {
    const manual = await getSourceByKey(userA, "MANUAL");
    const counts = await jobCountsBySource(userA, [manual.id]);
    expect(counts.get(manual.id)).toBe(2);
  });
});

describe("edit & delete", () => {
  it("updates a job, re-hashes content and audits changed fields only", async () => {
    const [first] = await listJobs(userA);
    const before = (await getJob(userA, first!.id)).job;
    const updated = await updateManualJob(
      userA,
      first!.id,
      job({
        title: "Test Senior Specialist",
        jobUrl: before.jobUrl,
        company: "Other Test Company",
      }),
    );
    expect(updated.title).toBe("Test Senior Specialist");
    expect(updated.contentHash).not.toBe(before.contentHash);
    expect(updated.companyId).not.toBe(before.companyId);
    const audit = await db.prisma.auditLog.findFirstOrThrow({
      where: { userId: userA.userId, action: "job_updated" },
    });
    expect(audit.metadata).toMatchObject({
      fields: expect.arrayContaining(["title", "companyId"]),
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("Senior");
  });

  it("soft-deletes: hidden immediately, purged after retention", async () => {
    const [first] = await listJobs(userA);
    await deleteManualJob(userA, first!.id);
    expect((await listJobs(userA)).some((j) => j.id === first!.id)).toBe(false);
    await expect(getJob(userA, first!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.prisma.job.count({ where: { id: first!.id } })).toBe(1); // retained
    await db.prisma.job.update({
      where: { id: first!.id },
      data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    expect(await purgeDeletedJobs(30)).toBeGreaterThanOrEqual(1);
    expect(await db.prisma.job.count({ where: { id: first!.id } })).toBe(0);
    const actions = (await db.prisma.auditLog.findMany({ where: { userId: userA.userId } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(["job_created", "job_updated", "job_deleted"]));
  });
});

describe("authorization & isolation", () => {
  it("User B cannot view, edit or delete User A's private job", async () => {
    const [aJob] = await listJobs(userA);
    await expect(getJob(userB, aJob!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateManualJob(userB, aJob!.id, job({ title: "Hijacked" })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteManualJob(userB, aJob!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getJob(userA, aJob!.id)).job.title).not.toBe("Hijacked");
  });

  it("RLS hides private jobs and blocks forged writes, public inserts and hard deletes", async () => {
    const [aJob] = await listJobs(userA);
    expect(
      await withUserContext(userB.userId, (tx) => tx.job.findMany({ where: { id: aJob!.id } })),
    ).toEqual([]);
    const upd = await withUserContext(userB.userId, (tx) =>
      tx.job.updateMany({ where: { id: aJob!.id }, data: { title: "x" } }),
    );
    expect(upd.count).toBe(0);
    const company = await db.prisma.company.findFirstOrThrow();
    const base = {
      companyId: company.id,
      sourceKey: "ASHBY",
      sourceType: "ATS_PUBLIC_API",
      sourceStatus: "DISCOVERED",
      title: "t",
      normalizedTitle: "t",
      description: "d",
      locationRaw: "l",
      jobUrl: "https://example.com/x",
      contentHash: "0".repeat(64),
    };
    await expect(
      withUserContext(userB.userId, (tx) =>
        tx.job.create({ data: { ...base, visibility: "PUBLIC" } }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(userB.userId, (tx) =>
        tx.job.create({ data: { ...base, visibility: "PRIVATE", createdByUserId: userA.userId } }),
      ),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(userA.userId, (tx) => tx.job.deleteMany({ where: { id: aJob!.id } })),
    ).rejects.toBeTruthy();
    await expect(
      withUserContext(userA.userId, (tx) => tx.company.updateMany({ data: { name: "Renamed" } })),
    ).rejects.toBeTruthy();
  });

  it("the database enforces manual attribution and salary logic", async () => {
    const company = await db.prisma.company.findFirstOrThrow();
    const base = {
      companyId: company.id,
      title: "t",
      normalizedTitle: "t",
      description: "d",
      locationRaw: "l",
      jobUrl: "https://example.com/x",
      contentHash: "0".repeat(64),
      createdByUserId: userA.userId,
    };
    await expect(
      db.prisma.job.create({
        data: {
          ...base,
          sourceKey: "MANUAL",
          sourceType: "MANUAL",
          sourceStatus: "DISCOVERED",
          visibility: "PRIVATE",
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      db.prisma.job.create({
        data: {
          ...base,
          sourceKey: "MANUAL",
          sourceType: "MANUAL",
          sourceStatus: "USER_ENTERED",
          visibility: "PRIVATE",
          salaryMin: 10,
          salaryMax: 5,
        },
      }),
    ).rejects.toBeTruthy();
    await expect(
      db.prisma.job.create({
        data: {
          ...base,
          sourceKey: "MANUAL",
          sourceType: "MANUAL",
          sourceStatus: "USER_ENTERED",
          visibility: "PRIVATE",
          jobUrl: "javascript:alert(1)",
        },
      }),
    ).rejects.toBeTruthy();
  });
});
