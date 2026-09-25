"use client";

import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DiscoveryRunView } from "../discovery/run-view";
import { RunProgress, SyncRunsTable } from "./run-progress";

const POLL_MS = 1500;

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Something went wrong. Try again.";
}

/**
 * Starts a run (POST /api/v1/discovery/runs) and polls its real progress
 * (GET /api/v1/discovery/runs/:id) until it reaches a terminal status.
 */
export function DiscoveryRunner({
  profileId,
  disabledReason,
  initialRun,
}: {
  profileId: string;
  /** Why the run button is disabled (profile disabled, no boards, another run active) */
  disabledReason: string | null;
  initialRun: DiscoveryRunView | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState<DiscoveryRunView | null>(initialRun);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [pollId, setPollId] = useState<string | null>(
    initialRun && !initialRun.terminal ? initialRun.id : null,
  );

  useEffect(() => {
    if (!pollId) return;
    let cancelled = false;
    void (async () => {
      let failures = 0;
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (cancelled) return;
        const res = await fetch(`/api/v1/discovery/runs/${pollId}`, { cache: "no-store" }).catch(
          () => null,
        );
        if (cancelled) return;
        if (!res?.ok) {
          if (++failures >= 5) {
            setError(res ? await readError(res) : "Lost connection while checking progress.");
            setPollId(null);
            return;
          }
          continue;
        }
        failures = 0;
        const { data } = (await res.json()) as { data: DiscoveryRunView };
        if (cancelled) return;
        setRun(data);
        if (data.terminal) {
          setPollId(null);
          router.refresh();
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollId, router]);

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const res = await fetch("/api/v1/discovery/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profileId }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const { data } = (await res.json()) as { data: DiscoveryRunView };
      setRun(data);
      setPollId(data.id);
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const active = run !== null && !run.terminal;
  const blocked = disabledReason && !active ? disabledReason : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={start}
          disabled={starting || active || Boolean(blocked)}
          aria-describedby={blocked ? "run-blocked" : undefined}
        >
          <Play className="size-3.5" aria-hidden />
          {starting ? "Starting…" : active ? "Running…" : "Run discovery"}
        </Button>
        {blocked && (
          <p id="run-blocked" className="text-fg-muted text-xs">
            {blocked}
          </p>
        )}
      </div>
      {error && (
        <p
          role="alert"
          className="border-danger/30 bg-danger/5 text-danger rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      {run && (
        <div className="flex flex-col gap-3" aria-live="polite">
          <RunProgress run={run} />
          <SyncRunsTable rows={run.syncRuns} />
        </div>
      )}
    </div>
  );
}
