import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  confirmManualAction,
  discoverChannelsAction,
  inspectFormAction,
  prepareEmailAction,
  refreshReadinessAction,
  resolveUncertainAction,
  revokeApprovalAction,
  setModeAction,
  startFillAction,
  transitionAction,
} from "@/app/(app)/applications/actions";
import { inputClass } from "@/components/forms/field-control";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { getServerEnv } from "@/config/env";
import { isUuid } from "@/lib/ids";
import { selectAdapter } from "@/modules/applications/adapters";
import { getApplicationWorkspace } from "@/modules/applications/application.service";
import {
  buildEmailPayload,
  buildManualChecklist,
  getExecutionState,
} from "@/modules/applications/execution.service";
import { getReview } from "@/modules/applications/review.service";
import { MANUAL_CONFIRM_FROM, SUBMISSION_SENSITIVE } from "@/modules/applications/state-machine";
import {
  AUTOMATION_MODES,
  STATUS_LABELS,
  type ApplicationStatus,
  type AutomationMode,
} from "@/modules/applications/types";
import { ActionBox, CopyButton, ExecutionPanel } from "@/modules/applications/ui/controls";
import {
  APPLICATION_STATUS_TONES,
  human,
  ITEM_MARK,
  ITEM_TONE,
  MODE_LABELS,
} from "@/modules/applications/ui/labels";
import { ago } from "@/modules/communications/ui/labels";
import { Section } from "@/modules/communications/ui/panels";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Application · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ApplicationPage({ params }: PageProps<"/applications/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let app;
  try {
    app = await getApplicationWorkspace(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const [review, execution] = await Promise.all([
    getReview(actor, id),
    getExecutionState(actor, id),
  ]);
  const checklist = await buildManualChecklist(actor, id, review);
  const status = app.status as ApplicationStatus;
  const channel = app.channel;
  const adapter = channel
    ? selectAdapter(channel, getServerEnv().APPLICATION_FIXTURE_ORIGIN)
    : null;
  const emailPayload =
    channel?.channelType === "EMAIL_APPLICATION" && status === "READY_TO_SUBMIT"
      ? await buildEmailPayload(actor, id).catch(() => null)
      : null;
  const sensitive = SUBMISSION_SENSITIVE.includes(status);
  const snap = app.snapshot as Record<
    string,
    { versionId?: string; contentHash?: string } | string | null
  >;
  const hidden = { applicationId: app.id };
  const fails = review.evaluation.items.filter((i) => i.status === "FAIL");
  const activeAttempt =
    execution.attempt &&
    ["QUEUED", "RUNNING", "PAUSED", "NEEDS_HUMAN_INPUT"].includes(execution.attempt.status);
  const readyToSend = app.submissions.find((s) => s.status === "READY_TO_SEND");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Application"
        title={`${app.job.title}${app.company ? ` — ${app.company.name}` : ""}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={APPLICATION_STATUS_TONES[status] ?? "neutral"}>
              {STATUS_LABELS[status]}
            </Badge>
            <span>{MODE_LABELS[app.automationMode as AutomationMode]?.label}</span>
            <span className="text-fg-subtle">· updated {ago(app.updatedAt)}</span>
          </span>
        }
        actions={
          <>
            <Link href={`/applications/${app.id}/review`} className={buttonClass("primary", "sm")}>
              Review
            </Link>
            <Link
              href={`/applications/${app.id}/questions`}
              className={buttonClass("secondary", "sm")}
            >
              Questions ({app.questions.length})
            </Link>
            <Link href="/applications" className={buttonClass("ghost", "sm")}>
              All applications
            </Link>
          </>
        }
      />

      {status === "SUBMITTED" || status === "SUBMISSION_CONFIRMED" ? (
        <Alert
          tone="success"
          title={
            app.confirmationSource === "USER_CONFIRMED"
              ? "Submitted — confirmed by you"
              : "Submitted — confirmation captured"
          }
        >
          {app.submittedAt ? `Recorded ${ago(app.submittedAt)}. ` : ""}
          {app.externalApplicationId ? `Reference: ${app.externalApplicationId}. ` : ""}
          {app.confirmationSource === "USER_CONFIRMED"
            ? "This was not verified automatically."
            : `Evidence: ${human(app.confirmationSource)}.`}
        </Alert>
      ) : status === "SUBMISSION_UNCERTAIN" ? (
        <Alert
          tone="warning"
          title="Submission uncertain — it will not be resubmitted automatically"
        >
          The result could not be confirmed. Check the company&apos;s portal or your inbox, then
          record what happened.
          <ActionBox
            action={resolveUncertainAction}
            hidden={hidden}
            submitLabel="Record outcome"
            className="mt-2"
          >
            <div className="flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="submitted" value="yes" required /> It was submitted
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="submitted" value="no" /> It was not submitted
              </label>
            </div>
            <input
              name="externalApplicationId"
              placeholder="Reference / application ID (optional)"
              className={inputClass}
            />
            <input name="note" placeholder="Where you checked (optional)" className={inputClass} />
          </ActionBox>
        </Alert>
      ) : status === "NEEDS_HUMAN_INPUT" ? (
        <Alert tone="warning" title="Needs you">
          {app.blockedReason ??
            (fails.length
              ? fails.map((f) => f.detail).join(" ")
              : "Some fields or answers need your input.")}
        </Alert>
      ) : status === "BLOCKED" ? (
        <Alert tone="danger" title="Blocked">
          {app.blockedReason}
        </Alert>
      ) : status === "READY_TO_SUBMIT" ? (
        <Alert tone="info" title="Approved — nothing has been submitted yet">
          {adapter?.usesBrowser && app.automationMode !== "MANUAL_ONLY"
            ? "Start the automation below, or apply manually with the checklist."
            : channel?.channelType === "EMAIL_APPLICATION"
              ? "Prepare the email below, send it from your own mail client, then confirm."
              : "Apply with the checklist below, then confirm."}
        </Alert>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title={`Readiness — ${human(review.evaluation.readiness)}`}
            actions={
              <InlineAction action={refreshReadinessAction} hidden={hidden}>
                Re-check
              </InlineAction>
            }
          >
            <ul className="flex flex-col gap-1 text-xs">
              {review.evaluation.items.map((i) => (
                <li key={i.key} className="flex gap-2">
                  <span className={ITEM_TONE[i.status]}>{ITEM_MARK[i.status]}</span>
                  <span className="text-fg font-medium">{i.label}</span>
                  <span className="text-fg-muted">{i.detail}</span>
                </li>
              ))}
            </ul>
            <p className="text-fg-subtle font-mono text-[10px]">
              application hash {review.evaluation.hash.slice(0, 16)}…
            </p>
          </Section>

          <Section title="Application channel">
            {app.channels.length === 0 ? (
              <p className="text-fg-muted text-xs">No channel discovered yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5 text-xs">
                {app.channels.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2">
                    {c.id === app.channelId && <Badge tone="accent">primary</Badge>}
                    <span className="text-fg">{human(c.channelType)}</span>
                    {c.provider !== "NONE" && <Badge>{human(c.provider)}</Badge>}
                    <Badge
                      tone={
                        c.verificationStatus === "SOURCE_VERIFIED"
                          ? "success"
                          : c.verificationStatus === "STALE"
                            ? "neutral"
                            : "warning"
                      }
                    >
                      {human(c.verificationStatus)}
                    </Badge>
                    <span className="text-fg-muted truncate">{c.url ?? c.email ?? ""}</span>
                    <span className="text-fg-subtle">via {human(c.source)}</span>
                  </li>
                ))}
              </ul>
            )}
            {!sensitive && (
              <div className="flex flex-col gap-2">
                <InlineAction action={discoverChannelsAction} hidden={hidden} variant="secondary">
                  {app.channels.length ? "Re-discover" : "Discover channel"}
                </InlineAction>
                <details className="text-xs">
                  <summary className="text-fg-muted cursor-pointer">
                    Enter the application URL or email yourself
                  </summary>
                  <ActionBox
                    action={discoverChannelsAction}
                    hidden={hidden}
                    submitLabel="Use this channel"
                    className="mt-2"
                  >
                    <input
                      name="url"
                      type="url"
                      placeholder="https://… (official application form)"
                      className={inputClass}
                    />
                    <input
                      name="email"
                      type="email"
                      placeholder="jobs@company.com (only if the company publishes it)"
                      className={inputClass}
                    />
                    <p className="text-fg-subtle text-[11px]">
                      Recorded as provided by you (unverified).
                    </p>
                  </ActionBox>
                </details>
              </div>
            )}
          </Section>

          {adapter && (
            <Section title={`Form — ${adapter.label}`}>
              <p className="text-fg-muted text-xs">{adapter.limitations}</p>
              <p className="text-fg-subtle text-[11px]">
                Verification: {human(adapter.capabilities.verification)}
                {adapter.isTest ? " · TEST ADAPTER" : ""}
              </p>
              {review.form ? (
                <p className="text-xs">
                  {review.form.fields.length} fields · schema v{review.form.schemaVersion} ·{" "}
                  {human(review.form.inspectionSource)} ·{" "}
                  {review.form.status === "CHANGED" ? (
                    <span className="text-danger">changed — inspect again</span>
                  ) : (
                    `inspected ${ago(review.form.discoveredAt)}`
                  )}
                </p>
              ) : (
                <p className="text-fg-muted text-xs">
                  {adapter.capabilities.supportsInspection
                    ? "Not inspected yet."
                    : "No form for this channel."}
                </p>
              )}
              {adapter.capabilities.supportsInspection && !sensitive && !activeAttempt && (
                <InlineAction action={inspectFormAction} hidden={hidden} variant="secondary">
                  {review.form ? "Inspect again" : "Inspect form"}
                </InlineAction>
              )}
            </Section>
          )}

          <Section title="Automation">
            {!execution.automationEnabled && (
              <p className="text-fg-muted text-xs">
                Browser automation is off (APPLICATION_AUTOMATION_ENABLED). The manual checklist
                below always works.
              </p>
            )}
            <ExecutionPanel applicationId={app.id} initial={execution} />
            {status === "READY_TO_SUBMIT" &&
              adapter?.usesBrowser &&
              app.automationMode !== "MANUAL_ONLY" &&
              execution.automationEnabled &&
              !activeAttempt && (
                <ActionBox
                  action={startFillAction}
                  hidden={hidden}
                  submitLabel={
                    app.automationMode === "AUTO_FILL_REVIEW_SUBMIT"
                      ? "Fill and submit"
                      : "Fill the form"
                  }
                  variant="primary"
                >
                  <p className="text-fg-muted text-xs">
                    {MODE_LABELS[app.automationMode as AutomationMode].help}
                  </p>
                </ActionBox>
              )}
            {status === "READY_TO_SUBMIT" && !activeAttempt && (
              <InlineAction action={revokeApprovalAction} hidden={hidden}>
                Withdraw approval
              </InlineAction>
            )}
          </Section>

          {channel?.channelType === "EMAIL_APPLICATION" && (
            <Section title="Email application">
              {emailPayload ? (
                <div className="flex flex-col gap-2 text-xs">
                  <p>
                    To <span className="text-fg font-medium">{emailPayload.to}</span>{" "}
                    <CopyButton text={emailPayload.to} />
                  </p>
                  <p>
                    Subject <span className="text-fg font-medium">{emailPayload.subject}</span>{" "}
                    <CopyButton text={emailPayload.subject} />
                  </p>
                  <pre className="bg-surface-2 text-fg max-h-64 overflow-auto rounded p-2 whitespace-pre-wrap">
                    {emailPayload.body}
                  </pre>
                  <CopyButton text={emailPayload.body} label="Copy body" />
                  <p className="text-fg-muted">
                    Attach: {emailPayload.attachments.map((a) => a.fileName).join(", ") || "none"}
                  </p>
                  {readyToSend ? (
                    <Badge tone="info">Ready to send — send it yourself, then confirm below</Badge>
                  ) : (
                    <InlineAction action={prepareEmailAction} hidden={hidden} variant="secondary">
                      Mark ready to send
                    </InlineAction>
                  )}
                  <p className="text-fg-subtle">
                    Automatic sending needs an email connector (Phase 10). Nothing is sent by
                    JOBHUNT OS.
                  </p>
                </div>
              ) : (
                <p className="text-fg-muted text-xs">
                  Approve the application to prepare the email.
                </p>
              )}
            </Section>
          )}

          <Section
            title="Manual application checklist"
            actions={<CopyButton text={checklist.text} label="Copy all" />}
          >
            {checklist.url && (
              <p className="text-xs">
                Apply at{" "}
                <a
                  href={checklist.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent underline"
                >
                  {checklist.url}
                </a>
              </p>
            )}
            <ul className="divide-border flex flex-col divide-y text-xs">
              {checklist.items.map((i, n) => (
                <li key={n} className="flex items-start justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-fg">
                      {i.label}
                      {i.required && <span className="text-danger"> *</span>}
                    </p>
                    <p
                      className={
                        i.value ? "text-fg-muted break-words whitespace-pre-wrap" : "text-warning"
                      }
                    >
                      {i.value || "You need to fill this in."}
                    </p>
                  </div>
                  {i.value && i.kind !== "file" && <CopyButton text={i.value} />}
                </li>
              ))}
            </ul>
            {review.files.length > 0 && (
              <p className="flex flex-wrap gap-2 text-xs">
                {review.files.map((f) => (
                  <a
                    key={f.exportId}
                    className="text-accent underline"
                    href={
                      f.kind === "resume"
                        ? `/api/v1/resumes/exports/${f.exportId}/download`
                        : `/api/v1/communications/exports/${f.exportId}/download`
                    }
                  >
                    Download {f.fileName}
                  </a>
                ))}
              </p>
            )}
            {MANUAL_CONFIRM_FROM.includes(status) && !activeAttempt && (
              <ActionBox
                action={confirmManualAction}
                hidden={hidden}
                submitLabel="I submitted it"
                className="border-border mt-2 border-t pt-2"
              >
                <label className="text-fg flex items-start gap-2 text-xs">
                  <input type="checkbox" name="confirm" className="mt-0.5" /> I submitted this
                  application myself (recorded as confirmed by you, not verified automatically).
                </label>
                <input
                  name="externalApplicationId"
                  placeholder="Reference / application ID (optional)"
                  className={inputClass}
                />
                <input name="note" placeholder="Note (optional)" className={inputClass} />
              </ActionBox>
            )}
          </Section>

          <Section title="Timeline">
            <ol className="flex flex-col gap-1 text-xs">
              {app.events
                .slice()
                .reverse()
                .map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-fg-subtle w-20 shrink-0">{ago(e.createdAt)}</span>
                    <span className="text-fg">{human(e.eventType)}</span>
                    <span className="text-fg-muted truncate">{summarize(e.payload)}</span>
                  </li>
                ))}
            </ol>
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          <Section title="Package (locked versions)">
            <ul className="text-fg-muted flex flex-col gap-1 text-xs">
              <li>
                Package:{" "}
                <Link
                  className="text-accent underline"
                  href={`/communication-packages/${app.communicationPackage.id}`}
                >
                  {app.communicationPackage.title}
                </Link>
              </li>
              {(["resume", "coverLetter", "email"] as const).map((k) => {
                const v = snap[k];
                return v && typeof v === "object" ? (
                  <li key={k}>
                    {k === "coverLetter" ? "Cover letter" : k === "resume" ? "Resume" : "Email"}:
                    version {String(v.versionId).slice(0, 8)} · hash{" "}
                    {String(v.contentHash).slice(0, 10)}
                  </li>
                ) : null;
              })}
              <li className="font-mono text-[10px]">
                integrity {app.packageIntegrityHash.slice(0, 16)}…
              </li>
            </ul>
          </Section>
          <Section title="Automation mode">
            {!sensitive ? (
              <ActionBox action={setModeAction} hidden={hidden} submitLabel="Save mode">
                {AUTOMATION_MODES.map((m) => (
                  <label key={m} className="flex items-start gap-2 text-xs">
                    <input
                      type="radio"
                      name="mode"
                      value={m}
                      defaultChecked={app.automationMode === m}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="text-fg">{MODE_LABELS[m].label}</span>
                      <span className="text-fg-muted block">{MODE_LABELS[m].help}</span>
                    </span>
                  </label>
                ))}
              </ActionBox>
            ) : (
              <p className="text-fg-muted text-xs">
                {MODE_LABELS[app.automationMode as AutomationMode].label}
              </p>
            )}
          </Section>
          <Section title="Evidence">
            {app.submissions.length === 0 ? (
              <p className="text-fg-muted text-xs">No submission recorded.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-xs">
                {app.submissions.map((s) => (
                  <li key={s.id}>
                    <p className="text-fg">
                      {human(s.status)} · {ago(s.startedAt)}
                    </p>
                    <ul className="text-fg-muted pl-2">
                      {s.evidence.map((e) => (
                        <li key={e.id}>
                          {human(e.evidenceType)} ({human(e.source)})
                          {e.textExcerpt ? `: ${e.textExcerpt.slice(0, 120)}` : ""}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {!sensitive && !["CANCELLED", "ARCHIVED", "WITHDRAWN"].includes(status) && (
            <Section title="Stop this application">
              <div className="flex flex-wrap gap-2">
                <InlineAction
                  action={transitionAction}
                  hidden={{ ...hidden, to: "CANCELLED" }}
                  confirm="Cancel this application?"
                >
                  Cancel
                </InlineAction>
              </div>
            </Section>
          )}
          {["SUBMITTED", "SUBMISSION_CONFIRMED", "CANCELLED", "FAILED", "WITHDRAWN"].includes(
            status,
          ) && (
            <Section title="Archive">
              <InlineAction action={transitionAction} hidden={{ ...hidden, to: "ARCHIVED" }}>
                Archive
              </InlineAction>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

function summarize(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  return Object.entries(payload as Record<string, unknown>)
    .filter(([k, v]) => v !== undefined && v !== null && !/id$/i.test(k))
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
    .slice(0, 160);
}
