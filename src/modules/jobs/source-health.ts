/**
 * Source health from real sync/test history (pure, unit-tested). Nothing is guessed:
 * a source without runs is UNTESTED, never "healthy".
 */

export const HEALTH_STATUSES = [
  "HEALTHY",
  "DEGRADED",
  "FAILING",
  "UNTESTED",
  "DISABLED",
  "NOT_APPLICABLE",
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

/** Consecutive failed runs (latest first) that make a source FAILING. */
export const FAILING_AFTER = 3;
/** Runs considered for the success rate. */
export const HEALTH_WINDOW = 20;

export interface HealthRun {
  status: string;
  startedAt: Date;
}

export interface SourceHealth {
  status: HealthStatus;
  consecutiveFailures: number;
  /** Finished runs in the window (SUCCEEDED + FAILED) */
  sample: number;
  succeeded: number;
  /** 0–100, null when there is no finished run */
  successRate: number | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
}

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  HEALTHY: "Healthy",
  DEGRADED: "Degraded",
  FAILING: "Failing",
  UNTESTED: "No runs yet",
  DISABLED: "Disabled",
  NOT_APPLICABLE: "Not applicable",
};

export function computeSourceHealth(
  runs: readonly HealthRun[],
  opts: { enabled: boolean; manual: boolean },
): SourceHealth {
  const finished = [...runs]
    .filter((r) => r.status === "SUCCEEDED" || r.status === "FAILED")
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, HEALTH_WINDOW);
  let consecutiveFailures = 0;
  for (const r of finished) {
    if (r.status !== "FAILED") break;
    consecutiveFailures++;
  }
  const succeeded = finished.filter((r) => r.status === "SUCCEEDED").length;
  const base = {
    consecutiveFailures,
    sample: finished.length,
    succeeded,
    successRate: finished.length ? Math.round((succeeded / finished.length) * 100) : null,
    lastSuccessAt: finished.find((r) => r.status === "SUCCEEDED")?.startedAt ?? null,
    lastFailureAt: finished.find((r) => r.status === "FAILED")?.startedAt ?? null,
  };
  const status: HealthStatus = opts.manual
    ? "NOT_APPLICABLE"
    : finished.length === 0
      ? opts.enabled
        ? "UNTESTED"
        : "DISABLED"
      : consecutiveFailures >= FAILING_AFTER
        ? "FAILING"
        : consecutiveFailures > 0 || succeeded < finished.length
          ? "DEGRADED"
          : opts.enabled
            ? "HEALTHY"
            : "DISABLED";
  return { status, ...base };
}
