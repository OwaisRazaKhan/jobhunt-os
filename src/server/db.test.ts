import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { isDeadConnectionError, setDbForTests, withUserContext } from "./db";

const USER = "01a0da8c-9e8d-73cc-9fdf-a5eb590d153b";
const dead = () => new Error("Connection terminated unexpectedly");

/** Fake client: `failures` decides, per $transaction call, where it throws. */
function fakeDb(plan: ("dead-before" | "dead-after" | "other" | "ok")[]) {
  let call = 0;
  const work = vi.fn(async () => "result");
  const $transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const step = plan[call++] ?? "ok";
    const tx = {
      $executeRaw: async () => {
        if (step === "dead-before") throw dead();
        return 1;
      },
      $executeRawUnsafe: async () => 1,
    };
    const out = await fn(tx);
    if (step === "dead-after") throw dead();
    if (step === "other") throw new Error("violates check constraint");
    return out;
  });
  setDbForTests({ $transaction } as unknown as PrismaClient);
  return { $transaction, work };
}

afterEach(() => setDbForTests(undefined));

describe("withUserContext dead-connection handling", () => {
  it("retries once on a fresh connection when the stale one fails before any work ran", async () => {
    const db = fakeDb(["dead-before", "ok"]);
    await expect(withUserContext(USER, db.work)).resolves.toBe("result");
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.work).toHaveBeenCalledTimes(1);
  });

  it("never retries after the caller's work started (no repeated side effects)", async () => {
    const db = fakeDb(["dead-after", "ok"]);
    await expect(withUserContext(USER, db.work)).rejects.toBeTruthy();
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it("retries at most once and does not retry other errors", async () => {
    const twice = fakeDb(["dead-before", "dead-before", "ok"]);
    await expect(withUserContext(USER, twice.work)).rejects.toBeTruthy();
    expect(twice.$transaction).toHaveBeenCalledTimes(2);
    const other = fakeDb(["other"]);
    await expect(withUserContext(USER, other.work)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(other.$transaction).toHaveBeenCalledTimes(1);
  });

  it("recognises dead-connection errors", () => {
    expect(isDeadConnectionError(dead())).toBe(true);
    expect(isDeadConnectionError(new Error("read ECONNRESET"))).toBe(true);
    expect(isDeadConnectionError(new Error("duplicate key value"))).toBe(false);
  });
});
