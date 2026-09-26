import { FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { getProfile } from "@/modules/candidate/profile.service";
import {
  listRecentVersions,
  listResumes,
  STATUS_LABELS,
  type VersionStatus,
} from "@/modules/resumes/resume.service";
import { ago, STATUS_TONES } from "@/modules/resumes/ui/labels";
import { CreateResumeForm } from "@/modules/resumes/ui/resume-controls";
import { requireActorOrRedirect } from "@/server/session";
import { createMasterResumeAction } from "./actions";

export const metadata: Metadata = { title: "Resume Studio · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "master", label: "Master" },
  { key: "tailored", label: "Tailored" },
  { key: "approved", label: "Approved" },
  { key: "draft", label: "Draft" },
  { key: "archived", label: "Archived" },
] as const;

export default async function ResumesPage({ searchParams }: PageProps<"/resumes">) {
  const actor = await requireActorOrRedirect();
  const raw = (await searchParams).filter;
  const filter = FILTERS.find((f) => f.key === raw)?.key ?? "all";
  const [all, recent, profile] = await Promise.all([
    listResumes(actor, { includeArchived: true }),
    listRecentVersions(actor),
    getProfile(actor),
  ]);
  const active = all.filter((r) => r.status === "ACTIVE");
  const master = active.find((r) => r.kind === "MASTER") ?? null;
  const shown = all.filter((r) => {
    switch (filter) {
      case "master":
        return r.kind === "MASTER";
      case "tailored":
        return r.kind === "TAILORED" && r.status === "ACTIVE";
      case "approved":
        return r.currentVersion?.status === "APPROVED";
      case "draft":
        return r.currentVersion?.status === "DRAFT" && r.status === "ACTIVE";
      case "archived":
        return r.status === "ARCHIVED";
      default:
        return r.status === "ACTIVE";
    }
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Documents"
        title="Resume Studio"
        description="Resumes built from your verified candidate facts. Tailoring reorders and rewords only what your facts support — it never adds experience, skills or numbers. Every version is kept."
        actions={
          <Link href="/jobs" className={buttonClass("secondary", "sm")}>
            Pick a job to tailor for
          </Link>
        }
      />

      {!profile && (
        <Alert tone="info" title="Build your candidate profile first">
          Resume Studio uses your candidate facts as the only source of truth.{" "}
          <Link href="/welcome" className="underline">
            Start your profile
          </Link>{" "}
          or import a CV — extracted facts become usable once you review them.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader
              title="Master resume"
              description="Your complete, job-independent resume. Tailoring never changes it."
            />
            {master ? (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 text-sm">
                  <Link
                    href={`/resumes/${master.id}`}
                    className="text-fg font-medium hover:underline"
                  >
                    {master.name}
                  </Link>
                  <p className="text-fg-muted text-xs">
                    v{master.currentVersion?.versionNumber} · {master._count.versions} version
                    {master._count.versions === 1 ? "" : "s"} · updated {ago(master.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {master.currentVersion && (
                    <Badge tone={STATUS_TONES[master.currentVersion.status as VersionStatus]}>
                      {STATUS_LABELS[master.currentVersion.status as VersionStatus]}
                    </Badge>
                  )}
                  <Link href={`/resumes/${master.id}`} className={buttonClass("secondary", "sm")}>
                    Edit
                  </Link>
                  {master.currentVersion && (
                    <a
                      href={`/api/v1/resumes/versions/${master.currentVersion.id}/preview`}
                      target="_blank"
                      rel="noopener"
                      className={buttonClass("ghost", "sm")}
                    >
                      Preview PDF
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<FileText className="size-5" aria-hidden />}
                title="No master resume yet"
                description={
                  profile
                    ? "Build it from your verified and self-provided candidate facts. Facts still waiting for review are not used."
                    : "Create your candidate profile first."
                }
                action={
                  profile ? (
                    <InlineAction action={createMasterResumeAction} hidden={{}} variant="primary">
                      Build master resume from my facts
                    </InlineAction>
                  ) : undefined
                }
              />
            )}
          </Card>

          <Card>
            <nav
              aria-label="Filter resumes"
              className="border-border flex flex-wrap gap-1 border-b px-3 py-2"
            >
              {FILTERS.map((f) => (
                <Link
                  key={f.key}
                  href={f.key === "all" ? "/resumes" : `/resumes?filter=${f.key}`}
                  aria-current={filter === f.key ? "page" : undefined}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    filter === f.key
                      ? "bg-surface-3 text-fg font-medium"
                      : "text-fg-muted hover:text-fg",
                  )}
                >
                  {f.label}
                </Link>
              ))}
            </nav>
            {shown.length === 0 ? (
              <EmptyState
                title="Nothing here yet"
                description={
                  filter === "tailored"
                    ? "Open a job and choose “Tailor resume”."
                    : "No resumes match this filter."
                }
              />
            ) : (
              <ul className="divide-border divide-y">
                {shown.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/resumes/${r.id}`}
                        className="text-fg text-sm font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="text-fg-muted text-xs">
                        {r.kind === "MASTER"
                          ? "Master"
                          : r.kind === "TAILORED"
                            ? "Tailored"
                            : "General"}
                        {r.targetJob && (
                          <>
                            {" · for "}
                            <Link href={`/jobs/${r.targetJob.id}`} className="hover:underline">
                              {r.targetJob.title}
                              {r.targetJob.company?.name ? ` — ${r.targetJob.company.name}` : ""}
                            </Link>
                          </>
                        )}
                        {" · "}v{r.currentVersion?.versionNumber ?? "—"} ·{" "}
                        {r.template.toLowerCase()} · updated {ago(r.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {r.currentVersion?.aiAssisted && <Badge tone="ai">AI-assisted</Badge>}
                      {r.status === "ARCHIVED" && <Badge>Archived</Badge>}
                      {r.currentVersion && (
                        <Badge tone={STATUS_TONES[r.currentVersion.status as VersionStatus]}>
                          {STATUS_LABELS[r.currentVersion.status as VersionStatus]}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader
              title="New resume"
              description="A role-specific resume you maintain yourself."
            />
            <div className="px-4 py-3">
              {profile ? (
                <CreateResumeForm resumes={active.map((r) => ({ id: r.id, name: r.name }))} />
              ) : (
                <p className="text-fg-muted text-xs">Create your candidate profile first.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent versions" count={recent.length} />
            {recent.length === 0 ? (
              <p className="text-fg-muted px-4 py-3 text-xs">No versions yet.</p>
            ) : (
              <ul className="divide-border divide-y">
                {recent.map((v) => (
                  <li key={v.id} className="px-4 py-2 text-xs">
                    <Link
                      href={`/resumes/${v.resume.id}?v=${v.id}`}
                      className="text-fg hover:underline"
                    >
                      {v.resume.name} · v{v.versionNumber}
                    </Link>
                    <p className="text-fg-muted">
                      {STATUS_LABELS[v.status as VersionStatus]} · {v.title} · {ago(v.updatedAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Import an existing resume" />
            <p className="text-fg-muted px-4 py-3 text-xs">
              Upload a PDF, DOCX or TXT in{" "}
              <Link href="/candidate/documents" className="underline">
                Documents
              </Link>
              . Extracted details stay in review until you confirm them; confirmed facts can then be
              added to any resume with “Add new facts”.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
