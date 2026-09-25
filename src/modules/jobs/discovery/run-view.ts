import type { DiscoveryRun, SourceSyncRun } from "@/generated/prisma/client";

/**
 * Client-safe progress view of a discovery run (what the polling endpoint returns).
 * Only counters, stages and safe error text — never raw source payloads.
 */
export const RUN_COUNTERS = [
  "fetched",
  "valid",
  "invalid",
  "created",
  "updated",
  "unchanged",
  "duplicates",
  "flagged",
  "closed",
  "matched",
] as const;
export type RunCounter = (typeof RUN_COUNTERS)[number];

export const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"] as const;

export interface SyncRunView {
  id: string;
  sourceKey: string;
  board: string;
  kind: string;
  status: string;
  requests: number;
  fetched: number;
  valid: number;
  invalid: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: number;
  flagged: number;
  closed: number;
  truncated: boolean;
  errorKind: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DiscoveryRunView {
  id: string;
  profileId: string | null;
  profileName: string | null;
  trigger: string;
  status: string;
  stage: string;
  terminal: boolean;
  sourcesTotal: number;
  sourcesDone: number;
  counts: Record<RunCounter, number>;
  errorCount: number;
  message: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  syncRuns: SyncRunView[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toSyncRunView(s: SourceSyncRun): SyncRunView {
  return {
    id: s.id,
    sourceKey: s.sourceKey,
    board: s.board,
    kind: s.kind,
    status: s.status,
    requests: s.requests,
    fetched: s.fetched,
    valid: s.valid,
    invalid: s.invalid,
    created: s.created,
    updated: s.updated,
    unchanged: s.unchanged,
    duplicates: s.duplicates,
    flagged: s.flagged,
    closed: s.closed,
    truncated: s.truncated,
    errorKind: s.errorKind,
    errorMessage: s.errorMessage,
    durationMs: s.durationMs,
    startedAt: s.startedAt.toISOString(),
    finishedAt: iso(s.finishedAt),
  };
}

export function toDiscoveryRunView(
  run: DiscoveryRun & {
    profile?: { id: string; name: string } | null;
    syncRuns?: SourceSyncRun[];
  },
): DiscoveryRunView {
  const snapshot = (run.criteria ?? {}) as { profileName?: unknown };
  return {
    id: run.id,
    profileId: run.profileId,
    profileName:
      run.profile?.name ?? (typeof snapshot.profileName === "string" ? snapshot.profileName : null),
    trigger: run.trigger,
    status: run.status,
    stage: run.stage,
    terminal: (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status),
    sourcesTotal: run.sourcesTotal,
    sourcesDone: run.sourcesDone,
    counts: Object.fromEntries(RUN_COUNTERS.map((k) => [k, run[k]])) as Record<RunCounter, number>,
    errorCount: run.errorCount,
    message: run.message,
    createdAt: run.createdAt.toISOString(),
    startedAt: iso(run.startedAt),
    finishedAt: iso(run.finishedAt),
    syncRuns: (run.syncRuns ?? []).map(toSyncRunView),
  };
}
