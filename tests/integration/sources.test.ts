import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  ensureDefaultSources,
  getSource,
  listSources,
  setSourceEnabled,
  updateSourceConfiguration,
} from "@/modules/jobs/sources.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Source A");
  userB = await createTestUser(db.prisma, "Test Source B");
});
afterAll(async () => db.stop());

const byKey = async (user: { userId: string }, key: string) =>
  (await listSources(user)).find((s) => s.sourceKey === key)!;

describe("source creation & listing", () => {
  it("creates the four default sources once, with honest initial states", async () => {
    const sources = await listSources(userA);
    expect(sources.map((s) => s.sourceKey)).toEqual(["ASHBY", "LEVER", "GREENHOUSE", "MANUAL"]);
    for (const s of sources.filter((s) => s.sourceKey !== "MANUAL")) {
      expect(s).toMatchObject({
        status: "PENDING_VERIFICATION",
        termsStatus: "VERIFIED",
        enabled: false,
        accessMethod: "PUBLIC_POSTINGS_API",
      });
      // Documentation review is recorded with its date; status stays pending until a live test.
      expect(s.termsReviewedAt?.toISOString().slice(0, 10)).toBe("2026-09-26");
      expect(s.lastSyncAt).toBeNull();
      expect(s.lastSuccessAt).toBeNull();
      expect(s.lastTestedAt).toBeNull();
    }
    expect(sources.find((s) => s.sourceKey === "MANUAL")).toMatchObject({
      sourceName: "Manual Entry",
      status: "READY",
      accessMethod: "USER_ENTERED",
      termsStatus: "NOT_APPLICABLE",
      enabled: true,
    });
    expect(await ensureDefaultSources(userA)).toBe(0);
    expect(await db.prisma.jobSource.count({ where: { userId: userA.userId } })).toBe(4);
  });

  it("the database refuses a VERIFIED terms status without a review date", async () => {
    const ashby = await byKey(userA, "ASHBY");
    await expect(
      db.prisma.jobSource.update({ where: { id: ashby.id }, data: { termsReviewedAt: null } }),
    ).rejects.toBeTruthy();
    await expect(
      db.prisma.jobSource.update({ where: { id: ashby.id }, data: { status: "WORKING" } }),
    ).rejects.toBeTruthy();
  });
});

describe("registry upgrade", () => {
  it("records the documentation review on older rows without changing their status", async () => {
    const lever = await byKey(userA, "LEVER");
    await db.prisma.jobSource.update({
      where: { id: lever.id },
      data: { termsStatus: "NOT_REVIEWED", termsReviewedAt: null },
    });
    await ensureDefaultSources(userA);
    const after = await getSource(userA, lever.id);
    expect(after.termsStatus).toBe("VERIFIED");
    expect(after.termsReviewedAt).toBeInstanceOf(Date);
    expect(after.status).toBe("PENDING_VERIFICATION");
  });
});

describe("source configuration", () => {
  it("accepts optional company display names per board", async () => {
    const ashby = await byKey(userA, "ASHBY");
    const updated = await updateSourceConfiguration(userA, ashby.id, {
      boards: "linear = Linear\nacme\nLINEAR = Duplicate",
    });
    expect(updated.configuration).toEqual({ boards: ["linear = Linear", "acme"] });
    await updateSourceConfiguration(userA, ashby.id, { boards: "" });
  });

  it("saves validated source-specific configuration, rate limits and notes", async () => {
    const lever = await byKey(userA, "LEVER");
    const updated = await updateSourceConfiguration(userA, lever.id, {
      sites: "acme\nexample-co\nacme",
      region: "EU",
      requestsPerMinute: "20",
      maxPagesPerSync: "5",
      maxJobsPerSync: "500",
      timeoutMs: "10000",
      notes: "  Synthetic note  ",
    });
    expect(updated.configuration).toEqual({ sites: ["acme", "example-co"], region: "EU" });
    expect(updated.rateLimitSettings).toEqual({
      requestsPerMinute: 20,
      maxPagesPerSync: 5,
      maxJobsPerSync: 500,
      timeoutMs: 10000,
    });
    expect(updated.notes).toBe("Synthetic note");
    expect(updated.status).toBe("PENDING_VERIFICATION");
  });

  it("accepts the provider's own careers link, rejects other URLs, unsafe identifiers and out-of-range limits", async () => {
    const ashby = await byKey(userA, "ASHBY");
    const saved = await updateSourceConfiguration(userA, ashby.id, {
      boards: "https://jobs.ashbyhq.com/Acme/7aaa13dc?utm=x = Acme Inc",
    });
    expect((saved.configuration as { boards: string[] }).boards).toEqual(["Acme = Acme Inc"]);
    // Another provider's link or any other site is not silently turned into a board name.
    for (const bad of ["https://jobs.lever.co/acme", "https://example.com/acme"]) {
      await expect(
        updateSourceConfiguration(userA, ashby.id, { boards: bad }),
      ).rejects.toBeInstanceOf(ZodError);
    }
    await expect(
      updateSourceConfiguration(userA, ashby.id, { boards: "../etc/passwd" }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      updateSourceConfiguration(userA, ashby.id, { boards: "acme", requestsPerMinute: 1000 }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      updateSourceConfiguration(userA, ashby.id, { boards: "acme", timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ZodError);
    const lever = await byKey(userA, "LEVER");
    await expect(
      updateSourceConfiguration(userA, lever.id, { sites: "acme", region: "MARS" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("manual entry has no external configuration", async () => {
    const manual = await byKey(userA, "MANUAL");
    const updated = await updateSourceConfiguration(userA, manual.id, {
      notes: "Only my own jobs",
      boards: "ignored",
    });
    expect(updated.configuration).toEqual({});
    expect(updated.rateLimitSettings).toEqual({});
  });
});

describe("enable / disable", () => {
  it("requires configuration before enabling an ATS source; manual can toggle", async () => {
    const greenhouse = await byKey(userA, "GREENHOUSE");
    await expect(setSourceEnabled(userA, greenhouse.id, true)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await updateSourceConfiguration(userA, greenhouse.id, { boardTokens: "acme" });
    expect((await setSourceEnabled(userA, greenhouse.id, true)).enabled).toBe(true);
    // Removing all boards auto-disables it.
    expect(
      (await updateSourceConfiguration(userA, greenhouse.id, { boardTokens: "" })).enabled,
    ).toBe(false);

    const manual = await byKey(userA, "MANUAL");
    expect((await setSourceEnabled(userA, manual.id, false)).enabled).toBe(false);
    expect((await setSourceEnabled(userA, manual.id, true)).enabled).toBe(true);
  });

  it("records audit entries without configuration values", async () => {
    const audits = await db.prisma.auditLog.findMany({
      where: { userId: userA.userId, resourceType: "job_source" },
    });
    const actions = audits.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "sources_initialized",
        "source_updated",
        "source_enabled",
        "source_disabled",
      ]),
    );
    expect(JSON.stringify(audits.map((a) => a.metadata))).not.toContain("example-co");
  });
});

describe("cross-user isolation", () => {
  it("User B cannot read, configure or toggle User A's sources by id", async () => {
    const aLever = await byKey(userA, "LEVER");
    await expect(getSource(userB, aLever.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      updateSourceConfiguration(userB, aLever.id, { sites: "hijack" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setSourceEnabled(userB, aLever.id, true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getSource(userA, aLever.id)).configuration).toEqual({
      sites: ["acme", "example-co"],
      region: "EU",
    });
  });

  it("each user gets independent source records", async () => {
    const bSources = await listSources(userB);
    expect(bSources).toHaveLength(4);
    expect(bSources.find((s) => s.sourceKey === "LEVER")!.configuration).toEqual({});
  });

  it("RLS hides other users' sources even without a userId filter and blocks forged writes", async () => {
    const visible = await withUserContext(userB.userId, (tx) => tx.jobSource.findMany());
    expect(visible.every((s) => s.userId === userB.userId)).toBe(true);
    const aLever = await byKey(userA, "LEVER");
    const result = await withUserContext(userB.userId, (tx) =>
      tx.jobSource.updateMany({ where: { id: aLever.id }, data: { enabled: true } }),
    );
    expect(result.count).toBe(0);
    await expect(
      withUserContext(userB.userId, (tx) =>
        tx.jobSource.create({
          data: {
            userId: userA.userId,
            sourceKey: "ASHBY",
            sourceName: "x",
            sourceType: "ATS_PUBLIC_API",
            status: "READY",
            accessMethod: "PUBLIC_POSTINGS_API",
            termsStatus: "NOT_REVIEWED",
          },
        }),
      ),
    ).rejects.toBeTruthy();
  });
});
