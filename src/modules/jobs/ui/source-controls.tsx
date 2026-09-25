"use client";

import { FlaskConical, History, Settings2 } from "lucide-react";
import { useActionState, useState } from "react";
import { ActionForm } from "@/components/forms/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { saveSourceConfigAction, toggleSourceAction } from "@/app/(app)/jobs/actions";
import type { FieldDef } from "@/modules/candidate/form-fields";
import { SOURCE_DEFINITIONS, type SourceKey } from "../sources.schemas";

const LATER = "Available after connector setup.";

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
            : "Saved settings are used once the connector is available. No request is sent to the source now."
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

/** Actions that belong to later checkpoints: visibly disabled, never faked. */
export function LaterActions({ isManual }: { isManual: boolean }) {
  if (isManual) return null;
  return (
    <>
      <Button size="sm" variant="ghost" disabled title={LATER} aria-label={`Test — ${LATER}`}>
        <FlaskConical className="size-3.5" aria-hidden /> Test
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled
        title={LATER}
        aria-label={`View history — ${LATER}`}
      >
        <History className="size-3.5" aria-hidden /> History
      </Button>
    </>
  );
}
