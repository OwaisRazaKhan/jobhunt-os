import { ArrowLeft, ExternalLink, Pencil, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { z } from "zod";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { isPublicHttpUrl } from "@/lib/safe-url";
import { countryName } from "@/modules/candidate/labels";
import { optionLabel } from "@/modules/candidate/options";
import { formatSalary } from "@/modules/jobs/format";
import { getProfile } from "@/modules/candidate";
import { getJob } from "@/modules/jobs/jobs.service";
import { getMatchForJob, listJobRequirements } from "@/modules/matching/match.service";
import { MatchPanel } from "@/modules/matching/ui/match-panel";
import type { JobStatus, RemoteStatus, SalaryPeriod } from "@/modules/jobs/types";
import { DeleteJobButton } from "@/modules/jobs/ui/delete-job-button";
import { JobStatusBadge, RemoteBadge } from "@/modules/jobs/ui/job-badges";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Job · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const dash = (
  <span className="text-fg-subtle" title="Not provided">
    —
  </span>
);
const known = (v: string | null | undefined) => (v && v !== "UNKNOWN" ? optionLabel(v) : null);
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ") + " UTC";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-4 py-2 text-xs">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="text-fg min-w-0 break-words">{children ?? dash}</dd>
    </div>
  );
}

/** External link: rendered only for safe public http(s) URLs; never followed with referrer or SEO weight. */
function SafeLink({ href }: { href: string | null }) {
  if (!href) return dash;
  if (!isPublicHttpUrl(href)) return <span className="text-fg-muted font-mono">{href}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="text-info inline-flex max-w-full items-center gap-1 hover:underline"
    >
      <span className="truncate">{href.replace(/^https?:\/\//, "")}</span>
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

function NotFound({ invalid }: { invalid?: boolean }) {
  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>
      <Card>
        <EmptyState
          icon={<SearchX className="size-6" />}
          title="Job not found"
          description={
            invalid
              ? "This is not a valid job link."
              : "This job does not exist or is no longer available."
          }
          action={
            <Link href="/jobs" className={buttonClass("secondary", "sm")}>
              Back to jobs
            </Link>
          }
        />
      </Card>
    </div>
  );
}

export default async function JobDetailPage({ params }: PageProps<"/jobs/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return <NotFound invalid />;
  const result = await getJob(actor, id).catch((error) => {
    if (error instanceof AppError && error.code === "NOT_FOUND") return null;
    throw error;
  });
  if (!result) return <NotFound />;
  const { job, canEdit } = result;
  const [profile, requirements, match] = await Promise.all([
    getProfile(actor),
    listJobRequirements(actor, job.id),
    getMatchForJob(actor, job.id),
  ]);
  const salary = formatSalary({
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    salaryPeriod: job.salaryPeriod as SalaryPeriod | null,
    salaryRaw: job.salaryRaw,
  });
  const sourceName =
    job.source?.sourceName ?? (job.sourceKey === "MANUAL" ? "Manual Entry" : job.sourceKey);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/jobs" className={buttonClass("ghost", "sm", "self-start")}>
        <ArrowLeft className="size-3.5" aria-hidden /> All jobs
      </Link>

      <div className="border-border flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-fg-subtle font-mono text-[11px] tracking-wide uppercase">
            {job.company.name}
          </p>
          <h1 className="mt-0.5 text-lg font-semibold tracking-tight break-words">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <JobStatusBadge status={job.status as JobStatus} />
            <RemoteBadge status={job.remoteStatus as RemoteStatus} />
            <Badge>{sourceName}</Badge>
            {job.sourceStatus === "USER_ENTERED" && <Badge tone="neutral">User entered</Badge>}
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Link href={`/jobs/${job.id}/edit`} className={buttonClass("secondary", "sm")}>
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Link>
            <DeleteJobButton id={job.id} title={job.title} />
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Description" />
          {/* Plain text only: React escapes it, so pasted HTML/scripts render as text. */}
          <div className="text-fg px-4 py-3 text-sm leading-relaxed break-words whitespace-pre-wrap">
            {job.description}
          </div>
          {job.visaTextRaw && (
            <div className="border-border border-t px-4 py-3">
              <p className="text-fg-muted text-xs font-medium">
                Visa / work authorization wording (from the posting)
              </p>
              <p className="text-fg mt-1 text-sm break-words whitespace-pre-wrap">
                {job.visaTextRaw}
              </p>
              <p className="text-fg-subtle mt-1 text-[11px]">
                Stored as evidence only. No eligibility analysis is made.
              </p>
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <MatchPanel
            data={{ hasProfile: Boolean(profile), requirementCount: requirements.length, match }}
          />
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-border divide-y py-1">
              <Row label="Company">{job.company.name}</Row>
              <Row label="Location">{job.locationRaw}</Row>
              <Row label="Country">{job.countryCode ? countryName(job.countryCode) : null}</Row>
              <Row label="Employment type">{known(job.employmentType)}</Row>
              <Row label="Work mode">{known(job.remoteStatus)}</Row>
              <Row label="Relocation">{known(job.relocationAvailable)}</Row>
              <Row label="Salary">
                {salary ? <span className="font-mono">{salary}</span> : null}
              </Row>
              <Row label="Posted">
                {job.postedAt ? job.postedAt.toISOString().slice(0, 10) : null}
              </Row>
              <Row label="Job URL">
                <SafeLink href={job.jobUrl} />
              </Row>
              <Row label="Application URL">
                <SafeLink href={job.applicationUrl} />
              </Row>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Source" />
            <dl className="divide-border divide-y py-1">
              <Row label="Source">{sourceName}</Row>
              <Row label="Source type">{optionLabel(job.sourceType)}</Row>
              <Row label="Source status">{optionLabel(job.sourceStatus)}</Row>
              <Row label="Created">{stamp(job.createdAt)}</Row>
              <Row label="Last updated">{stamp(job.updatedAt)}</Row>
            </dl>
          </Card>
          {canEdit && job.notes && (
            <Card>
              <CardHeader title="Private notes" />
              <p className="text-fg px-4 py-3 text-xs break-words whitespace-pre-wrap">
                {job.notes}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
