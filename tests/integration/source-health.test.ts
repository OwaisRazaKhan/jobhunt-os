import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AUTO_PAUSE_AFTER,
  executeDiscoveryRun,
  getActiveDiscoveryRun,
  getSourceHistory,
  listSourceHealth,
  startDiscovery,
  STALE_RUN_MS,
  testSource,
} from "@/modules/jobs/discovery/run.service";
import { createSearchProfile } from "@/modules/search-profiles/profiles.service";
import {
  getSourceByKey,
  listSources,
  setSourceEnabled,
  updateSourceConfiguration,
} from "@/modules/jobs/sources.service";
import { ASHBY_BOARD } from "../fixtures/sources";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };

const ok = () =>
  new Response(JSON.stringify(ASHBY_BOARD), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const notFound = () => new Response("not found", { status: 404 });

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Health A");
  userB = await createTestUser(db.prisma, "Test Health B");
});
afterAll(async () => db.stop());
afterEach(() => vi.unstubAllGlobals());

describe("source test, history and health", () => {
  it("a source without runs is untested, never healthy", async () => {
    const sources = await listSources(userA);
    const health = await listSourceHealth(userA, sources);
    const ashby = sources.find((s) => s.sourceKey === "ASHBY")!;
    const manual = sources.find((s) => s.sourceKey === "MANUAL")!;
    expect(health.get(ashby.id)?.status).toBe("DISABLED");
    expect(health.get(manual.id)?.status).toBe("NOT_APPLICABLE");
  });

  it("refuses to test without boards", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    await expect(testSource(userA, ashby.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("records a successful test in history and marks the source READY + HEALTHY", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    await updateSourceConfiguration(userA, ashby.id, { boards: "goodco" });
    await setSourceEnabled(userA, ashby.id, true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    const results = await testSource(userA, ashby.id);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ board: "goodco", ok: true });
    const { source, runs, health } = await getSourceHistory(userA, ashby.id);
    expect(source.status).toBe("READY");
    expect(source.lastTestedAt).not.toBeNull();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: "TEST", status: "SUCCEEDED", board: "goodco" });
    expect(runs[0]!.fetched).toBe(results[0]!.fetched);
    expect(runs[0]!.fetched).toBeGreaterThan(0);
    expect(health).toMatchObject({ status: "HEALTHY", successRate: 100 });
    // A test never writes to the job catalog.
    expect(await db.prisma.job.count()).toBe(0);
  });

  it("failures are recorded honestly; three in a row make the source FAILING", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => notFound()),
    );
    for (let i = 0; i < 3; i++) {
      const [r] = await testSource(userA, ashby.id);
      expect(r).toMatchObject({ ok: false });
    }
    const { source, runs, health } = await getSourceHistory(userA, ashby.id);
    expect(source.status).toBe("ERROR");
    expect(source.lastError).toContain("goodco");
    expect(runs.slice(0, 3).every((r) => r.status === "FAILED" && r.errorMessage)).toBe(true);
    expect(health).toMatchObject({ status: "FAILING", consecutiveFailures: 3, succeeded: 1 });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ok()),
    );
    await testSource(userA, ashby.id);
    const after = await getSourceHistory(userA, ashby.id);
    expect(after.health).toMatchObject({ status: "DEGRADED", consecutiveFailures: 0 });
  });

  it("another user can neither test nor read the history", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    await expect(testSource(userB, ashby.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getSourceHistory(userB, ashby.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const health = await listSourceHealth(userB, [
      { id: ashby.id, enabled: true, sourceKey: "ASHBY" },
    ]);
    // RLS + userId filter: B sees no runs for A's source.
    expect(health.get(ashby.id)?.sample).toBe(0);
  });
});

describe("hardening", () => {
  it(`pauses a source automatically after ${AUTO_PAUSE_AFTER} failed syncs in a row (tests do not count)`, async () => {
    const user = await createTestUser(db.prisma, "Test Pause");
    const lever = await getSourceByKey(user, "LEVER");
    await updateSourceConfiguration(user, lever.id, { sites: "brokenco" });
    await setSourceEnabled(user, lever.id, true);
    const profile = await createSearchProfile(user, { name: "Pause me", sourceKeys: ["LEVER"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => notFound()),
    );
    for (let i = 0; i < AUTO_PAUSE_AFTER; i++) {
      expect((await getSourceByKey(user, "LEVER")).enabled).toBe(true);
      const run = await startDiscovery(user, profile.id);
      await executeDiscoveryRun(user, run.id);
    }
    const paused = await getSourceByKey(user, "LEVER");
    expect(paused.enabled).toBe(false);
    expect(paused.lastError).toMatch(/^Paused automatically after 5 failed syncs in a row/);
    const audit = await db.prisma.auditLog.findMany({
      where: { userId: user.userId, action: "source_auto_paused" },
    });
    expect(audit).toHaveLength(1);
    // A paused source is no longer used by discovery.
    await expect(startDiscovery(user, profile.id)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("fails runs and board rows that stopped responding", async () => {
    const user = await createTestUser(db.prisma, "Test Stale");
    const old = new Date(Date.now() - STALE_RUN_MS - 60_000);
    const run = await db.prisma.discoveryRun.create({
      data: {
        userId: user.userId,
        trigger: "MANUAL",
        status: "RUNNING",
        stage: "FETCHING",
        heartbeatAt: old,
        createdAt: old,
      },
    });
    const sync = await db.prisma.sourceSyncRun.create({
      data: {
        userId: user.userId,
        discoveryRunId: run.id,
        sourceKey: "ASHBY",
        board: "stuck",
        status: "RUNNING",
        startedAt: old,
      },
    });
    expect(await getActiveDiscoveryRun(user)).toBeNull();
    expect(await db.prisma.discoveryRun.findUnique({ where: { id: run.id } })).toMatchObject({
      status: "FAILED",
    });
    expect(await db.prisma.sourceSyncRun.findUnique({ where: { id: sync.id } })).toMatchObject({
      status: "FAILED",
      errorKind: "STALE",
    });
  });
});
