import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import type { CheckSummaryView } from "@/modules/resumes/check.service";
import {
  blockingClaims,
  getResumeWorkspace,
  STATUS_LABELS,
  type VersionStatus,
} from "@/modules/resumes/resume.service";
import type { ChangeSet } from "@/modules/resumes/tailor";
import { PAGE_SIZES, TEMPLATES } from "@/modules/resumes/templates";
import { ago, STATUS_TONES } from "@/modules/resumes/ui/labels";
import { ChangeSetPanel, CheckResults, VersionList } from "@/modules/resumes/ui/panels";
import { ResumeSettingsForm } from "@/modules/resumes/ui/resume-controls";
import { ResumeEditor } from "@/modules/resumes/ui/resume-editor";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";
import {
  addNewFactsAction,
  approveVersionAction,
  archiveResumeAction,
  duplicateResumeAction,
  exportResumeAction,
  restoreVersionAction,
  revokeApprovalAction,
  runCheckAction,
  saveAsNewVersionAction,
  setVersionStatusAction,
} from "../actions";

export const metadata: Metadata = { title: "Resume · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ResumePage({ params, searchParams }: PageProps<"/resumes/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const v = (await searchParams).v;
  if (!isUuid(id) || (typeof v === "string" && !isUuid(v))) notFound();
  let ws;
  try {
    ws = await getResumeWorkspace(actor, id, typeof v === "string" ? v : null);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { resume, version, doc } = ws;
  if (!version || !doc) notFound();

  const status = version.status as VersionStatus;
  const archived = resume.status === "ARCHIVED";
  const readOnly = archived || !ws.isHead;
  const blocking = blockingClaims(doc);
  const activeApproval = ws.approvals.find((a) => !a.revokedAt) ?? null;
  const check = ws.latestCheck;
  const checkSummary = check ? (check.summary as unknown as CheckSummaryView) : null;
  const parent = version.parentVersionId;
  const changeSet = version.changeSet as unknown as ChangeSet | null;
  const job = resume.targetJob && !resume.targetJob.deletedAt ? resume.targetJob : null;
  const templates = Object.values(TEMPLATES).map((t) => ({
    key: t.key,
    label: t.label,
    description: t.description,
  }));
  const formats = Object.entries(PAGE_SIZES).map(([key, s]) => ({ key, label: s.label }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          resume.kind === "MASTER"
            ? "Master resume"
            : resume.kind === "TAILORED"
              ? "Tailored resume"
              : "Resume"
        }
        title={resume.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>v{version.versionNumber}</span>
            <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
            {version.aiAssisted && <Badge tone="ai">AI-assisted — review before use</Badge>}
            {archived && <Badge>Archived</Badge>}
            <span>
              · updated {ago(version.updatedAt)} ·{" "}
              {TEMPLATES[resume.template as keyof typeof TEMPLATES]?.label ?? resume.template} ·{" "}
              {resume.pageFormat}
            </span>
            {job && (
              <span>
                · for{" "}
                <Link href={`/jobs/${job.id}`} className="underline">
                  {job.title}
                  {job.company?.name ? ` — ${job.company.name}` : ""}
                </Link>
              </span>
            )}
            {resume.sourceResume && (
              <span>
                · from{" "}
                <Link href={`/resumes/${resume.sourceResume.id}`} className="underline">
                  {resume.sourceResume.name}
                </Link>
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Link
              href={job ? `/resumes/tailor?job=${job.id}&resume=${resume.id}` : `/jobs`}
              className={buttonClass("primary", "sm")}
              title={job ? undefined : "Open a job and choose “Tailor resume”"}
            >
              Tailor to job
            </Link>
            <a
              href={`/api/v1/resumes/versions/${version.id}/preview`}
              target="_blank"
              rel="noopener"
              className={buttonClass("secondary", "sm")}
            >
              Preview PDF
            </a>
            {parent && (
              <Link
                href={`/resumes/${resume.id}/compare?from=${parent}&to=${version.id}`}
                className={buttonClass("secondary", "sm")}
              >
                Compare
              </Link>
            )}
            <InlineAction
              action={duplicateResumeAction}
              hidden={{ resumeId: resume.id }}
              variant="secondary"
            >
              Duplicate
            </InlineAction>
            <InlineAction
              action={archiveResumeAction}
              hidden={{ resumeId: resume.id, archived: archived ? "false" : "true" }}
              variant="ghost"
              confirm={archived ? undefined : "Archive this resume? Its versions stay in history."}
            >
              {archived ? "Restore" : "Archive"}
            </InlineAction>
          </>
        }
      />

      {!ws.isHead && (
        <Alert tone="info" title={`Viewing v${version.versionNumber} (read-only)`}>
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/resumes/${resume.id}`} className="underline">
              Back to latest
            </Link>
            {!archived && (
              <InlineAction
                action={restoreVersionAction}
                hidden={{ versionId: version.id }}
                variant="secondary"
              >
                Restore as new version
              </InlineAction>
            )}
          </span>
        </Alert>
      )}
      {ws.isHead && status === "APPROVED" && !archived && (
        <Alert tone="success" title="This version is approved">
          Approved content is locked. Editing creates a new draft version — this approved v
          {version.versionNumber} and its approval stay unchanged.
        </Alert>
      )}
      {blocking.length > 0 && (
        <Alert
          tone="danger"
          title={`${blocking.length} unsupported statement${blocking.length === 1 ? "" : "s"}`}
        >
          These cannot be approved or exported until you remove them or rewrite them using only your
          verified facts.
        </Alert>
      )}
      {ws.unrepresented > 0 && ws.isHead && !archived && (
        <Alert
          tone="info"
          title={`${ws.unrepresented} candidate fact${ws.unrepresented === 1 ? " is" : "s are"} not in this resume`}
        >
          <span className="flex flex-wrap items-center gap-2">
            New or hidden-from-build facts from your profile.
            <InlineAction
              action={addNewFactsAction}
              hidden={{ resumeId: resume.id }}
              variant="secondary"
            >
              Add new facts
            </InlineAction>
          </span>
        </Alert>
      )}

      <ResumeEditor
        key={`${version.id}:${version.contentHash}`}
        resumeId={resume.id}
        initialDoc={doc}
        initialHash={version.contentHash}
        readOnly={readOnly}
        readOnlyReason={
          archived
            ? "Archived resumes are read-only. Restore it to edit."
            : !ws.isHead
              ? "Older versions are read-only. Restore it to continue from it."
              : undefined
        }
        template={resume.template}
        pageFormat={resume.pageFormat}
        facts={ws.facts}
        versionLabel={`Editing v${version.versionNumber}${status !== "DRAFT" ? " (edits create a new version)" : ""}`}
      />
      <p className="text-fg-muted text-xs">
        Information missing?{" "}
        <Link href="/candidate" className="underline">
          Add it to your candidate profile
        </Link>{" "}
        (experience, projects, achievements, skills) so it becomes a reusable, verifiable fact —
        then use “Add new facts”.
      </p>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {changeSet && (
          <ChangeSetPanel
            changeSet={changeSet}
            compareHref={
              parent ? `/resumes/${resume.id}/compare?from=${parent}&to=${version.id}` : null
            }
          />
        )}

        <Card>
          <CardHeader
            title="Resume Check"
            description="Structure, content, readability, formatting, fact grounding and job alignment."
            actions={
              <InlineAction
                action={runCheckAction}
                hidden={{
                  versionId: version.id,
                  ...(job ? { jobId: job.id } : {}),
                  force: check ? "true" : "false",
                }}
                variant="secondary"
              >
                {check ? "Run again" : "Run Resume Check"}
              </InlineAction>
            }
          />
          <div className="px-4 py-3">
            {check && checkSummary ? (
              <CheckResults
                summary={checkSummary}
                findings={check.findings}
                stale={check.contentHash !== version.contentHash}
                createdAt={check.createdAt}
                jobTitle={job?.title ?? null}
              />
            ) : (
              <p className="text-fg-muted text-xs">Not checked yet.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Review & approval"
            description="Approval covers this exact content (SHA-256 hash). Any edit needs a new approval."
          />
          <div className="flex flex-col gap-3 px-4 py-3 text-xs">
            <p className="text-fg-muted">
              Content hash{" "}
              <code className="text-fg font-mono">{version.contentHash.slice(0, 12)}…</code>
              {activeApproval && <> · approved {ago(activeApproval.approvedAt)}</>}
            </p>
            {!readOnly && (
              <div className="flex flex-wrap gap-1.5">
                {status === "DRAFT" && (
                  <InlineAction
                    action={setVersionStatusAction}
                    hidden={{ versionId: version.id, status: "READY_FOR_REVIEW" }}
                    variant="secondary"
                  >
                    Mark ready for review
                  </InlineAction>
                )}
                {(status === "DRAFT" || status === "READY_FOR_REVIEW") && (
                  <InlineAction
                    action={approveVersionAction}
                    hidden={{ versionId: version.id, contentHash: version.contentHash }}
                    variant="primary"
                  >
                    Approve this version
                  </InlineAction>
                )}
                {(status === "DRAFT" || status === "READY_FOR_REVIEW") && (
                  <InlineAction
                    action={setVersionStatusAction}
                    hidden={{ versionId: version.id, status: "REJECTED" }}
                    variant="danger"
                  >
                    Reject
                  </InlineAction>
                )}
                {(status === "READY_FOR_REVIEW" || status === "REJECTED") && (
                  <InlineAction
                    action={setVersionStatusAction}
                    hidden={{ versionId: version.id, status: "DRAFT" }}
                    variant="ghost"
                  >
                    Back to draft
                  </InlineAction>
                )}
                {status === "APPROVED" && activeApproval && (
                  <InlineAction
                    action={revokeApprovalAction}
                    hidden={{ versionId: version.id, reason: "Withdrawn by the candidate" }}
                    variant="ghost"
                    confirm="Withdraw the approval of this version?"
                  >
                    Withdraw approval
                  </InlineAction>
                )}
                <InlineAction
                  action={saveAsNewVersionAction}
                  hidden={{ resumeId: resume.id }}
                  variant="ghost"
                >
                  Save as new version
                </InlineAction>
              </div>
            )}
            {ws.approvals.length > 0 && (
              <ul className="text-fg-muted flex flex-col gap-0.5">
                {ws.approvals.map((a) => (
                  <li key={a.id}>
                    Approved {a.approvedAt.toISOString().slice(0, 16).replace("T", " ")} UTC · hash{" "}
                    {a.contentHash.slice(0, 12)}…
                    {a.revokedAt ? ` · withdrawn (${a.revokeReason})` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-fg-subtle">
              Nothing is sent anywhere. Approving only records that you reviewed this exact version.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Export"
            description="Real PDF and DOCX files, stored privately. Downloads use short-lived links."
          />
          <div className="flex flex-col gap-3 px-4 py-3 text-xs">
            <div className="flex flex-wrap gap-1.5">
              <InlineAction
                action={exportResumeAction}
                hidden={{ versionId: version.id, format: "PDF" }}
                variant="secondary"
              >
                Export PDF
              </InlineAction>
              <InlineAction
                action={exportResumeAction}
                hidden={{ versionId: version.id, format: "DOCX" }}
                variant="secondary"
              >
                Export DOCX
              </InlineAction>
            </div>
            {!activeApproval && (
              <p className="text-fg-muted">
                This version is not approved; exports are marked as unapproved drafts.
              </p>
            )}
            {ws.exports.length === 0 ? (
              <p className="text-fg-muted">No exports yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {ws.exports.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={
                        e.status === "SUCCEEDED"
                          ? "success"
                          : e.status === "FAILED"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {e.format}
                    </Badge>
                    {e.status === "SUCCEEDED" ? (
                      <a
                        href={`/api/v1/resumes/exports/${e.id}/download`}
                        className="text-accent hover:underline"
                      >
                        {e.fileName}
                      </a>
                    ) : (
                      <span className="text-danger">
                        {e.status === "FAILED" ? `Failed: ${e.error}` : "Pending"}
                      </span>
                    )}
                    <span className="text-fg-muted">
                      {e.byteSize ? `${Math.round(e.byteSize / 1024)} KB · ` : ""}
                      {e.template.toLowerCase()} · {e.pageFormat} · {ago(e.createdAt)}
                    </span>
                    {e.status === "SUCCEEDED" &&
                      (activeApproval && e.contentHash === activeApproval.contentHash ? (
                        <Badge tone="success">approved content</Badge>
                      ) : activeApproval && e.contentHash !== activeApproval.contentHash ? (
                        <Badge tone="danger">differs from approved content</Badge>
                      ) : (
                        <Badge>unapproved draft</Badge>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Versions" count={resume.versions.length} />
          <VersionList
            resumeId={resume.id}
            versions={resume.versions}
            currentId={resume.currentVersionId}
            selectedId={version.id}
          />
        </Card>

        <Card>
          <CardHeader
            title="Settings"
            description="Template and page format change presentation only, not content."
          />
          <div className="px-4 py-3">
            <ResumeSettingsForm
              resumeId={resume.id}
              name={resume.name}
              template={resume.template}
              pageFormat={resume.pageFormat}
              templates={templates}
              formats={formats}
              disabled={archived}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
