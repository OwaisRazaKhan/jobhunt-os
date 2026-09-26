"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  applyRecipientAction,
  createPackageAction,
  deleteRecipientAction,
  markReadyAction,
  savePreferencesAction,
  saveRecipientAction,
  updatePackageAction,
} from "@/app/(app)/communication-packages/actions";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { LENGTHS, RECIPIENT_LABELS, RECIPIENT_TYPES, TONES } from "../types";

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
  help,
  wide,
}: {
  label: string;
  children: ReactNode;
  help?: string;
  wide?: boolean;
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
  empty,
}: {
  name: string;
  options: Option[];
  defaultValue?: string | null;
  empty?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={inputClass}>
      {empty !== undefined && <option value="">{empty}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const cap = (s: string) => s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export interface PackageOptions {
  resumes: Option[];
  emails: Option[];
  coverLetters: Option[];
  recipients: Option[];
}

/** Create (no packageId) or edit (packageId) a package's exact selection. */
export function PackageForm({
  jobId,
  packageId,
  options,
  values,
}: {
  jobId: string;
  packageId?: string;
  options: PackageOptions;
  values: {
    channel?: string;
    includeEmail?: boolean;
    includeCoverLetter?: boolean;
    resumeVersionId?: string | null;
    emailVersionId?: string | null;
    coverLetterVersionId?: string | null;
    recipientContextId?: string | null;
    title?: string | null;
  };
}) {
  const [state, action, pending] = useActionState(
    packageId ? updatePackageAction : createPackageAction,
    INITIAL_ACTION_STATE,
  );
  const [channel, setChannel] = useState(values.channel ?? "PORTAL");
  const [includeEmail, setIncludeEmail] = useState(
    values.includeEmail ?? Boolean(values.emailVersionId),
  );
  const [includeCover, setIncludeCover] = useState(
    values.includeCoverLetter ?? Boolean(values.coverLetterVersionId),
  );
  const emailOn = channel === "EMAIL" || includeEmail;
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="jobId" value={jobId} />
      {packageId && <input type="hidden" name="packageId" value={packageId} />}
      <fieldset className="border-border flex flex-col gap-2 rounded-md border p-3 text-xs">
        <legend className="text-fg-muted px-1 font-medium">
          How you intend to apply (nothing is submitted here)
        </legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="channel"
            value="PORTAL"
            checked={channel === "PORTAL"}
            onChange={() => setChannel("PORTAL")}
          />
          <span>Application portal / form — resume, optionally a cover letter and email</span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="channel"
            value="EMAIL"
            checked={channel === "EMAIL"}
            onChange={() => setChannel("EMAIL")}
          />
          <span>By email — resume + application email to a recipient address you know</span>
        </label>
      </fieldset>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Resume version (approved)" help="Exact version — never “latest”.">
          <Select
            name="resumeVersionId"
            options={options.resumes}
            defaultValue={values.resumeVersionId}
            empty="Select…"
          />
        </Field>
        <Field label="Title (optional)">
          <input
            name="title"
            defaultValue={values.title ?? ""}
            maxLength={200}
            className={inputClass}
            placeholder="Defaults to the job and company"
          />
        </Field>
        <div className="flex flex-col gap-1">
          {channel === "PORTAL" ? (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                name="includeEmail"
                checked={includeEmail}
                onChange={(e) => setIncludeEmail(e.target.checked)}
              />{" "}
              Include an application email
            </label>
          ) : (
            <input type="hidden" name="includeEmail" value="true" />
          )}
          {emailOn && (
            <Select
              name="emailVersionId"
              options={options.emails}
              defaultValue={values.emailVersionId}
              empty={options.emails.length ? "Select…" : "No approved email for this job yet"}
            />
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              name="includeCoverLetter"
              checked={includeCover}
              onChange={(e) => setIncludeCover(e.target.checked)}
            />{" "}
            Include a cover letter
          </label>
          {includeCover && (
            <Select
              name="coverLetterVersionId"
              options={options.coverLetters}
              defaultValue={values.coverLetterVersionId}
              empty={
                options.coverLetters.length
                  ? "Select…"
                  : "No approved cover letter for this job yet"
              }
            />
          )}
        </div>
        <Field
          label="Recipient"
          help={
            channel === "EMAIL"
              ? "Required for an email application — only a recipient you know (manage under Recipients)."
              : "Optional."
          }
          wide
        >
          <Select
            name="recipientContextId"
            options={options.recipients}
            defaultValue={values.recipientContextId}
            empty="None"
          />
        </Field>
      </div>
      <Feedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending
            ? "Checking…"
            : packageId
              ? "Save selection & re-check"
              : "Create package & check readiness"}
        </Button>
      </div>
    </form>
  );
}

export function MarkReadyForm({ packageId }: { packageId: string }) {
  const [state, action, pending] = useActionState(markReadyAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2 text-xs">
      <input type="hidden" name="packageId" value={packageId} />
      <label className="flex items-start gap-2">
        <input type="checkbox" name="confirm" />
        <span>
          I reviewed every asset in this package. Marking it ready locks these exact versions for
          Phase 8. It does <strong>not</strong> submit or send anything.
        </span>
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Checking…" : "Mark ready for application"}
        </Button>
      </div>
    </form>
  );
}

export function RecipientForm({
  recipient,
  companies,
  sources,
}: {
  recipient?: Record<string, string | null> & { id: string };
  companies: Option[];
  sources: Option[];
}) {
  const [state, action, pending] = useActionState(saveRecipientAction, INITIAL_ACTION_STATE);
  const r = recipient ?? ({} as Record<string, string | null>);
  return (
    <form action={action} className="flex flex-col gap-2">
      {recipient && <input type="hidden" name="recipientId" value={recipient.id} />}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" defaultValue={r.name ?? ""} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Title">
          <input name="title" defaultValue={r.title ?? ""} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Company">
          <input
            name="company"
            defaultValue={r.company ?? ""}
            maxLength={200}
            className={inputClass}
          />
        </Field>
        <Field label="Linked company (optional)">
          <Select name="companyId" options={companies} defaultValue={r.companyId} empty="None" />
        </Field>
        <Field label="Email" help="Only an address you actually have — never a guessed pattern.">
          <input
            name="email"
            type="email"
            defaultValue={r.email ?? ""}
            maxLength={254}
            className={inputClass}
          />
        </Field>
        <Field label="Recipient type">
          <Select
            name="recipientType"
            options={RECIPIENT_TYPES.map((t) => ({ value: t, label: RECIPIENT_LABELS[t] }))}
            defaultValue={r.recipientType ?? "UNKNOWN"}
          />
        </Field>
        <Field label="Where these details come from">
          <Select name="source" options={sources} defaultValue={r.source ?? "USER_PROVIDED"} />
        </Field>
        <Field label="Source link">
          <input
            name="sourceUrl"
            type="url"
            defaultValue={r.sourceUrl ?? ""}
            maxLength={2048}
            placeholder="https://…"
            className={inputClass}
          />
        </Field>
        <Field label="Confidence">
          <Select
            name="confidence"
            options={["HIGH", "MEDIUM", "LOW"].map((c) => ({ value: c, label: cap(c) }))}
            defaultValue={r.confidence ?? "MEDIUM"}
          />
        </Field>
        <Field label="Status (if not verified)">
          <Select
            name="verificationStatus"
            options={["UNVERIFIED", "INVALID", "STALE"].map((c) => ({ value: c, label: cap(c) }))}
            defaultValue={
              r.verificationStatus && r.verificationStatus !== "SOURCE_VERIFIED"
                ? r.verificationStatus
                : "UNVERIFIED"
            }
          />
        </Field>
        <label className="flex items-start gap-2 text-xs sm:col-span-2">
          <input
            type="checkbox"
            name="markVerified"
            defaultChecked={r.verificationStatus === "SOURCE_VERIFIED"}
          />
          <span>
            I saw these exact details at the source link (job post, official company page or public
            professional profile). Mark as source verified.
          </span>
        </label>
        <Field label="Notes" wide>
          <textarea
            name="notes"
            defaultValue={r.notes ?? ""}
            maxLength={2000}
            rows={2}
            className={cn(inputClass, "h-auto py-1.5")}
          />
        </Field>
      </div>
      <Feedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : recipient ? "Save changes" : "Add recipient"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteRecipientButton({ recipientId }: { recipientId: string }) {
  const [state, action, pending] = useActionState(deleteRecipientAction, INITIAL_ACTION_STATE);
  return (
    <form
      action={action}
      onSubmit={(e) => !window.confirm("Delete this recipient?") && e.preventDefault()}
    >
      <input type="hidden" name="recipientId" value={recipientId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        Delete
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function ApplyRecipientForm({
  communicationId,
  options,
  current,
}: {
  communicationId: string;
  options: Option[];
  current: string | null;
}) {
  const [state, action, pending] = useActionState(applyRecipientAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-1 text-xs">
      <input type="hidden" name="communicationId" value={communicationId} />
      <div className="flex gap-1">
        <Select
          name="recipientContextId"
          options={options}
          defaultValue={current}
          empty="No saved recipient"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Apply
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function PreferencesForm({
  values,
  signatures,
  defaultSignatureId,
}: {
  values: {
    preferredGreeting: string | null;
    preferredClosing: string | null;
    defaultTone: string | null;
    defaultLength: string | null;
    avoidPhrases: string[];
  };
  signatures: Option[];
  defaultSignatureId: string | null;
}) {
  const [state, action, pending] = useActionState(savePreferencesAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Greeting word"
          help="e.g. “Hi” → “Hi Priya,” / “Hi Hiring Team,”. Names are never guessed."
        >
          <input
            name="preferredGreeting"
            defaultValue={values.preferredGreeting ?? ""}
            maxLength={40}
            placeholder="Dear"
            className={inputClass}
          />
        </Field>
        <Field label="Closing" help="e.g. “Best,”">
          <input
            name="preferredClosing"
            defaultValue={values.preferredClosing ?? ""}
            maxLength={60}
            placeholder="Kind regards,"
            className={inputClass}
          />
        </Field>
        <Field label="Default tone">
          <Select
            name="defaultTone"
            options={TONES.map((t) => ({ value: t, label: cap(t) }))}
            defaultValue={values.defaultTone}
            empty="Natural (default)"
          />
        </Field>
        <Field label="Default length">
          <Select
            name="defaultLength"
            options={LENGTHS.map((t) => ({ value: t, label: cap(t) }))}
            defaultValue={values.defaultLength}
            empty="Standard (default)"
          />
        </Field>
        <Field label="Default signature profile">
          <Select
            name="defaultSignatureId"
            options={signatures}
            defaultValue={defaultSignatureId}
            empty={signatures.length ? "Your name only" : "No signature profiles yet"}
          />
        </Field>
        <Field
          label="Phrases to avoid (one per line)"
          help="Never used in AI drafts; flagged by the quality check."
          wide
        >
          <textarea
            name="avoidPhrases"
            defaultValue={values.avoidPhrases.join("\n")}
            rows={4}
            className={cn(inputClass, "h-auto py-1.5")}
            placeholder="I hope this email finds you well."
          />
        </Field>
      </div>
      <Feedback state={state} />
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save preferences"}
        </Button>
      </div>
    </form>
  );
}
