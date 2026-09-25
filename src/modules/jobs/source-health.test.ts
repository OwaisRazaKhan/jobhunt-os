import { describe, expect, it } from "vitest";
import { computeSourceHealth, FAILING_AFTER } from "./source-health";

const at = (min: number) => new Date(Date.UTC(2026, 8, 25, 12, min));
const run = (status: string, min: number) => ({ status, startedAt: at(min) });
const on = { enabled: true, manual: false };

describe("source health", () => {
  it("no runs is UNTESTED (enabled) or DISABLED, never healthy", () => {
    expect(computeSourceHealth([], on).status).toBe("UNTESTED");
    expect(computeSourceHealth([], { enabled: false, manual: false }).status).toBe("DISABLED");
    expect(computeSourceHealth([], on).successRate).toBeNull();
  });

  it("all successful runs are HEALTHY with a 100% rate", () => {
    const h = computeSourceHealth([run("SUCCEEDED", 1), run("SUCCEEDED", 2)], on);
    expect(h).toMatchObject({ status: "HEALTHY", successRate: 100, consecutiveFailures: 0 });
    expect(h.lastSuccessAt).toEqual(at(2));
  });

  it("a recent failure or older failures in the window are DEGRADED", () => {
    expect(computeSourceHealth([run("SUCCEEDED", 1), run("FAILED", 2)], on)).toMatchObject({
      status: "DEGRADED",
      consecutiveFailures: 1,
      successRate: 50,
    });
    expect(computeSourceHealth([run("FAILED", 1), run("SUCCEEDED", 2)], on).status).toBe(
      "DEGRADED",
    );
  });

  it(`${FAILING_AFTER} consecutive latest failures are FAILING (order by time, not input order)`, () => {
    const runs = [run("FAILED", 5), run("SUCCEEDED", 1), run("FAILED", 3), run("FAILED", 4)];
    expect(computeSourceHealth(runs, on)).toMatchObject({
      status: "FAILING",
      consecutiveFailures: 3,
      lastFailureAt: at(5),
    });
  });

  it("running/skipped runs are ignored; manual entry is not applicable", () => {
    expect(computeSourceHealth([run("RUNNING", 9), run("SUCCEEDED", 1)], on).status).toBe(
      "HEALTHY",
    );
    expect(computeSourceHealth([], { enabled: true, manual: true }).status).toBe("NOT_APPLICABLE");
  });
});
