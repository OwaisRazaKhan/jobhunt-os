import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import {
  ACCESS_LABELS,
  configuredBoards,
  SOURCE_DEFINITIONS,
  isSourceKey,
  STATUS_LABELS,
  TERMS_LABELS,
  TYPE_LABELS,
  type SourceStatus,
  type TermsStatus,
} from "@/modules/jobs/sources.schemas";
import { jobCountsBySource } from "@/modules/jobs/jobs.service";
import { listSources } from "@/modules/jobs/sources.service";
import { listSourceHealth } from "@/modules/jobs/discovery/run.service";
import { HealthBadge } from "@/modules/jobs/ui/health-badge";
import {
  ConfigureSourceButton,
  SourceEnabledToggle,
  SourceHistoryLink,
  TestSourceButton,
} from "@/modules/jobs/ui/source-controls";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Job sources · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<SourceStatus, Tone> = {
  PENDING_VERIFICATION: "warning",
  READY: "success",
  MANUAL_ONLY: "info",
  ERROR: "danger",
};
const TERMS_TONE: Record<TermsStatus, Tone> = {
  NOT_REVIEWED: "warning",
  VERIFIED: "success",
  RESTRICTED: "danger",
  NOT_APPLICABLE: "neutral",
};

const dash = <span className="text-fg-subtle">—</span>;
const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : dash);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-fg-subtle font-mono text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-fg mt-0.5 text-xs">{children}</dd>
    </div>
  );
}

export default async function SourcesPage() {
  const actor = await requireActorOrRedirect();
  const sources = await listSources(actor);
  const [counts, health] = await Promise.all([
    jobCountsBySource(
      actor,
      sources.map((s) => s.id),
    ),
    listSourceHealth(actor, sources),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <PageHeader
        eyebrow="Discovery"
        title="Job sources"
        description="Where JOBHUNT OS may look for jobs. Statuses are internal product states, not legal approvals."
      />
      <Alert tone="info" title="How source status works">
        For Ashby, Lever and Greenhouse we reviewed each provider&apos;s official public
        documentation (linked below). A source stays <strong>Pending verification</strong> until a
        live test or sync of the boards you configured succeeds. Health is computed from the
        recorded test and sync history only. &ldquo;Public access documented&rdquo; is not a legal
        agreement with the provider.
      </Alert>

      <ul className="flex flex-col gap-3">
        {sources.map((source) => {
          const key = isSourceKey(source.sourceKey) ? source.sourceKey : null;
          if (!key) return null;
          const boards = configuredBoards(key, source.configuration);
          const verification = SOURCE_DEFINITIONS[key].verification;
          const status = source.status as SourceStatus;
          const terms = source.termsStatus as TermsStatus;
          const h = health.get(source.id);
          return (
            <li key={source.id}>
              <Card>
                <CardHeader
                  title={source.sourceName}
                  description={TYPE_LABELS[source.sourceType] ?? source.sourceType}
                  actions={
                    <Badge tone={STATUS_TONE[status]}>
                      {STATUS_LABELS[status] ?? source.status}
                    </Badge>
                  }
                />
                <div className="flex flex-col gap-4 px-4 py-3 lg:flex-row lg:items-start">
                  <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-5">
                    <Field label="Access method">
                      {ACCESS_LABELS[source.accessMethod] ?? source.accessMethod}
                    </Field>
                    <Field label="Terms status">
                      <Badge tone={TERMS_TONE[terms]}>
                        {TERMS_LABELS[terms] ?? source.termsStatus}
                      </Badge>
                      {verification && (
                        <span className="text-fg-subtle mt-1 block text-[11px]">
                          Reviewed {verification.reviewedOn} ·{" "}
                          <a
                            href={verification.docsUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-info hover:underline"
                          >
                            docs
                          </a>
                        </span>
                      )}
                    </Field>
                    <Field label="Configuration">
                      {key === "MANUAL" ? (
                        "No external configuration"
                      ) : boards.length ? (
                        <span
                          className="font-mono"
                          title={boards
                            .map((b) => (b.name ? `${b.id} (${b.name})` : b.id))
                            .join(", ")}
                        >
                          {boards
                            .slice(0, 3)
                            .map((b) => b.id)
                            .join(", ")}
                          {boards.length > 3 ? ` +${boards.length - 3}` : ""}
                        </span>
                      ) : (
                        <span className="text-fg-subtle">Not configured</span>
                      )}
                    </Field>
                    <Field label="Last sync">{when(source.lastSyncAt)}</Field>
                    <Field label="Last success">{when(source.lastSuccessAt)}</Field>
                    <Field label={key === "MANUAL" ? "Jobs added" : "Jobs discovered"}>
                      <span className="font-mono">{counts.get(source.id) ?? 0}</span>
                    </Field>
                    <Field label="Last test">{when(source.lastTestedAt)}</Field>
                    {h && key !== "MANUAL" && (
                      <Field label="Health (last 20 runs)">
                        <HealthBadge health={h} />
                      </Field>
                    )}
                    <Field label="Last error">
                      {source.lastError ? (
                        <span className="text-danger">{source.lastError}</span>
                      ) : (
                        dash
                      )}
                    </Field>
                  </dl>
                  <div className="border-border flex flex-wrap items-center gap-2 border-t pt-3 lg:w-auto lg:flex-col lg:items-end lg:border-t-0 lg:pt-0">
                    <SourceEnabledToggle
                      id={source.id}
                      name={source.sourceName}
                      enabled={source.enabled}
                    />
                    <div className="flex flex-wrap gap-1.5 lg:justify-end">
                      <ConfigureSourceButton
                        id={source.id}
                        sourceKey={key}
                        configuration={source.configuration as Record<string, unknown>}
                        rateLimitSettings={source.rateLimitSettings as Record<string, unknown>}
                        notes={source.notes}
                      />
                      {key !== "MANUAL" && (
                        <>
                          <TestSourceButton
                            id={source.id}
                            name={source.sourceName}
                            configured={boards.length > 0}
                          />
                          <SourceHistoryLink id={source.id} name={source.sourceName} />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
