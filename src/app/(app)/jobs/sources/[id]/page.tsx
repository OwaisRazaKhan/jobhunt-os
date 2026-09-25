import { ArrowLeft, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { getSourceHistory } from "@/modules/jobs/discovery/run.service";
import { toSyncRunView } from "@/modules/jobs/discovery/run-view";
import { configuredBoards, isSourceKey } from "@/modules/jobs/sources.schemas";
import { HealthBadge } from "@/modules/jobs/ui/health-badge";
import { SyncRunsTable } from "@/modules/jobs/ui/run-progress";
import { TestSourceButton } from "@/modules/jobs/ui/source-controls";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Source history · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const when = (d: Date | null) =>
  d ? `${d.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";

function Stat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle font-mono text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-fg mt-0.5 text-xs">{children}</dd>
    </div>
  );
}

export default async function SourceHistoryPage({ params }: PageProps<"/jobs/sources/[id]">) {
  const actor = await requireActorOrRedirect();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const { source, runs, health } = await getSourceHistory(actor, id.data).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  const key = isSourceKey(source.sourceKey) ? source.sourceKey : null;
  const boards = key ? configuredBoards(key, source.configuration) : [];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs/sources" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> Sources
      </Link>
      <PageHeader
        eyebrow="Source history"
        title={source.sourceName}
        description="Every live test and discovery sync of this source's boards, newest first. Only counts and error summaries are stored — never raw responses."
        actions={
          key && key !== "MANUAL" ? (
            <TestSourceButton
              id={source.id}
              name={source.sourceName}
              configured={boards.length > 0}
            />
          ) : null
        }
      />
      <Card>
        <CardHeader title="Health" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Status (last 20 runs)">
            <HealthBadge health={health} />
          </Stat>
          <Stat label="Success rate">
            {health.successRate == null ? "—" : `${health.successRate}%`}
          </Stat>
          <Stat label="Last success">{when(health.lastSuccessAt)}</Stat>
          <Stat label="Last failure">{when(health.lastFailureAt)}</Stat>
          <Stat label="Enabled">{source.enabled ? "Yes" : "No"}</Stat>
          <Stat label="Boards">
            <span className="font-mono">{boards.map((b) => b.id).join(", ") || "—"}</span>
          </Stat>
        </dl>
        {source.lastError && (
          <p className="text-danger border-border border-t px-4 py-2 text-xs">
            Last error: {source.lastError}
          </p>
        )}
      </Card>
      <Card>
        <CardHeader title="Runs" count={runs.length} />
        {runs.length === 0 ? (
          <EmptyState
            icon={<History className="size-6" />}
            title="No runs yet"
            description="Test the source or run discovery with a search profile that uses it."
          />
        ) : (
          <SyncRunsTable rows={runs.map(toSyncRunView)} history />
        )}
      </Card>
    </div>
  );
}
