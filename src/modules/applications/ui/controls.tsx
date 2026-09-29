"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import {
  approveAnswerAction,
  confirmFieldAction,
  controlAttemptAction,
  editAnswerAction,
  overrideFieldAction,
  requestSubmitAction,
} from "@/app/(app)/applications/actions";
import type { FormAction } from "@/components/forms/action-form";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";

export function Feedback({ state }: { state: ActionState }) {
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

/** A small form bound to a Server Action with free-form children (inputs) and one submit button. */
export function ActionBox({
  action,
  hidden,
  submitLabel,
  children,
  variant = "secondary",
  className,
  confirmText,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  submitLabel: string;
  children?: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  className?: string;
  confirmText?: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  return (
    <form
      action={formAction}
      className={cn("flex flex-col gap-2", className)}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant={variant} disabled={pending}>
          {pending ? "Working…" : submitLabel}
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="border-border text-fg-muted hover:text-fg rounded border px-1.5 py-0.5 text-[11px]"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}

export interface FieldEditorProps {
  applicationId: string;
  fieldId: string;
  label: string;
  fieldType: string;
  options: string[];
  value: unknown;
  maxLength: number | null;
  canConfirm: boolean;
  locked: boolean;
}

/** Inline editor for one form field (every change is a new, user-created mapping version). */
export function FieldEditor(p: FieldEditorProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(overrideFieldAction, INITIAL_ACTION_STATE);
  const [cState, confirmAction, cPending] = useActionState(
    confirmFieldAction,
    INITIAL_ACTION_STATE,
  );
  if (p.locked) return null;
  const current = Array.isArray(p.value)
    ? p.value.map(String)
    : p.value === null || p.value === undefined
      ? ""
      : String(p.value);
  const multi = p.fieldType === "MULTISELECT";
  const checkbox = p.fieldType === "CHECKBOX";
  const choice = p.options.length > 0 && !checkbox;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
          {open ? "Close" : "Edit"}
        </Button>
        {p.canConfirm && (
          <form action={confirmAction}>
            <input type="hidden" name="applicationId" value={p.applicationId} />
            <input type="hidden" name="fieldId" value={p.fieldId} />
            <Button type="submit" size="sm" variant="secondary" disabled={cPending}>
              Confirm
            </Button>
          </form>
        )}
      </div>
      <Feedback state={cState} />
      {open && (
        <form action={formAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="applicationId" value={p.applicationId} />
          <input type="hidden" name="fieldId" value={p.fieldId} />
          {multi && <input type="hidden" name="multi" value="1" />}
          {checkbox && <input type="hidden" name="checkbox" value="1" />}
          {checkbox ? (
            <label className="text-fg flex items-center gap-2 text-xs">
              <input type="checkbox" name="value" defaultChecked={p.value === true} /> Checked
            </label>
          ) : choice ? (
            <select
              name="value"
              multiple={multi}
              defaultValue={current}
              className={inputClass}
              aria-label={p.label}
            >
              {!multi && <option value="">— leave empty —</option>}
              {p.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : p.fieldType === "TEXTAREA" ? (
            <textarea
              name="value"
              defaultValue={String(current)}
              maxLength={p.maxLength ?? undefined}
              rows={4}
              className={inputClass}
              aria-label={p.label}
            />
          ) : (
            <input
              name="value"
              defaultValue={String(current)}
              maxLength={p.maxLength ?? undefined}
              className={inputClass}
              aria-label={p.label}
            />
          )}
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={pending}>
              Save value
            </Button>
            <Feedback state={state} />
          </div>
        </form>
      )}
    </div>
  );
}

/** Answer editor: save (re-audited) and approve the current version. */
export function AnswerEditor({
  applicationId,
  questionId,
  answer,
  maxLength,
  approved,
  locked,
}: {
  applicationId: string;
  questionId: string;
  answer: string;
  maxLength: number | null;
  approved: boolean;
  locked: boolean;
}) {
  const [value, setValue] = useState(answer);
  const [state, formAction, pending] = useActionState(editAnswerAction, INITIAL_ACTION_STATE);
  const [aState, approveAction, aPending] = useActionState(
    approveAnswerAction,
    INITIAL_ACTION_STATE,
  );
  const dirty = value !== answer;
  const over = maxLength !== null && value.length > maxLength;
  return (
    <div className="flex flex-col gap-1.5">
      <form action={formAction} className="flex flex-col gap-1.5">
        <input type="hidden" name="applicationId" value={applicationId} />
        <input type="hidden" name="questionId" value={questionId} />
        <textarea
          name="answer"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={Math.min(12, Math.max(3, Math.ceil(value.length / 90)))}
          className={inputClass}
          aria-label="Answer"
          disabled={locked}
        />
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-[11px]", over ? "text-danger" : "text-fg-subtle")}>
            {value.length}
            {maxLength ? ` / ${maxLength}` : ""} characters
          </span>
          {!locked && (
            <Button type="submit" size="sm" variant="secondary" disabled={pending || !dirty}>
              Save
            </Button>
          )}
          <Feedback state={state} />
        </div>
      </form>
      {!locked && !approved && !dirty && answer.trim() && (
        <form action={approveAction} className="flex items-center gap-2">
          <input type="hidden" name="applicationId" value={applicationId} />
          <input type="hidden" name="questionId" value={questionId} />
          <Button type="submit" size="sm" variant="primary" disabled={aPending}>
            Approve answer
          </Button>
          <Feedback state={aState} />
        </form>
      )}
    </div>
  );
}

export interface ExecutionState {
  app: { id: string; status: string };
  attempt: {
    id: string;
    attemptNumber: number;
    status: string;
    phase: string;
    humanAction: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    controlCommand: string;
    heartbeatAt: string | null;
    steps: { step: string; status: string; detail?: string; at?: string }[];
  } | null;
  submission: {
    id: string;
    status: string;
    confirmationSource: string | null;
    externalApplicationId: string | null;
  } | null;
  automationEnabled: boolean;
}

const ACTIVE = ["QUEUED", "RUNNING", "PAUSED", "NEEDS_HUMAN_INPUT"];

/** Live worker status (polls while an attempt is active) with pause / resume / stop / submit. */
export function ExecutionPanel({
  applicationId,
  initial,
}: {
  applicationId: string;
  initial: ExecutionState;
}) {
  const [state, setState] = useState(initial);
  const router = useRouter();
  const last = useRef(`${initial.app.status}:${initial.attempt?.status}`);
  const active = state.attempt && ACTIVE.includes(state.attempt.status);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/applications/${applicationId}/execution`, {
        cache: "no-store",
      }).catch(() => null);
      if (!res?.ok) return;
      const body = (await res.json()) as { data: ExecutionState };
      setState(body.data);
      const key = `${body.data.app.status}:${body.data.attempt?.status}`;
      if (key !== last.current) {
        last.current = key;
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [active, applicationId, router]);
  const a = state.attempt;
  if (!a) return <p className="text-fg-muted text-xs">No automation attempt yet.</p>;
  const waitingSubmit =
    a.status === "NEEDS_HUMAN_INPUT" &&
    a.phase === "FILL" &&
    state.app.status === "READY_TO_SUBMIT";
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-fg font-medium">
          Attempt {a.attemptNumber} · {a.phase.toLowerCase().replace(/_/g, " ")} ·{" "}
          {a.status.toLowerCase().replace(/_/g, " ")}
        </span>
        {a.status === "QUEUED" && (
          <span className="text-fg-muted">
            Waiting for the worker (npm run worker:applications)…
          </span>
        )}
        {a.heartbeatAt && active && (
          <span className="text-fg-subtle">
            last heartbeat {new Date(a.heartbeatAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      {a.humanAction && active && (
        <p className="border-warning/40 bg-warning/10 text-fg rounded border p-2">
          {a.humanAction}
        </p>
      )}
      {a.errorMessage && !active && (
        <p
          className={cn(
            "rounded border p-2",
            a.status === "SUCCEEDED"
              ? "border-success/40 text-fg"
              : "border-danger/40 bg-danger/5 text-fg",
          )}
        >
          {a.errorCode ? `${a.errorCode.replace(/_/g, " ").toLowerCase()}: ` : ""}
          {a.errorMessage}
        </p>
      )}
      {active && (
        <div className="flex flex-wrap gap-2">
          {a.status !== "PAUSED" && a.status !== "QUEUED" && !waitingSubmit && (
            <Control applicationId={applicationId} attemptId={a.id} command="PAUSE" label="Pause" />
          )}
          {a.status === "PAUSED" && (
            <Control
              applicationId={applicationId}
              attemptId={a.id}
              command="RESUME"
              label="Resume"
            />
          )}
          <Control
            applicationId={applicationId}
            attemptId={a.id}
            command="STOP"
            label="Stop"
            danger
          />
        </div>
      )}
      {waitingSubmit && (
        <ActionBox
          action={requestSubmitAction}
          hidden={{ applicationId }}
          submitLabel="Submit application"
          variant="primary"
        >
          <label className="text-fg flex items-start gap-2">
            <input type="checkbox" name="confirm" className="mt-0.5" /> I reviewed the filled form
            and want to submit this application now.
          </label>
        </ActionBox>
      )}
      {a.steps.length > 0 && (
        <ol className="text-fg-muted flex flex-col gap-0.5">
          {a.steps.map((s, i) => (
            <li key={i}>
              <span
                className={
                  s.status === "failed"
                    ? "text-danger"
                    : s.status === "waiting"
                      ? "text-warning"
                      : "text-success"
                }
              >
                ●
              </span>{" "}
              {s.step}
              {s.detail ? ` — ${s.detail}` : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Control({
  applicationId,
  attemptId,
  command,
  label,
  danger,
}: {
  applicationId: string;
  attemptId: string;
  command: string;
  label: string;
  danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(controlAttemptAction, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex items-center gap-1">
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="attemptId" value={attemptId} />
      <input type="hidden" name="command" value={command} />
      <Button type="submit" size="sm" variant={danger ? "danger" : "secondary"} disabled={pending}>
        {label}
      </Button>
      <Feedback state={state} />
    </form>
  );
}
