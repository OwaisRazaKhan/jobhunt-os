import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/internal/cron/discovery/route";
import { resetServerEnvCache } from "@/config/env";
import { claimDueProfiles, runDueDiscovery } from "@/modules/jobs/discovery/scheduler.service";
import {
  getSourceByKey,
  setSourceEnabled,
  updateSourceConfiguration,
} from "@/modules/jobs/sources.service";
import { createSearchProfile, getSearchProfile } from "@/modules/search-profiles/profiles.service";
import { ASHBY_BOARD } from "../fixtures/sources";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let userA: { userId: string };
let userB: { userId: string };
const HOUR = 3_600_000;
const SECRET = "test-only-cron-secret-0123456789abcdef";

beforeAll(async () => {
  db = await startTestDb();
  userA = await createTestUser(db.prisma, "Test Sched A");
  userB = await createTestUser(db.prisma, "Test Sched B");
});
afterAll(async () => db.stop());
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
  resetServerEnvCache();
});

const setDue = (id: string, nextRunAt: Date | null) =>
  db.prisma.searchProfile.update({ where: { id }, data: { nextRunAt } });

describe("due profile selection and claiming", () => {
  it("claims only enabled, scheduled, due profiles — across users — exactly once", async () => {
    const now = new Date();
    const due = await createSearchProfile(userA, { name: "Due", scheduleIntervalHours: "24" });
    const later = await createSearchProfile(userA, { name: "Later", scheduleIntervalHours: "24" });
    const manual = await createSearchProfile(userA, { name: "Manual only" });
    const otherUser = await createSearchProfile(userB, {
      name: "B due",
      scheduleIntervalHours: "72",
    });
    const disabled = await createSearchProfile(userB, {
      name: "B off",
      scheduleIntervalHours: "24",
    });
    await setDue(due.id, new Date(now.getTime() - 1000));
    await setDue(otherUser.id, new Date(now.getTime() - 2000));
    await setDue(manual.id, new Date(now.getTime() - 1000)); // no interval → never scheduled
    await db.prisma.searchProfile.update({
      where: { id: disabled.id },
      data: { enabled: false, nextRunAt: new Date(now.getTime() - 1000) },
    });
    expect(later.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());

    const [first, second] = await Promise.all([
      claimDueProfiles(now, 10),
      claimDueProfiles(now, 10),
    ]);
    const all = [...first, ...second].map((c) => c.profileId).sort();
    expect(all).toEqual([due.id, otherUser.id].sort());
    // Claiming moved next_run_at one interval ahead.
    const after = await db.prisma.searchProfile.findUnique({ where: { id: otherUser.id } });
    expect(after!.nextRunAt!.getTime()).toBe(now.getTime() + 72 * HOUR);
    expect(await claimDueProfiles(now, 10)).toEqual([]);
    await db.prisma.searchProfile.deleteMany({});
  });
});

describe("scheduled discovery runs", () => {
  it("runs due profiles through the normal pipeline with trigger SCHEDULED; skips unrunnable ones", async () => {
    const ashby = await getSourceByKey(userA, "ASHBY");
    await updateSourceConfiguration(userA, ashby.id, { boards: "schedco" });
    await setSourceEnabled(userA, ashby.id, true);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(ASHBY_BOARD), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const now = new Date();
    const a1 = await createSearchProfile(userA, { name: "A daily", scheduleIntervalHours: "24" });
    const a2 = await createSearchProfile(userA, { name: "A weekly", scheduleIntervalHours: "168" });
    const b1 = await createSearchProfile(userB, {
      name: "B no boards",
      scheduleIntervalHours: "24",
    });
    for (const p of [a1, a2, b1]) await setDue(p.id, new Date(now.getTime() - 60_000));

    const outcomes = await runDueDiscovery({ now, limit: 10 });
    const byProfile = new Map(outcomes.map((o) => [o.profileId, o]));
    // Two profiles of the same user run one after another, never concurrently.
    expect(byProfile.get(a1.id)).toMatchObject({ status: "SUCCEEDED" });
    expect(byProfile.get(a2.id)).toMatchObject({ status: "SUCCEEDED" });
    expect(byProfile.get(b1.id)).toMatchObject({ status: "SKIPPED", runId: null });
    expect(byProfile.get(b1.id)!.reason).toMatch(/No enabled source/);
    // The skip is visible in B's run history (not A's).
    const skipped = await db.prisma.discoveryRun.findMany({ where: { profileId: b1.id } });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      userId: userB.userId,
      status: "CANCELLED",
      trigger: "SCHEDULED",
    });
    expect(skipped[0]!.message).toMatch(/^Scheduled run skipped: No enabled source/);

    const runs = await db.prisma.discoveryRun.findMany({ where: { userId: userA.userId } });
    expect(runs.map((r) => r.trigger)).toEqual(["SCHEDULED", "SCHEDULED"]);
    const p = await getSearchProfile(userA, a1.id);
    expect(p.lastRunAt).not.toBeNull();
    expect(p.nextRunAt!.getTime()).toBeGreaterThan(now.getTime() + 23 * HOUR);
    // Nothing is due any more.
    expect(await runDueDiscovery({ now, limit: 10 })).toEqual([]);
  });
});

describe("internal cron endpoint", () => {
  const call = (handler: typeof GET, auth?: string) =>
    handler(
      new Request("http://localhost/api/internal/cron/discovery", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      }),
      { params: Promise.resolve({}) },
    );

  it("is disabled (404) without CRON_SECRET", async () => {
    expect((await call(POST, `Bearer ${SECRET}`)).status).toBe(404);
  });

  it("rejects a missing or wrong secret and accepts the right one (GET or POST)", async () => {
    process.env.CRON_SECRET = SECRET;
    resetServerEnvCache();
    expect((await call(POST)).status).toBe(401);
    expect((await call(POST, "Bearer wrong-secret-wrong-secret-wrong-secret")).status).toBe(401);
    const ok = await call(GET, `Bearer ${SECRET}`);
    expect(ok.status).toBe(202);
    expect(await ok.json()).toEqual({ data: { claimed: 0 } });
    const body = await (await call(POST, "Bearer nope")).text();
    expect(body).not.toContain(SECRET);
  });
});
