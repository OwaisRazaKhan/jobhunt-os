"use client";

import { useActionState } from "react";
import { inputClass } from "@/components/forms/field-control";
import { Button } from "@/components/ui/button";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { saveAiPreferencesAction, testProviderAction } from "./actions";

export function TestProviderButton({
  provider,
  label,
  disabled,
}: {
  provider: "ollama" | "gemini";
  label: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(testProviderAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="provider" value={provider} />
      <Button type="submit" size="sm" variant="secondary" disabled={pending || disabled}>
        {pending ? "Testing… (real request)" : label}
      </Button>
      {state.error && (
        <p role="alert" className="text-danger max-w-sm text-xs">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-success max-w-sm text-xs">
          {state.message}
        </p>
      )}
    </form>
  );
}

export function AiPreferencesForm({
  initial,
  geminiConfigured,
  privateCloudAllowedByServer,
}: {
  initial: {
    primaryProvider: string;
    geminiForPublic: boolean;
    allowPrivateCloud: boolean;
    autoFallback: boolean;
  };
  geminiConfigured: boolean;
  privateCloudAllowedByServer: boolean;
}) {
  const [state, action, pending] = useActionState(saveAiPreferencesAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-3 text-xs">
      <label className="flex flex-col gap-1">
        <span className="text-fg-muted font-medium">Preferred provider</span>
        <select
          name="primaryProvider"
          defaultValue={initial.primaryProvider}
          className={inputClass}
        >
          <option value="auto">Automatic routing (recommended) — privacy rules decide</option>
          <option value="ollama">Prefer Ollama (local)</option>
          <option value="gemini" disabled={!geminiConfigured}>
            Prefer Gemini where permitted{geminiConfigured ? "" : " (not configured)"}
          </option>
        </select>
        <span className="text-fg-subtle">
          A preference never overrides privacy rules: private candidate data stays local unless you
          opt in below.
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="geminiForPublic"
          defaultChecked={initial.geminiForPublic}
          disabled={!geminiConfigured}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="text-fg font-medium">Use Gemini for public research</span>
          <span className="text-fg-muted block">
            Only public web evidence is sent (company/job research synthesis). No candidate data.
          </span>
        </span>
      </label>
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          name="autoFallback"
          defaultChecked={initial.autoFallback}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="text-fg font-medium">Automatic provider fallback</span>
          <span className="text-fg-muted block">
            If the first provider is unavailable, try another provider that your privacy settings
            already permit. Off: the non-AI path runs instead.
          </span>
        </span>
      </label>
      <label className="border-warning/30 bg-warning/5 flex items-start gap-2 rounded-md border p-2">
        <input
          type="checkbox"
          name="allowPrivateCloud"
          defaultChecked={initial.allowPrivateCloud}
          disabled={!privateCloudAllowedByServer || !geminiConfigured}
          className="mt-0.5 size-4 accent-[var(--accent)]"
        />
        <span>
          <span className="text-fg font-medium">Allow Gemini for private candidate data</span>
          <span className="text-fg-muted block">
            Sends your CV text, facts or resume content to Google&apos;s cloud API for the tasks
            that need it. Off by default.{" "}
            {!privateCloudAllowedByServer
              ? "Disabled on this server (AI_ALLOW_PRIVATE_GEMINI=false) — your data always stays local."
              : "Your name, email and phone are redacted before any cloud request."}
          </span>
        </span>
      </label>
      {state.error && (
        <p role="alert" className="text-danger">
          {state.error}
        </p>
      )}
      {state.ok && state.message && (
        <p role="status" className="text-success">
          {state.message}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save AI preferences"}
      </Button>
    </form>
  );
}
