import { Download } from "lucide-react";
import type { Metadata } from "next";
import { getServerEnv } from "@/config/env";
import { buttonClass } from "@/components/ui/button";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { primaryProvider } from "@/server/ai/router";
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
  const choice = primaryProvider();
  const health = choice ? await choice.provider.health(choice.model) : null;
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
          title="Local AI"
          description="Used only to assist CV extraction. Everything works without it."
        />
        <div className="divide-border divide-y">
          <Row label="Provider">
            {choice ? `Ollama · ${env.OLLAMA_BASE_URL}` : "Disabled (AI_ENABLED=false)"}
          </Row>
          <Row label="Model">
            {choice ? <span className="font-mono">{choice.model}</span> : "—"}
          </Row>
          <Row label="Status">
            {!health ? (
              <Badge>Disabled</Badge>
            ) : health.ok && health.modelAvailable ? (
              <Badge tone="success">Connected</Badge>
            ) : health.ok ? (
              <Badge tone="warning">Model not installed — run: ollama pull {choice?.model}</Badge>
            ) : (
              <Badge tone="warning">Offline — AI extraction is currently unavailable</Badge>
            )}
          </Row>
          <Row label="Privacy">
            Candidate documents are only sent to this local model — never to third-party AI
            services.
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
