"use client";

import Link from "next/link";
import { useActionState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  confirmSkillsAction,
  createResumeAction,
  tailorResumeAction,
  updateResumeSettingsAction,
} from "@/app/(app)/resumes/actions";

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="text-danger text-xs">
        {state.error}
      </p>
    );
  if (state.ok && state.message)
    return (
      <p role="status" className="text-success text-xs">
        {state.message}
      </p>
    );
  return null;
}

export function CreateResumeForm({ resumes }: { resumes: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createResumeAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted font-medium">Name</span>
        <input
          name="name"
          required
          maxLength={120}
          className={inputClass}
          placeholder="e.g. Marketing roles"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted font-medium">Start from</span>
        <select name="fromResumeId" className={inputClass} defaultValue="">
          <option value="">My verified candidate facts</option>
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              Copy of {r.name}
            </option>
          ))}
        </select>
      </label>
      <Feedback state={state} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending} className="self-start">
        {pending ? "Creating…" : "Create resume"}
      </Button>
    </form>
  );
}

export function ResumeSettingsForm({
  resumeId,
  name,
  template,
  pageFormat,
  templates,
  formats,
  disabled,
}: {
  resumeId: string;
  name: string;
  template: string;
  pageFormat: string;
  templates: { key: string; label: string; description: string }[];
  formats: { key: string; label: string }[];
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(updateResumeSettingsAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="resumeId" value={resumeId} />
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted font-medium">Resume name</span>
        <input
          name="name"
          defaultValue={name}
          maxLength={120}
          className={inputClass}
          disabled={disabled}
        />
      </label>
      <fieldset className="flex flex-col gap-1" disabled={disabled}>
        <legend className="text-fg-muted mb-1 text-xs font-medium">Template</legend>
        {templates.map((t) => (
          <label
            key={t.key}
            className="border-border has-checked:border-accent has-checked:bg-accent/5 flex cursor-pointer items-start gap-2 rounded-md border px-2 py-1.5 text-xs"
          >
            <input
              type="radio"
              name="template"
              value={t.key}
              defaultChecked={t.key === template}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              <span className="text-fg font-medium">{t.label}</span>
              <span className="text-fg-muted block">{t.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted font-medium">Page format</span>
        <select
          name="pageFormat"
          defaultValue={pageFormat}
          className={inputClass}
          disabled={disabled}
        >
          {formats.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <Feedback state={state} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={pending || disabled}
        className="self-start"
      >
        {pending ? "Saving…" : "Save settings"}
      </Button>
    </form>
  );
}

interface Stage {
  key: string;
  label: string;
  status: "done" | "skipped" | "failed";
  ms: number;
  detail?: string;
}

const STEP_LABELS = [
  "Reading job requirements",
  "Finding relevant candidate evidence",
  "Selecting and ordering relevant experience",
  "Drafting targeted wording",
  "Validating claims",
  "Preparing version",
  "Running resume checks",
];

export function TailorForm({
  jobId,
  sources,
  aiConfigured,
  aiProvider,
  aiUnavailableReason,
}: {
  jobId: string;
  sources: { resumeId: string; versionId: string; label: string }[];
  aiConfigured: boolean;
  aiProvider: string | null;
  aiUnavailableReason: string | null;
}) {
  const [state, action, pending] = useActionState(tailorResumeAction, INITIAL_ACTION_STATE);
  const data = state.data as
    | {
        resumeId: string;
        versionId: string;
        stages: Stage[];
        aiStatus: string;
        changes: number;
        rejected: number;
        needsReview: number;
        quality: { passed: number; issues: number; warnings: number; opportunities: number };
      }
    | undefined;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-fg mb-1 text-[13px] font-semibold">1. Source resume</legend>
        {sources.length === 0 && (
          <p className="text-fg-muted text-xs">Create your master resume first.</p>
        )}
        {sources.map((s, i) => (
          <label
            key={s.versionId}
            className="border-border has-checked:border-accent has-checked:bg-accent/5 flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
          >
            <input
              type="radio"
              name="source"
              value={s.versionId}
              defaultChecked={i === 0}
              className="accent-[var(--accent)]"
              onChange={(e) => {
                const form = e.currentTarget.form!;
                (form.elements.namedItem("sourceResumeId") as HTMLInputElement).value = s.resumeId;
                (form.elements.namedItem("sourceVersionId") as HTMLInputElement).value =
                  s.versionId;
              }}
            />
            {s.label}
          </label>
        ))}
        <input type="hidden" name="sourceResumeId" defaultValue={sources[0]?.resumeId ?? ""} />
        <input type="hidden" name="sourceVersionId" defaultValue={sources[0]?.versionId ?? ""} />
      </fieldset>

      <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <legend className="text-fg mb-1 text-[13px] font-semibold">2. Tailoring behaviour</legend>
        <label className="flex flex-col gap-1 text-xs sm:col-span-2">
          <span className="text-fg-muted font-medium">Rewrite</span>
          <select name="rewriteDepth" defaultValue="full" className={inputClass}>
            <option value="full">
              Complete rewrite for this job — summary and every bullet (AI, fact-checked)
            </option>
            <option value="targeted">Targeted — only bullets that clearly improve</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted font-medium">Keyword alignment</span>
          <select name="keywordAlignment" defaultValue="balanced" className={inputClass}>
            <option value="conservative">Conservative — reorder only</option>
            <option value="balanced">
              Balanced — reorder, show relevant verified items, reword
            </option>
            <option value="strong">
              Strong — also reword more bullets toward the job&apos;s terms
            </option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted font-medium">Emphasis</span>
          <select name="emphasis" defaultValue="balanced" className={inputClass}>
            <option value="balanced">Balanced</option>
            <option value="experience">Experience</option>
            <option value="projects">Projects</option>
            <option value="skills">Skills</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted font-medium">Summary</span>
          <select name="summaryMode" defaultValue="preserve" className={inputClass}>
            <option value="preserve">Keep my summary</option>
            <option value="rewrite">Rewrite from my facts (AI)</option>
            <option value="generate">Write one from my facts (AI)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-fg-muted font-medium">Length</span>
          <select name="pageTarget" defaultValue="auto" className={inputClass}>
            <option value="auto">Automatic</option>
            <option value="one">Aim for one page</option>
            <option value="two">Up to two pages</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            name="includeProjects"
            defaultChecked
            className="size-4 accent-[var(--accent)]"
          />{" "}
          Include projects
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            name="includeLinks"
            defaultChecked
            className="size-4 accent-[var(--accent)]"
          />{" "}
          Include links
        </label>
        <label className="flex items-center gap-2 text-xs sm:col-span-2">
          <input
            type="checkbox"
            name="useAi"
            defaultChecked={aiConfigured}
            disabled={!aiConfigured}
            className="size-4 accent-[var(--accent)]"
          />
          Use AI for wording{" "}
          {aiConfigured && aiProvider
            ? `— ${aiProvider}`
            : `— unavailable: ${aiUnavailableReason ?? "no AI provider"} Deterministic tailoring only.`}
        </label>
      </fieldset>

      <p className="text-fg-muted text-xs">
        What changes: experience bullet order, project order and selection, skill order, section
        order{aiConfigured ? ", and wording validated against your facts" : ""}. No unsupported
        candidate facts will be added. Your source resume is not modified.
      </p>

      <Button
        type="submit"
        variant="primary"
        disabled={pending || sources.length === 0}
        className="self-start"
      >
        {pending ? "Tailoring…" : "Generate tailored draft"}
      </Button>

      {pending && (
        <ol className="text-fg-muted flex flex-col gap-0.5 text-xs" aria-live="polite">
          <li className="text-fg font-medium">Working — these steps run in order on the server:</li>
          {STEP_LABELS.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ol>
      )}
      <Feedback state={state} />
      {state.ok && data && (
        <div className="border-border bg-surface-2 flex flex-col gap-2 rounded-md border p-3 text-xs">
          <p className="text-fg font-medium">What happened</p>
          <ol className="flex flex-col gap-0.5">
            {data.stages.map((s) => (
              <li key={s.key} className="flex items-center gap-2">
                <Badge
                  tone={
                    s.status === "done" ? "success" : s.status === "skipped" ? "neutral" : "warning"
                  }
                >
                  {s.status}
                </Badge>
                <span className="text-fg">{s.label}</span>
                <span className="text-fg-subtle font-mono">{s.ms} ms</span>
                {s.detail && <span className="text-fg-muted">— {s.detail}</span>}
              </li>
            ))}
          </ol>
          <p className="text-fg-muted">
            {data.changes} change{data.changes === 1 ? "" : "s"} applied · {data.needsReview} need
            review · {data.rejected} rejected by validation · Resume Check: {data.quality.passed}{" "}
            passed, {data.quality.issues} issues, {data.quality.warnings} to review,{" "}
            {data.quality.opportunities} opportunities.
          </p>
          <div className="flex gap-2">
            <Link href={`/resumes/${data.resumeId}`} className={buttonClass("primary", "sm")}>
              Review tailored resume
            </Link>
            <Link
              href={`/resumes/${data.resumeId}/compare?to=${data.versionId}`}
              className={cn(buttonClass("secondary", "sm"))}
            >
              Compare with source
            </Link>
          </div>
        </div>
      )}
    </form>
  );
}

/**
 * "Do you have these skills?" — the job lists them but your profile does not. Ticking one saves it
 * to your candidate profile as a skill YOU entered (never added silently, never invented).
 */
export function ConfirmSkillsForm({
  jobId,
  missing,
}: {
  jobId: string;
  missing: { requirementId: string; name: string; requirementType: string }[];
}) {
  const [state, action, pending] = useActionState(confirmSkillsAction, INITIAL_ACTION_STATE);
  if (!missing.length)
    return (
      <p className="text-success text-xs" role="status">
        {state.ok && state.message ? `${state.message} ` : ""}✓ Every skill this job lists is in
        your profile.
      </p>
    );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <p className="text-fg-muted text-xs">
        Tick only skills you genuinely have. They are saved to your profile as facts you entered,
        and the next tailoring run includes them. Skills you don&apos;t have stay listed as gaps —
        they are never added to your resume.
      </p>
      <ul className="flex flex-col gap-1">
        {missing.map((m) => (
          <li key={m.requirementId}>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="requirementId"
                value={m.requirementId}
                className="size-4 accent-[var(--accent)]"
              />
              <span className="text-fg">{m.name}</span>
              <Badge tone={m.requirementType === "REQUIRED" ? "danger" : "info"}>
                {m.requirementType === "REQUIRED" ? "required" : "preferred"}
              </Badge>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "I have these — add to my profile"}
        </Button>
        {state.error && <span className="text-danger text-xs">{state.error}</span>}
        {state.ok && state.message && <span className="text-success text-xs">{state.message}</span>}
      </div>
    </form>
  );
}
