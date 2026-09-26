"use client";

import { Check, CircleDashed, Minus, RefreshCw, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import {
  addManualSourceAction,
  addNoteAction,
  deleteNoteAction,
  refreshResearchAction,
  saveResearchSettingsAction,
  setCompanyTargetAction,
  startCompanyResearchAction,
  startJobResearchAction,
} from "@/app/(app)/research/actions";
import { inputClass } from "@/components/forms/field-control";
import { Button, buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { DEPTH_CONFIG, DEPTHS, type Depth } from "../types";

interface Step {
  key: string;
  label: string;
  status: "DONE" | "FAILED" | "SKIPPED";
  detail?: string;
}
interface RunView {
  id: string;
  status: string;
  steps: Step[];
}

const ACTIVE = new Set(["QUEUED", "RUNNING"]);

function Status({ state }: { state: ActionState }) {
  if (state.error)
    return (
      <p className="text-danger text-xs" role="alert">
        {state.error}
      </p>
    );
  return state.message ? (
    <p className="text-fg-muted text-xs" role="status">
      {state.message}
    </p>
  ) : null;
}

/** Progress of a run: only steps the server actually recorded (polled from the API). */
export function ResearchProgress({ runId, initial }: { runId: string; initial?: RunView | null }) {
  const router = useRouter();
  const [run, setRun] = useState<RunView | null>(initial ?? null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/v1/research/runs/${runId}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const next = ((await res.json()) as { data: RunView }).data;
        setRun(next);
        if (!ACTIVE.has(next.status)) {
          clearInterval(timer);
          router.refresh();
        }
      } catch {
        // transient: keep polling
      }
    };
    const timer = setInterval(tick, 1200);
    void tick();
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [runId, router]);
  const steps = run?.steps ?? [];
  const active = !run || ACTIVE.has(run.status);
  return (
    <div className="flex flex-col gap-1.5" aria-live="polite">
      <ol className="flex flex-col gap-1 text-xs">
        {steps.map((s, i) => (
          <li key={`${s.key}-${i}`} className="flex items-start gap-2">
            {s.status === "DONE" ? (
              <Check className="text-success mt-0.5 size-3.5 shrink-0" aria-label="done" />
            ) : s.status === "FAILED" ? (
              <X className="text-danger mt-0.5 size-3.5 shrink-0" aria-label="failed" />
            ) : (
              <Minus className="text-fg-subtle mt-0.5 size-3.5 shrink-0" aria-label="skipped" />
            )}
            <span>
              <span className="text-fg">{s.label}</span>
              {s.detail && <span className="text-fg-subtle block break-words">{s.detail}</span>}
            </span>
          </li>
        ))}
        {active && (
          <li className="text-info flex items-center gap-2">
            <CircleDashed className="size-3.5 animate-spin" aria-hidden />
            {run?.status === "QUEUED" || !run ? "Queued…" : "Researching…"}
          </li>
        )}
      </ol>
    </div>
  );
}

function DepthSelect({ defaultDepth }: { defaultDepth: Depth }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-fg-muted">Depth</span>
      <select name="depth" defaultValue={defaultDepth} className={cn(inputClass, "h-8 w-auto")}>
        {DEPTHS.map((d) => (
          <option key={d} value={d} title={DEPTH_CONFIG[d].description}>
            {DEPTH_CONFIG[d].label} — up to {DEPTH_CONFIG[d].maxPages} pages
          </option>
        ))}
      </select>
    </label>
  );
}

/** "Research this job" / "Research company" / "Refresh" — then live progress. */
export function StartResearch({
  kind,
  targetId,
  researchId,
  defaultDepth,
  label,
  showRefreshCompany = false,
  variant = "primary",
}: {
  kind: "job" | "company" | "refresh";
  targetId: string;
  researchId?: string;
  defaultDepth: Depth;
  label: string;
  showRefreshCompany?: boolean;
  variant?: "primary" | "secondary";
}) {
  const action =
    kind === "job"
      ? startJobResearchAction
      : kind === "company"
        ? startCompanyResearchAction
        : refreshResearchAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  const runId = state.ok ? (state.data?.runId as string | undefined) : undefined;
  if (runId) return <ResearchProgress runId={runId} />;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input
        type="hidden"
        name={kind === "refresh" ? "_researchId" : "_id"}
        value={kind === "refresh" ? researchId : targetId}
      />
      <div className="flex flex-wrap items-end gap-2">
        <DepthSelect defaultDepth={defaultDepth} />
        <button type="submit" disabled={pending} className={buttonClass(variant, "sm")}>
          {kind === "refresh" ? (
            <RefreshCw className="size-3.5" aria-hidden />
          ) : (
            <Search className="size-3.5" aria-hidden />
          )}
          {pending ? "Starting…" : label}
        </button>
      </div>
      {showRefreshCompany && (
        <label className="text-fg-muted flex items-center gap-2 text-xs">
          <input type="checkbox" name="refreshCompany" /> Also refresh company research (otherwise
          current company research is reused)
        </label>
      )}
      <Status state={state} />
    </form>
  );
}

export function ManualSourceForm({ jobId, companyId }: { jobId?: string; companyId?: string }) {
  const [state, action, pending] = useActionState(addManualSourceAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-1.5">
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <label className="text-fg-muted text-xs" htmlFor={`src-${jobId ?? companyId}`}>
        Add a public URL (fetched safely; never trusted automatically)
      </label>
      <div className="flex gap-2">
        <input
          id={`src-${jobId ?? companyId}`}
          name="url"
          type="url"
          required
          placeholder="https://…"
          className={inputClass}
          maxLength={2048}
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Fetching…" : "Add"}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function NoteForm({ jobId, companyId }: { jobId?: string; companyId?: string }) {
  const [state, action, pending] = useActionState(addNoteAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-1.5" key={state.at}>
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <textarea
        name="body"
        required
        maxLength={4000}
        rows={3}
        placeholder="Private note (USER_NOTE — never treated as a verified public fact)"
        className={cn(inputClass, "h-auto py-1.5")}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Add note"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function DeleteNoteButton({
  noteId,
  jobId,
  companyId,
}: {
  noteId: string;
  jobId?: string;
  companyId?: string;
}) {
  const [, action, pending] = useActionState(deleteNoteAction, INITIAL_ACTION_STATE);
  return (
    <form action={action}>
      <input type="hidden" name="_id" value={noteId} />
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      {companyId && <input type="hidden" name="companyId" value={companyId} />}
      <button
        type="submit"
        disabled={pending}
        className="text-fg-subtle hover:text-danger text-[11px]"
      >
        Delete
      </button>
    </form>
  );
}

export function CompanyTargetForm({
  companyId,
  websiteUrl,
  careersUrl,
}: {
  companyId: string;
  websiteUrl: string;
  careersUrl: string;
}) {
  const [state, action, pending] = useActionState(setCompanyTargetAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="_id" value={companyId} />
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Official website (you confirm it)</span>
        <input
          name="websiteUrl"
          type="url"
          defaultValue={websiteUrl}
          placeholder="https://company.com"
          className={inputClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-fg-muted">Careers page (optional)</span>
        <input
          name="careersUrl"
          type="url"
          defaultValue={careersUrl}
          placeholder="https://company.com/careers"
          className={inputClass}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ResearchSettingsForm({
  initial,
  aiAvailable,
}: {
  initial: { defaultDepth: Depth; freshDays: number; staleDays: number; aiSynthesis: boolean };
  aiAvailable: boolean;
}) {
  const [state, action, pending] = useActionState(saveResearchSettingsAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">Default depth</span>
        <select name="defaultDepth" defaultValue={initial.defaultDepth} className={inputClass}>
          {DEPTHS.map((d) => (
            <option key={d} value={d}>
              {DEPTH_CONFIG[d].label}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Fresh for (days)</span>
          <input
            name="freshDays"
            type="number"
            min={1}
            max={365}
            defaultValue={initial.freshDays}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Stale after (days)</span>
          <input
            name="staleDays"
            type="number"
            min={2}
            max={730}
            defaultValue={initial.staleDays}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="aiSynthesis"
          defaultChecked={initial.aiSynthesis}
          className="mt-0.5"
        />
        <span>
          <span className="text-fg">AI synthesis (optional)</span>
          <span className="text-fg-subtle block">
            The configured AI provider (local Ollama by default) summarises the evidence. Every AI
            claim must cite evidence; unsupported claims are rejected and kept visible as rejected.
            AI claims are never marked verified.
            {!aiAvailable && " No AI provider is configured, so this currently has no effect."}
          </span>
        </span>
      </label>
      {state.fieldErrors?.staleDays && <p className="text-danger">{state.fieldErrors.staleDays}</p>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        <Status state={state} />
      </div>
    </form>
  );
}
