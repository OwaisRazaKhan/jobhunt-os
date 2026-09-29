import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { addQuestionAction, generateAnswersAction } from "@/app/(app)/applications/actions";
import { inputClass } from "@/components/forms/field-control";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { getQuestions } from "@/modules/applications/answer.service";
import { SUBMISSION_SENSITIVE } from "@/modules/applications/state-machine";
import type { ApplicationStatus } from "@/modules/applications/types";
import { ActionBox, AnswerEditor } from "@/modules/applications/ui/controls";
import { human, VALIDATION_TONES } from "@/modules/applications/ui/labels";
import { Section } from "@/modules/communications/ui/panels";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Application questions · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function QuestionsPage({ params }: PageProps<"/applications/[id]/questions">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  let data;
  try {
    data = await getQuestions(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { app, questions } = data;
  const locked =
    SUBMISSION_SENSITIVE.includes(app.status as ApplicationStatus) ||
    ["CANCELLED", "ARCHIVED", "WITHDRAWN"].includes(app.status);
  const hidden = { applicationId: app.id };
  const generatable = questions.filter(
    (q) => q.cls.generatable && q.answers[0]?.approvalStatus !== "APPROVED",
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Questions"
        title={`Application questions — ${app.job.title}`}
        description="Drafts come only from your confirmed facts and sourced company research. Every sentence is checked; unsupported statements are removed. Legal, salary, availability and self-identification questions are never drafted — only you answer them."
        actions={
          <>
            <Link href={`/applications/${app.id}/review`} className={buttonClass("primary", "sm")}>
              Review
            </Link>
            <Link href={`/applications/${app.id}`} className={buttonClass("ghost", "sm")}>
              Back
            </Link>
          </>
        }
      />
      {!locked && generatable > 0 && (
        <ActionBox
          action={generateAnswersAction}
          hidden={hidden}
          submitLabel={`Draft ${generatable} answer(s) with the local model`}
          variant="primary"
        >
          <p className="text-fg-muted text-xs">
            Runs on your local model (Ollama) only — application answers never go to a cloud
            provider.
          </p>
        </ActionBox>
      )}
      {questions.length === 0 && (
        <Alert tone="info" title="No custom questions">
          The form has no custom questions. You can add one below (e.g. from an email application).
        </Alert>
      )}

      {questions.map((q) => {
        const a = q.answers[0];
        const current = q.answers.find((x) => x.isCurrent) ?? a;
        const warnings = (current?.warnings as string[]) ?? [];
        return (
          <Section key={q.id} title={q.questionText}>
            <div id={`q-${q.id}`} className="flex flex-wrap items-center gap-1.5 text-xs">
              {q.required && <Badge tone="danger">required</Badge>}
              <Badge>{human(q.classification)}</Badge>
              {q.maxLength && <Badge tone="neutral">max {q.maxLength} characters</Badge>}
              {current && (
                <Badge tone={VALIDATION_TONES[current.validationStatus] ?? "neutral"}>
                  {human(current.validationStatus)}
                </Badge>
              )}
              {current && (
                <Badge tone={current.approvalStatus === "APPROVED" ? "success" : "neutral"}>
                  {human(current.approvalStatus)}
                </Badge>
              )}
              {current && (
                <Badge tone={current.contentSource === "AI_GENERATED" ? "ai" : "neutral"}>
                  {human(current.contentSource)}
                </Badge>
              )}
              {current && <span className="text-fg-subtle">v{current.versionNumber}</span>}
            </div>
            <p className="text-fg-muted text-xs">{q.cls.reason}</p>
            {warnings.length > 0 && (
              <ul className="text-warning list-disc pl-4 text-xs">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <AnswerEditor
              applicationId={app.id}
              questionId={q.id}
              answer={current?.answerText ?? ""}
              maxLength={q.maxLength}
              approved={current?.approvalStatus === "APPROVED"}
              locked={locked}
            />
            {current &&
              (current.supportingFactRefs.length > 0 ||
                current.supportingResearchClaimIds.length > 0) && (
                <p className="text-fg-subtle text-[11px]">
                  Supported by {current.supportingFactRefs.length} of your facts
                  {current.supportingResearchClaimIds.length
                    ? ` and ${current.supportingResearchClaimIds.length} sourced research claim(s)`
                    : ""}
                  .
                </p>
              )}
          </Section>
        );
      })}

      {!locked && (
        <Section title="Add a question">
          <ActionBox action={addQuestionAction} hidden={hidden} submitLabel="Add question">
            <textarea
              name="question"
              rows={2}
              placeholder="The question exactly as asked"
              className={inputClass}
            />
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <input
                name="maxLength"
                type="number"
                min={1}
                placeholder="Character limit"
                className={`${inputClass} w-40`}
              />
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name="required" /> Required
              </label>
            </div>
          </ActionBox>
        </Section>
      )}
    </div>
  );
}
