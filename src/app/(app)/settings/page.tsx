import { Download } from "lucide-react";
import type { Metadata } from "next";
import { getServerEnv } from "@/config/env";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { providerStatuses } from "@/server/ai/orchestrator";
import { getAiPreferences } from "@/server/ai/preferences";
import { getStorage } from "@/server/storage";
import { requireActorOrRedirect } from "@/server/session";
import { DeleteAccount, DeleteCandidateData } from "./danger-zone";

export const metadata: Metadata = { title: "Settings · JOBHUNT OS" };
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-fg-muted text-xs">{label}</span>
      <span className="text-fg text-xs">{children}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const actor = await requireActorOrRedirect();
  const env = getServerEnv();
  const [statuses, aiPrefs] = await Promise.all([
    providerStatuses(),
    getAiPreferences(actor.userId),
  ]);
  const status = (s: (typeof statuses)["ollama"]) =>
    !s ? (
      <Badge>Not configured</Badge>
    ) : s.health.status === "READY" ? (
      <Badge tone="success">Connected</Badge>
    ) : (
      <Badge tone="warning">{s.health.status}</Badge>
    );
  let storageKind = "not configured";
  try {
    storageKind =
      getStorage().kind === "supabase"
        ? `Supabase Storage · bucket “${env.SUPABASE_STORAGE_BUCKET}” (private)`
        : "Local disk (development only)";
  } catch {
    // shown as not configured
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="System" title="Settings" description={`Signed in as ${actor.email}`} />

      <Card>
        <CardHeader
          title="AI"
          description="Optional assistance. Every feature works without it."
          actions={
            <a href="/settings/ai" className={buttonClass("secondary", "sm")}>
              AI providers & privacy
            </a>
          }
        />
        <div className="divide-border divide-y">
          <Row label="Ollama (local)">
            {status(statuses.ollama)} <span className="font-mono">{env.OLLAMA_MODEL}</span>
          </Row>
          <Row label="Gemini (cloud)">
            {status(statuses.gemini)} <span className="font-mono">{env.GEMINI_MODEL}</span>
          </Row>
          <Row label="Private data">
            {aiPrefs.allowPrivateCloud && env.AI_ALLOW_PRIVATE_GEMINI
              ? "Cloud processing allowed (you opted in)."
              : "Local only — your candidate data is never sent to cloud AI."}
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader title="Storage" />
        <div className="divide-border divide-y">
          <Row label="Documents">{storageKind}</Row>
          <Row label="Isolation">
            Files are stored under your user id with server-generated keys; downloads are
            ownership-checked.
          </Row>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Your data"
          description="Export everything JOBHUNT OS stores about you."
        />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-fg-muted text-xs">
            Structured JSON: profile, facts with provenance, preferences, documents metadata,
            extraction results and your activity log.
          </p>
          <a href="/api/v1/candidate/export" className={buttonClass("secondary", "sm")}>
            <Download className="size-3.5" aria-hidden /> Export JSON
          </a>
        </div>
      </Card>

      <Card className="border-danger/30">
        <CardHeader title="Danger zone" />
        <div className="divide-border divide-y">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-fg-muted text-xs">
              Delete all candidate data and uploaded documents, keep your account.
            </p>
            <DeleteCandidateData />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-fg-muted text-xs">
              Delete your account and everything associated with it.
            </p>
            <DeleteAccount />
          </div>
        </div>
      </Card>
    </div>
  );
}
