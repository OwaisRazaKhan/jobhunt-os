"use client";

import { FlaskConical, History, Settings2 } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import {
  saveSourceConfigAction,
  testSourceAction,
  toggleSourceAction,
} from "@/app/(app)/jobs/actions";
import type { FieldDef } from "@/modules/candidate/form-fields";
import { SOURCE_DEFINITIONS, type SourceKey } from "../sources.schemas";

function configFields(key: SourceKey): FieldDef[] {
  const def = SOURCE_DEFINITIONS[key];
  const limits: FieldDef[] = [
    {
      name: "requestsPerMinute",
      label: "Max requests / minute",
      type: "number",
      min: 1,
      max: 60,
      help: "1–60",
    },
    {
      name: "maxPagesPerSync",
      label: "Max pages / sync",
      type: "number",
      min: 1,
      max: 50,
      help: "1–50",
    },
    {
      name: "maxJobsPerSync",
      label: "Max jobs / sync",
      type: "number",
      min: 1,
      max: 5000,
      help: "1–5000",
    },
    {
      name: "timeoutMs",
      label: "Request timeout (ms)",
      type: "number",
      min: 1000,
      max: 30000,
      help: "1000–30000",
    },
  ];
  const notes: FieldDef = { name: "notes", label: "Notes", type: "textarea", wide: true };
  switch (key) {
    case "ASHBY":
      return [
        {
          name: "boards",
          label: "Job board names",
          type: "list",
          wide: true,
          help: `One per line. Optionally add a company name: “acme = Acme Inc”. ${def.identifierHelp}`,
        },
        ...limits,
        notes,
      ];
    case "LEVER":
      return [
        {
          name: "sites",
          label: "Company site names",
          type: "list",
          wide: true,
          help: `One per line. Optionally add a company name: “acme = Acme Inc”. ${def.identifierHelp}`,
        },
        {
          name: "region",
          label: "Lever region",
          type: "select",
          options: [
            { value: "GLOBAL", label: "Global (jobs.lever.co)" },
            { value: "EU", label: "EU (jobs.eu.lever.co)" },
          ],
        },
        ...limits,
        notes,
      ];
    case "GREENHOUSE":
      return [
        {
          name: "boardTokens",
          label: "Board tokens",
          type: "list",
          wide: true,
          help: `One per line. Optionally add a company name: “acme = Acme Inc”. ${def.identifierHelp}`,
        },
        ...limits,
        notes,
      ];
    case "MANUAL":
      return [notes];
  }
}

export function ConfigureSourceButton({
  id,
  sourceKey,
  configuration,
  rateLimitSettings,
  notes,
}: {
  id: string;
  sourceKey: SourceKey;
  configuration: Record<string, unknown>;
  rateLimitSettings: Record<string, unknown>;
  notes: string | null;
}) {
  const [open, setOpen] = useState(false);
  const def = SOURCE_DEFINITIONS[sourceKey];
  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Configure ${def.name}`}
      >
        <Settings2 className="size-3.5" aria-hidden /> Configure
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Configure ${def.name}`}
        description={
          sourceKey === "MANUAL"
            ? "Manual Entry needs no external configuration."
            : "Saving does not contact the provider. Use Test to check your boards live."
        }
        wide
      >
        <ActionForm
          action={saveSourceConfigAction}
          fields={configFields(sourceKey)}
          values={{ ...configuration, ...rateLimitSettings, notes }}
          hidden={{ _id: id }}
          onCancel={() => setOpen(false)}
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}

export function SourceEnabledToggle({
  id,
  name,
  enabled,
}: {
  id: string;
  name: string;
  enabled: boolean;
}) {
  const [state, action, pending] = useActionState(toggleSourceAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="_id" value={id} />
      <input type="hidden" name="enabled" value={String(!enabled)} />
      <button
        type="submit"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? "Disable" : "Enable"} ${name}`}
        disabled={pending}
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors disabled:opacity-50",
          enabled ? "border-accent bg-accent/30" : "border-border-strong bg-surface-3",
        )}
      >
        <span
          className={cn(
            "size-3.5 rounded-full transition-transform",
            enabled ? "bg-accent translate-x-4.5" : "bg-fg-subtle translate-x-0.5",
          )}
        />
      </button>
      <span className="text-fg-muted text-[11px]">{enabled ? "Enabled" : "Disabled"}</span>
      {state.error && (
        <span role="alert" className="text-danger max-w-48 text-[11px]">
          {state.error}
        </span>
      )}
    </form>
  );
}

interface TestResult {
  board: string;
  ok: boolean;
  fetched: number;
  valid: number;
  message: string;
}

/** Runs a live test (max 3 boards) and shows the per-board outcome. */
export function TestSourceButton({
  id,
  name,
  configured,
}: {
  id: string;
  name: string;
  configured: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(testSourceAction, INITIAL_ACTION_STATE);
  const results = (state.data?.results ?? []) as TestResult[];
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
        disabled={!configured}
        title={configured ? undefined : "Add at least one board first"}
        aria-label={`Test ${name}`}
      >
        <FlaskConical className="size-3.5" aria-hidden /> Test
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Test ${name}`}
        description="Fetches up to 3 of your configured boards from the provider's public API and validates the postings. Nothing is saved to the job catalog; the result is recorded in the source history."
      >
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="_id" value={id} />
          {state.error && (
            <p role="alert" className="text-danger text-sm">
              {state.error}
            </p>
          )}
          {state.ok && (
            <div role="status" className="flex flex-col gap-1.5">
              <p className="text-fg text-sm">{state.message}</p>
              <ul className="divide-border border-border divide-y rounded-md border">
                {results.map((r) => (
                  <li key={r.board} className="flex items-start gap-2 px-3 py-2 text-xs">
                    <span className={r.ok ? "text-success" : "text-danger"}>
                      {r.ok ? "OK" : "FAILED"}
                    </span>
                    <span className="font-mono">{r.board}</span>
                    <span className="text-fg-muted ml-auto text-right">{r.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Testing…" : state.ok ? "Test again" : "Run test"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function SourceHistoryLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/jobs/sources/${id}`}
      className={buttonClass("ghost", "sm")}
      aria-label={`View ${name} history`}
    >
      <History className="size-3.5" aria-hidden /> History
    </Link>
  );
}
