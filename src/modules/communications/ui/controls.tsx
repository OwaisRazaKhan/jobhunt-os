"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  approveAction,
  createCommunicationAction,
  deleteSignatureAction,
  generateDraftAction,
  saveSignatureAction,
  updateSettingsAction,
} from "@/app/(app)/communications/actions";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/primitives";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  COVER_LETTER_TEMPLATES,
  EMAIL_TYPES,
  LENGTHS,
  RECIPIENT_LABELS,
  RECIPIENT_TYPES,
  TONES,
  TYPE_LABELS,
  type CommunicationType,
} from "../types";

export interface Option {
  value: string;
  label: string;
}

function Feedback({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p role="alert" className="text-danger text-xs">
        {state.error}
        {state.fieldErrors &&
          Object.entries(state.fieldErrors).map(([k, v]) => (
            <span key={k} className="block">
              {k}: {v}
            </span>
          ))}
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

function Field({
  label,
  children,
  wide,
  help,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  help?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1 text-xs", wide && "sm:col-span-2")}>
      <span className="text-fg-muted font-medium">{label}</span>
      {children}
      {help && <span className="text-fg-subtle text-[11px]">{help}</span>}
    </label>
  );
}

function Select({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: Option[];
  defaultValue?: string | null;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function RecipientFields({
  values = {},
}: {
  values?: Record<string, string | null | undefined>;
}) {
  return (
    <>
      <Field label="Recipient type">
        <Select
          name="recipientType"
          options={RECIPIENT_TYPES.map((r) => ({ value: r, label: RECIPIENT_LABELS[r] }))}
          defaultValue={values.recipientType ?? "UNKNOWN"}
        />
      </Field>
      <Field
        label="Recipient name"
        help="Only if you know it — never guessed. Leave empty for a generic greeting."
      >
        <input
          name="recipientName"
          defaultValue={values.recipientName ?? ""}
          maxLength={200}
          className={inputClass}
        />
      </Field>
      <Field label="Recipient title">
        <input
          name="recipientTitle"
          defaultValue={values.recipientTitle ?? ""}
          maxLength={200}
          className={inputClass}
        />
      </Field>
      <Field label="Recipient company">
        <input
          name="recipientCompany"
          defaultValue={values.recipientCompany ?? ""}
          maxLength={200}
          className={inputClass}
        />
      </Field>
      <Field label="Recipient email" help="Shown in the preview only; nothing is sent.">
        <input
          name="recipientEmail"
          type="email"
          defaultValue={values.recipientEmail ?? ""}
          maxLength={254}
          className={inputClass}
        />
      </Field>
      <Field label="Where this contact comes from">
        <input
          name="recipientSource"
          defaultValue={values.recipientSource ?? ""}
          maxLength={500}
          placeholder="e.g. named in the job posting"
          className={inputClass}
        />
      </Field>
    </>
  );
}

export function StyleFields({
  kind,
  values = {},
  signatures,
}: {
  kind: "EMAIL" | "COVER_LETTER";
  values?: Record<string, string | null | undefined>;
  signatures: Option[];
}) {
  return (
    <>
      <Field label="Tone">
        <Select
          name="tone"
          options={TONES.map((t) => ({ value: t, label: cap(t) }))}
          defaultValue={values.tone ?? "NATURAL"}
        />
      </Field>
      <Field label="Length">
        <Select
          name="length"
          options={LENGTHS.map((t) => ({ value: t, label: cap(t) }))}
          defaultValue={values.length ?? "STANDARD"}
        />
      </Field>
      {kind === "COVER_LETTER" && (
        <>
          <Field label="Template">
            <Select
              name="template"
              options={COVER_LETTER_TEMPLATES.map((t) => ({ value: t, label: cap(t) }))}
              defaultValue={values.template ?? "CLASSIC"}
            />
          </Field>
          <Field label="Page format">
            <Select
              name="pageFormat"
              options={[
                { value: "A4", label: "A4" },
                { value: "LETTER", label: "US Letter" },
              ]}
              defaultValue={values.pageFormat ?? "A4"}
            />
          </Field>
        </>
      )}
      <Field label="Signature">
        <Select
          name="signaturePresetId"
          options={[{ value: "", label: "Default (preset or your name only)" }, ...signatures]}
          defaultValue={values.signaturePresetId ?? ""}
        />
      </Field>
      <Field
        label="Your context (optional)"
        wide
        help="Anything true you want used, e.g. “I met the recruiter at a campus event”. Treated as your statement, not as verified."
      >
        <textarea
          name="userContext"
          defaultValue={values.userContext ?? ""}
          maxLength={2000}
          rows={3}
          className={cn(inputClass, "h-auto py-1.5")}
        />
      </Field>
    </>
  );
}

export function NewCommunicationForm({
  kind,
  type,
  jobs,
  resumes,
  signatures,
  defaults,
  aiAvailable,
  aiProvider,
  aiReason,
}: {
  kind: "EMAIL" | "COVER_LETTER";
  type: CommunicationType;
  jobs: Option[];
  resumes: Option[];
  signatures: Option[];
  defaults: { jobId: string | null; resumeVersionId: string | null };
  aiAvailable: boolean;
  aiProvider: string | null;
  aiReason: string | null;
}) {
  const [state, action, pending] = useActionState(createCommunicationAction, INITIAL_ACTION_STATE);
  const [mode, setMode] = useState<"manual" | "ai" | "import">(aiAvailable ? "ai" : "manual");
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {kind === "EMAIL" ? (
          <Field label="Email type">
            <Select
              name="communicationType"
              options={EMAIL_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }))}
              defaultValue={type}
            />
          </Field>
        ) : (
          <input type="hidden" name="communicationType" value="COVER_LETTER" />
        )}
        <Field
          label="Target job"
          help="The job's requirements, match and research are used and locked to each version."
        >
          <Select
            name="jobId"
            options={[{ value: "", label: "No job (general)" }, ...jobs]}
            defaultValue={defaults.jobId}
          />
        </Field>
        <Field
          label="Resume version"
          help="Associated only — nothing is attached or sent. Approved versions count as evidence."
        >
          <Select
            name="resumeVersionId"
            options={[{ value: "", label: "None" }, ...resumes]}
            defaultValue={defaults.resumeVersionId}
          />
        </Field>
        <Field label="Title (optional)">
          <input
            name="title"
            maxLength={200}
            className={inputClass}
            placeholder="Defaults to the job and company"
          />
        </Field>
        <RecipientFields />
        <StyleFields kind={kind} signatures={signatures} />
      </div>

      <fieldset className="border-border flex flex-col gap-2 rounded-md border p-3 text-xs">
        <legend className="text-fg-muted px-1 font-medium">How to start</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "ai"}
            onChange={() => setMode("ai")}
            disabled={!aiAvailable}
          />
          <span>
            Draft with AI from my facts {aiProvider && <Badge tone="ai">{aiProvider}</Badge>}
            {!aiAvailable && (
              <span className="text-fg-subtle block">
                {aiReason ?? "AI is not available."} Manual writing always works.
              </span>
            )}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "manual"}
            onChange={() => setMode("manual")}
          />
          <span>Write it myself (empty structure — no generic copy)</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            checked={mode === "import"}
            onChange={() => setMode("import")}
          />
          <span>
            Import an existing draft (pasted text; treated as data and checked like everything else)
          </span>
        </label>
        {mode === "import" && (
          <textarea
            name="importedText"
            rows={8}
            maxLength={20000}
            className={cn(inputClass, "h-auto py-1.5")}
            placeholder="Paste the draft here (Subject: … lines and greetings are recognised)"
          />
        )}
        <input type="hidden" name="generate" value={mode === "ai" ? "1" : "0"} />
      </fieldset>

      <Feedback state={state} />
      <div className="flex items-center justify-end gap-2">
        {pending && mode === "ai" && (
          <span className="text-fg-muted text-xs" role="status">
            Generating from your facts — a local model can take a minute or two…
          </span>
        )}
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? mode === "ai"
              ? "Generating…"
              : "Creating…"
            : mode === "ai"
              ? "Create & draft with AI"
              : mode === "import"
                ? "Import"
                : "Create"}
        </Button>
      </div>
    </form>
  );
}

interface StageView {
  key: string;
  label: string;
  status: string;
  ms: number;
  detail?: string;
}

export function GenerateForm({
  communicationId,
  hasContent,
  aiAvailable,
  aiProvider,
  aiReason,
}: {
  communicationId: string;
  hasContent: boolean;
  aiAvailable: boolean;
  aiProvider: string | null;
  aiReason: string | null;
}) {
  const [state, action, pending] = useActionState(generateDraftAction, INITIAL_ACTION_STATE);
  const stages = (state.data?.stages as StageView[] | undefined) ?? [];
  const removed = (state.data?.removed as { text: string; reasons: string[] }[] | undefined) ?? [];
  return (
    <form action={action} className="flex flex-col gap-2 text-xs">
      <input type="hidden" name="communicationId" value={communicationId} />
      {aiAvailable ? (
        <p className="text-fg-muted">
          Uses <Badge tone="ai">{aiProvider}</Badge>. Wording only — every statement is checked
          against your facts and sourced research; unsupported ones are removed. Creates a new
          version.
        </p>
      ) : (
        <p className="text-fg-muted">
          {aiReason ?? "AI is not available."} You can still write, check, approve and export
          manually.
        </p>
      )}
      <div>
        <Button
          type="submit"
          variant={hasContent ? "secondary" : "primary"}
          size="sm"
          disabled={pending || !aiAvailable}
        >
          {pending ? "Generating…" : hasContent ? "Regenerate with AI" : "Draft with AI"}
        </Button>
      </div>
      {pending && (
        <p role="status" className="text-fg-muted">
          Generating — loading your evidence, calling the model and validating every statement. A
          local model can take a minute or two.
        </p>
      )}
      <Feedback state={state} />
      {stages.length > 0 && (
        <ol className="border-border divide-border divide-y rounded-md border">
          {stages.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-2 px-2 py-1">
              <span>
                <span
                  className={
                    s.status === "done"
                      ? "text-success"
                      : s.status === "failed"
                        ? "text-danger"
                        : "text-fg-subtle"
                  }
                >
                  {s.status === "done" ? "✓" : s.status === "failed" ? "✕" : "–"}
                </span>{" "}
                {s.label}
                {s.detail && <span className="text-fg-subtle"> · {s.detail}</span>}
              </span>
              <span className="text-fg-subtle font-mono">
                {s.ms >= 1000 ? `${(s.ms / 1000).toFixed(1)} s` : `${s.ms} ms`}
              </span>
            </li>
          ))}
        </ol>
      )}
      {removed.length > 0 && (
        <details className="border-border rounded-md border p-2">
          <summary className="cursor-pointer font-medium">
            Removed from the AI draft ({removed.length})
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {removed.map((r, i) => (
              <li key={i}>
                <span className="text-fg line-through">{r.text}</span>
                <span className="text-fg-subtle block">{r.reasons.join(" ")}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </form>
  );
}

export function SettingsForm({
  communicationId,
  kind,
  values,
  signatures,
  facts = [],
  strategy = {},
}: {
  communicationId: string;
  kind: "EMAIL" | "COVER_LETTER";
  values: Record<string, string | null>;
  signatures: Option[];
  facts?: Option[];
  strategy?: {
    requestedAction?: string | null;
    primaryEvidence?: string[];
    secondaryEvidence?: string[];
    purpose?: string;
  };
}) {
  const [state, action, pending] = useActionState(updateSettingsAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="communicationId" value={communicationId} />
      <div className="grid grid-cols-1 gap-3">
        <Field label="Title">
          <input
            name="title"
            defaultValue={values.title ?? ""}
            maxLength={200}
            className={inputClass}
          />
        </Field>
        <RecipientFields values={values} />
        <StyleFields kind={kind} values={values} signatures={signatures} />
        <fieldset className="border-border flex flex-col gap-2 rounded-md border p-2 text-xs">
          <legend className="text-fg-muted px-1 font-medium">
            Strategy
            {strategy.purpose ? ` · ${strategy.purpose.toLowerCase().replace(/_/g, " ")}` : ""}
          </legend>
          <Field
            label="What you ask for (optional)"
            help="e.g. “a short call about the role”. Used as the closing request."
          >
            <input
              name="requestedAction"
              defaultValue={strategy.requestedAction ?? ""}
              maxLength={300}
              className={inputClass}
            />
          </Field>
          <input type="hidden" name="__arrays" value="primaryEvidence,secondaryEvidence" />
          {facts.length > 0 && (
            <details>
              <summary className="cursor-pointer">
                Evidence to lead with ({(strategy.primaryEvidence ?? []).length} primary ·{" "}
                {(strategy.secondaryEvidence ?? []).length} supporting)
              </summary>
              <ul className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto">
                {facts.map((f) => (
                  <li key={f.value} className="flex items-start gap-2">
                    <label className="flex items-center gap-1" title="Primary">
                      <input
                        type="checkbox"
                        name="primaryEvidence[]"
                        value={f.value}
                        defaultChecked={strategy.primaryEvidence?.includes(f.value)}
                      />{" "}
                      P
                    </label>
                    <label className="flex items-center gap-1" title="Supporting">
                      <input
                        type="checkbox"
                        name="secondaryEvidence[]"
                        value={f.value}
                        defaultChecked={strategy.secondaryEvidence?.includes(f.value)}
                      />{" "}
                      S
                    </label>
                    <span className="text-fg-muted">{f.label}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </fieldset>
      </div>
      <Feedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

export function ApproveForm({
  communicationId,
  versionId,
  contentHash,
  summary,
}: {
  communicationId: string;
  versionId: string;
  contentHash: string;
  summary: {
    target: string | null;
    company: string | null;
    resume: string | null;
    research: string | null;
    critical: number;
    warnings: number;
    info: number;
    unsupported: number;
    checked: boolean;
  };
}) {
  const [state, action, pending] = useActionState(approveAction, INITIAL_ACTION_STATE);
  const blocked = summary.critical > 0 || summary.unsupported > 0;
  return (
    <form action={action} className="flex flex-col gap-2 text-xs">
      <input type="hidden" name="communicationId" value={communicationId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="contentHash" value={contentHash} />
      <dl className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-1">
        <dt className="text-fg-muted">Target</dt>
        <dd>{summary.target ?? "—"}</dd>
        <dt className="text-fg-muted">Company</dt>
        <dd>{summary.company ?? "—"}</dd>
        <dt className="text-fg-muted">Resume</dt>
        <dd>{summary.resume ?? "None associated"}</dd>
        <dt className="text-fg-muted">Research</dt>
        <dd>{summary.research ?? "No research used"}</dd>
        <dt className="text-fg-muted">Findings</dt>
        <dd>
          {summary.checked ? (
            <>
              <span className={summary.critical ? "text-danger font-medium" : ""}>
                {summary.critical} critical
              </span>{" "}
              · {summary.warnings} warnings · {summary.info} informational
              {summary.unsupported > 0 && (
                <span className="text-danger"> · {summary.unsupported} unsupported statements</span>
              )}
            </>
          ) : (
            "Not checked yet — the check runs when you approve."
          )}
        </dd>
        <dt className="text-fg-muted">Content hash</dt>
        <dd className="font-mono break-all">{contentHash.slice(0, 16)}…</dd>
      </dl>
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" disabled={blocked} />
        <span>
          I reviewed this exact version. Approving locks it; editing later creates a new version.
        </span>
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending || blocked}>
          {pending ? "Approving…" : "Approve this version"}
        </Button>
      </div>
      {blocked && (
        <p className="text-danger">Fix the critical findings / unsupported statements first.</p>
      )}
    </form>
  );
}

export function SignatureForm({
  preset,
}: {
  preset?: { id: string; name: string; isDefault: boolean; fields: Record<string, string | null> };
}) {
  const [state, action, pending] = useActionState(saveSignatureAction, INITIAL_ACTION_STATE);
  const f = preset?.fields ?? {};
  const fields: [string, string][] = [
    ["name", "Name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["location", "Location"],
    ["linkedin", "LinkedIn"],
    ["portfolio", "Portfolio"],
    ["website", "Website"],
  ];
  return (
    <form action={action} className="flex flex-col gap-2">
      {preset && <input type="hidden" name="presetId" value={preset.id} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Preset name">
          <input
            name="name"
            required
            defaultValue={preset?.name ?? ""}
            maxLength={80}
            className={inputClass}
          />
        </Field>
        <label className="flex items-center gap-2 pt-5 text-xs">
          <input type="checkbox" name="isDefault" defaultChecked={preset?.isDefault ?? false} /> Use
          by default
        </label>
        {fields.map(([k, label]) => (
          <Field key={k} label={label}>
            <input
              name={`f_${k}`}
              defaultValue={f[k] ?? ""}
              maxLength={300}
              className={inputClass}
            />
          </Field>
        ))}
      </div>
      <p className="text-fg-subtle text-[11px]">
        Only the fields you fill in appear. Nothing is added automatically.
      </p>
      <Feedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : preset ? "Save changes" : "Add signature"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteSignatureButton({ presetId }: { presetId: string }) {
  const [state, action, pending] = useActionState(deleteSignatureAction, INITIAL_ACTION_STATE);
  return (
    <form
      action={action}
      onSubmit={(e) => !window.confirm("Delete this signature preset?") && e.preventDefault()}
    >
      <input type="hidden" name="presetId" value={presetId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Delete
      </Button>
      <Feedback state={state} />
    </form>
  );
}
