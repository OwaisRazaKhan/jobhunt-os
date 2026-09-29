import type { Metadata } from "next";
import Link from "next/link";
import { saveApplicationSettingsAction } from "@/app/(app)/applications/actions";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/primitives";
import { getServerEnv } from "@/config/env";
import { getApplicationSettings } from "@/modules/applications/prepare.service";
import { AUTOMATION_MODES } from "@/modules/applications/types";
import { ActionBox } from "@/modules/applications/ui/controls";
import { MODE_LABELS } from "@/modules/applications/ui/labels";
import { Section } from "@/modules/communications/ui/panels";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Application settings · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function ApplicationSettingsPage() {
  const actor = await requireActorOrRedirect();
  const settings = await getApplicationSettings(actor);
  const env = getServerEnv();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Apply"
        title="Application settings"
        description="How much JOBHUNT OS may do after you approve an application. Barriers (CAPTCHA, sign-in, 2FA) and uncertain results always stop for you."
        actions={
          <Link href="/applications" className={buttonClass("ghost", "sm")}>
            Applications
          </Link>
        }
      />
      <Section title="Defaults for new applications">
        <ActionBox
          action={saveApplicationSettingsAction}
          hidden={{}}
          submitLabel="Save settings"
          variant="primary"
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg mb-1 text-xs font-medium">Automation mode</legend>
            {AUTOMATION_MODES.map((m) => (
              <label key={m} className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  name="defaultAutomationMode"
                  value={m}
                  defaultChecked={settings.defaultAutomationMode === m}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-fg">{MODE_LABELS[m].label}</span>
                  <span className="text-fg-muted block">{MODE_LABELS[m].help}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-fg mb-1 text-xs font-medium">
              Auto-submit only when every filled value is at least
            </legend>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="autoFillMinConfidence"
                value="HIGH"
                defaultChecked={settings.autoFillMinConfidence === "HIGH"}
              />{" "}
              High confidence (default)
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="radio"
                name="autoFillMinConfidence"
                value="EXACT"
                defaultChecked={settings.autoFillMinConfidence === "EXACT"}
              />{" "}
              Exact only — otherwise the worker waits for your submit decision
            </label>
          </fieldset>
        </ActionBox>
      </Section>
      <Section title="Browser worker (this machine)">
        <ul className="text-fg-muted flex flex-col gap-1 text-xs">
          <li>
            Automation:{" "}
            {env.APPLICATION_AUTOMATION_ENABLED
              ? "enabled"
              : "off (APPLICATION_AUTOMATION_ENABLED=false)"}
          </li>
          <li>
            Browser: installed {env.APPLICATION_BROWSER_CHANNEL} ·{" "}
            {env.APPLICATION_BROWSER_HEADLESS ? "headless" : "visible window"} (nothing is
            downloaded)
          </li>
          <li>
            Run the worker next to the app: <code>npm run worker:applications</code>
          </li>
        </ul>
      </Section>
    </div>
  );
}
