import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveApplicationAction, remapAction } from "@/app/(app)/applications/actions";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { getReview } from "@/modules/applications/review.service";
import { SUBMISSION_SENSITIVE } from "@/modules/applications/state-machine";
import { STATUS_LABELS, type ApplicationStatus } from "@/modules/applications/types";
import { ActionBox, FieldEditor } from "@/modules/applications/ui/controls";
import {
  APPLICATION_STATUS_TONES,
  displayValue,
  human,
  ITEM_MARK,
  ITEM_TONE,
  MAPPING_TONES,
} from "@/modules/applications/ui/labels";
import { Section } from "@/modules/communications/ui/panels";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Review application · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: PageProps<"/applications/[id]/review">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let review;
  try {
    review = await getReview(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { app, form, questions, files, approval, evaluation } = review;
  const status = app.status as ApplicationStatus;
  const locked =
    SUBMISSION_SENSITIVE.includes(status) ||
    ["CANCELLED", "ARCHIVED", "WITHDRAWN"].includes(status);
  const approvedCurrent = approval && approval.applicationHash === evaluation.hash;
  const answersByField = new Map(questions.filter((q) => q.fieldId).map((q) => [q.fieldId!, q]));
  const hidden = { applicationId: app.id };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Review"
        title="Review the application"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={APPLICATION_STATUS_TONES[status] ?? "neutral"}>
              {STATUS_LABELS[status]}
            </Badge>
            <span>
              Every value below is exactly what would be entered. Change anything before approving —
              any later change withdraws the approval.
            </span>
          </span>
        }
        actions={
          <>
            <Link
              href={`/applications/${app.id}/questions`}
              className={buttonClass("secondary", "sm")}
            >
              Questions
            </Link>
            <Link href={`/applications/${app.id}`} className={buttonClass("ghost", "sm")}>
              Back
            </Link>
          </>
        }
      />
      {locked && (
        <Alert tone="info" title="Locked">
          A submission has started or finished — this application can no longer change.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title={form ? `Form fields (${form.fields.length})` : "Form fields"}
            actions={
              !locked && form ? (
                <InlineAction action={remapAction} hidden={hidden}>
                  Re-map
                </InlineAction>
              ) : undefined
            }
          >
            {!form ? (
              <p className="text-fg-muted text-xs">
                No form inspected — for email or manual applications the files and answers below are
                what you send.
              </p>
            ) : (
              <ul className="divide-border flex flex-col divide-y">
                {form.fields.map((f) => {
                  const m = f.mappings[0];
                  const q = answersByField.get(f.id);
                  const answer = q?.answers[0];
                  const isAnswer = m?.mappingType === "GENERATED_ANSWER";
                  const file =
                    f.fieldType === "FILE"
                      ? files.find(
                          (x) =>
                            x.role ===
                            (m?.mappingType === "RESUME"
                              ? "RESUME"
                              : m?.mappingType === "COVER_LETTER"
                                ? "COVER_LETTER"
                                : ""),
                        )
                      : null;
                  const value = isAnswer
                    ? answer?.approvalStatus === "APPROVED"
                      ? answer.answerText
                      : ""
                    : file
                      ? file.fileName
                      : displayValue(m?.value);
                  const options = ((f.options as { label: string }[]) ?? []).map((o) => o.label);
                  return (
                    <li
                      key={f.id}
                      className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
                    >
                      <div className="min-w-0 text-xs">
                        <p className="text-fg font-medium">
                          {f.label}
                          {f.required && <span className="text-danger"> *</span>}
                        </p>
                        <p className="text-fg-subtle">
                          {human(f.fieldType)}
                          {f.maxLength ? ` · max ${f.maxLength}` : ""}
                          {f.classification !== "OTHER" ? ` · ${human(f.classification)}` : ""}
                        </p>
                      </div>
                      <div className="flex min-w-0 flex-col gap-1 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {m && (
                            <Badge
                              tone={
                                isAnswer
                                  ? answer?.approvalStatus === "APPROVED"
                                    ? "success"
                                    : "warning"
                                  : (MAPPING_TONES[m.status] ?? "neutral")
                              }
                            >
                              {isAnswer
                                ? answer?.approvalStatus === "APPROVED"
                                  ? "answer approved"
                                  : "answer needed"
                                : human(m.status)}
                            </Badge>
                          )}
                          {m && !isAnswer && <Badge>{human(m.mappingType)}</Badge>}
                          {m && !isAnswer && m.confidence !== "EXACT" && (
                            <Badge tone="neutral">{human(m.confidence)} confidence</Badge>
                          )}
                          {m?.createdBy === "AI" && <Badge tone="ai">AI suggestion</Badge>}
                        </div>
                        <p
                          className={
                            value ? "text-fg break-words whitespace-pre-wrap" : "text-warning"
                          }
                        >
                          {value || (f.required ? "Needs a value." : "Left empty.")}
                        </p>
                        {m?.explanation && <p className="text-fg-subtle">{m.explanation}</p>}
                        {isAnswer ? (
                          <Link
                            href={`/applications/${app.id}/questions#q-${q?.id ?? ""}`}
                            className="text-accent underline"
                          >
                            {answer ? "Edit / approve the answer" : "Answer this question"}
                          </Link>
                        ) : f.fieldType !== "FILE" ? (
                          <FieldEditor
                            applicationId={app.id}
                            fieldId={f.id}
                            label={f.label}
                            fieldType={f.fieldType}
                            options={options}
                            value={m?.value ?? null}
                            maxLength={f.maxLength}
                            canConfirm={Boolean(
                              m &&
                              m.status === "NEEDS_REVIEW" &&
                              m.value !== null &&
                              m.mappingType !== "UNKNOWN",
                            )}
                            locked={locked}
                          />
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section title="Files (exact approved versions)">
            {files.length === 0 ? (
              <p className="text-fg-muted text-xs">
                No files prepared yet (they are exported from the approved versions when the form is
                mapped).
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs">
                {files.map((f) => (
                  <li key={f.exportId} className="flex flex-wrap gap-2">
                    <span className="text-fg">
                      {f.role === "RESUME" ? "Resume" : "Cover letter"}
                    </span>
                    <span>{f.fileName}</span>
                    <span className="text-fg-subtle">
                      {(f.byteSize / 1024).toFixed(0)} KB · sha256 {f.sha256.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {questions.filter((q) => !q.fieldId).length > 0 && (
            <Section title="Additional questions">
              <ul className="flex flex-col gap-1 text-xs">
                {questions
                  .filter((q) => !q.fieldId)
                  .map((q) => (
                    <li key={q.id}>
                      <span className="text-fg">{q.questionText}</span> —{" "}
                      {q.answers[0]?.approvalStatus === "APPROVED" ? (
                        <span className="text-success">approved</span>
                      ) : (
                        <span className="text-warning">not approved</span>
                      )}
                    </li>
                  ))}
              </ul>
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Section title={`Readiness — ${human(evaluation.readiness)}`}>
            <ul className="flex flex-col gap-1 text-xs">
              {evaluation.items.map((i) => (
                <li key={i.key} className="flex gap-2">
                  <span className={ITEM_TONE[i.status]}>{ITEM_MARK[i.status]}</span>
                  <span>
                    <span className="text-fg">{i.label}</span>{" "}
                    <span className="text-fg-muted">{i.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="Approval">
            {approvedCurrent ? (
              <p className="text-success text-xs">
                Approved — this exact state (hash {evaluation.hash.slice(0, 12)}…). Nothing has been
                submitted yet.
              </p>
            ) : status === "READY" ? (
              <ActionBox
                action={approveApplicationAction}
                hidden={{ ...hidden, applicationHash: evaluation.hash }}
                submitLabel="Approve application"
                variant="primary"
              >
                <label className="text-fg flex items-start gap-2 text-xs">
                  <input type="checkbox" name="confirm" className="mt-0.5" /> I reviewed every
                  field, answer and file above. Approving does not submit anything.
                </label>
                <p className="text-fg-subtle font-mono text-[10px]">
                  hash {evaluation.hash.slice(0, 24)}…
                </p>
              </ActionBox>
            ) : (
              <p className="text-fg-muted text-xs">Resolve the failing readiness items first.</p>
            )}
          </Section>
        </aside>
      </div>
    </div>
  );
}
