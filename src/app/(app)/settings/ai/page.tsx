import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, PageHeader, type Tone } from "@/components/ui/primitives";
import { getServerEnv } from "@/config/env";
import { AI_ERROR_MESSAGES } from "@/server/ai/errors";
import { providerStatuses, recentAiActivity } from "@/server/ai/orchestrator";
import { getAiPreferences } from "@/server/ai/preferences";
import { PLANNED_TASKS, SENSITIVITY_LABELS, TASKS } from "@/server/ai/registry";
import { resolveRoute } from "@/server/ai/router";
import type { AiErrorKind, AiTask } from "@/server/ai/types";
import { requireActorOrRedirect } from "@/server/session";
import { AiPreferencesForm, TestProviderButton } from "./ai-controls";

export const metadata: Metadata = { title: "AI settings · JOBHUNT OS" };
export const dynamic = "force-dynamic";
/** The Ollama test can take a while when the model is loaded for the first time. */
export const maxDuration = 300;

function StatusBadge({ status, configured }: { status: string | null; configured: boolean }) {
  if (!configured) return <Badge>Not configured</Badge>;
  if (status === "READY") return <Badge tone="success">● Connected</Badge>;
  const tone: Tone = status === "OFFLINE" || status === "INVALID_API_KEY" ? "danger" : "warning";
  return <Badge tone={tone}>{status ?? "Unknown"}</Badge>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 px-4 py-2 text-xs">
      <span className="text-fg-subtle">{label}</span>
      <span className="text-fg min-w-0">{children}</span>
    </div>
  );
}

const ago = (d: Date) => {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  return s < 60
    ? `${s}s ago`
    : s < 3600
      ? `${Math.round(s / 60)} min ago`
      : s < 86400
        ? `${Math.round(s / 3600)} h ago`
        : `${Math.round(s / 86400)} d ago`;
};

export default async function AiSettingsPage() {
  const actor = await requireActorOrRedirect();
  const env = getServerEnv();
  const [statuses, prefs, activity] = await Promise.all([
    providerStatuses(),
    getAiPreferences(actor.userId),
    recentAiActivity(actor.userId),
  ]);
  const ollama = statuses.ollama;
  const gemini = statuses.gemini;
  const tasks = Object.keys(TASKS) as AiTask[];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="System"
        title="AI providers"
        description="Ollama runs on this machine and is the default for anything about you. Gemini is an optional cloud model for public research. Statuses below come from live checks."
        actions={
          <Link href="/settings" className="text-accent text-sm underline">
            All settings
          </Link>
        }
      />
      {!env.AI_ENABLED && (
        <p className="text-warning text-sm">
          AI is disabled (AI_ENABLED=false). Every feature uses its non-AI path.
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Ollama"
            description="Local processing — private data default"
            actions={
              <StatusBadge status={ollama?.health.status ?? null} configured={Boolean(ollama)} />
            }
          />
          <div className="divide-border divide-y">
            <Row label="Model">
              <span className="font-mono">{env.OLLAMA_MODEL}</span>
            </Row>
            <Row label="Endpoint">
              <span className="font-mono">{env.OLLAMA_BASE_URL}</span> (server configuration only)
            </Row>
            <Row label="Status">
              {ollama
                ? ollama.health.status === "READY"
                  ? `Model installed${ollama.health.info?.loaded ? " and loaded in memory" : " (loads on first use)"}`
                  : (ollama.health.detail ?? AI_ERROR_MESSAGES[ollama.health.status as AiErrorKind])
                : "AI disabled"}
            </Row>
            {ollama?.health.info?.version ? (
              <Row label="Ollama version">{String(ollama.health.info.version)}</Row>
            ) : null}
            {Array.isArray(ollama?.health.info?.installed) && (
              <Row label="Installed models">
                {(ollama!.health.info!.installed as string[]).join(", ") || "none"}
              </Row>
            )}
            <Row label="Downloads">
              Never automatic — install models yourself with{" "}
              <code className="font-mono">ollama pull</code>.
            </Row>
            <div className="px-4 py-3">
              <TestProviderButton provider="ollama" label="Test Ollama" disabled={!ollama} />
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Gemini"
            description="Cloud processing — optional"
            actions={
              <StatusBadge status={gemini?.health.status ?? null} configured={Boolean(gemini)} />
            }
          />
          <div className="divide-border divide-y">
            <Row label="Model">
              <span className="font-mono">{env.GEMINI_MODEL}</span>
            </Row>
            <Row label="API key">
              {env.GEMINI_API_KEY
                ? "Configured on the server (never shown or sent to the browser)"
                : "Not set (GEMINI_API_KEY)"}
            </Row>
            <Row label="Status">
              {gemini
                ? gemini.health.status === "READY"
                  ? `Key accepted and model available${gemini.health.info?.inputTokenLimit ? ` · input limit ${Number(gemini.health.info.inputTokenLimit).toLocaleString()} tokens` : ""}`
                  : (gemini.health.detail ?? gemini.health.status)
                : "Gemini is optional — everything works with Ollama only."}
            </Row>
            <Row label="Billing">
              Gemini API quota and billing are separate from Google consumer subscriptions. Quota
              errors are shown, never retried in a loop.
            </Row>
            <div className="px-4 py-3">
              <TestProviderButton provider="gemini" label="Test Gemini" disabled={!gemini} />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader
            title="Privacy & routing"
            description={`Private candidate data: ${prefs.allowPrivateCloud && env.AI_ALLOW_PRIVATE_GEMINI ? "cloud allowed (you opted in)" : "local only"}`}
          />
          <div className="px-4 py-3">
            <AiPreferencesForm
              initial={prefs}
              geminiConfigured={Boolean(gemini)}
              privateCloudAllowedByServer={env.AI_ALLOW_PRIVATE_GEMINI}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Which provider each task uses (for you, now)" />
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-normal">Task</th>
                  <th className="px-2 py-2 font-normal">Data</th>
                  <th className="px-2 py-2 font-normal">Route</th>
                  <th className="px-4 py-2 font-normal">If AI can&apos;t run</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const policy = TASKS[task];
                  const route = resolveRoute(task, prefs);
                  return (
                    <tr key={task} className="border-border border-t align-top">
                      <td className="px-4 py-2">
                        <span className="text-fg">{policy.label}</span>
                        <span className="text-fg-subtle block">Phase {policy.phase}</span>
                      </td>
                      <td className="px-2 py-2">
                        <Badge tone={policy.sensitivity === "PUBLIC" ? "info" : "warning"}>
                          {SENSITIVITY_LABELS[policy.sensitivity]}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        {route.steps.length ? (
                          route.steps.map((s, i) => (
                            <span key={s.kind} className="block">
                              {i === 0 ? "" : prefs.autoFallback ? "then " : "(fallback off) "}
                              <span className="text-fg">
                                {s.kind === "ollama" ? "Ollama" : "Gemini"}
                              </span>{" "}
                              <span className="text-fg-subtle">— {s.reason}</span>
                            </span>
                          ))
                        ) : (
                          <span className="text-fg-muted">No AI</span>
                        )}
                        {route.denied.map((d) => (
                          <span key={d.kind} className="text-fg-subtle block">
                            ✕ {d.kind === "ollama" ? "Ollama" : "Gemini"}: {d.reason}
                          </span>
                        ))}
                      </td>
                      <td className="text-fg-muted px-4 py-2">
                        {policy.fallback === "deterministic"
                          ? "Deterministic engine"
                          : policy.fallback === "rules"
                            ? "Rule-based extraction"
                            : "Evidence kept, no summary"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-fg-subtle px-4 py-2 text-xs">
              Not yet built (declared for later phases, not routable):{" "}
              {PLANNED_TASKS.map((t) => `${t.label} (P${t.phase})`).join(" · ")}.
            </p>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent AI activity"
          description="Metadata only — prompts and your content are never stored or logged."
          count={activity.length}
        />
        {activity.length === 0 ? (
          <p className="text-fg-muted px-4 py-3 text-xs">No AI operations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-fg-subtle">
                <tr>
                  <th className="px-4 py-2 font-normal">When</th>
                  <th className="px-2 py-2 font-normal">Task</th>
                  <th className="px-2 py-2 font-normal">Provider · model</th>
                  <th className="px-2 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Time</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((a) => (
                  <tr key={a.id} className="border-border border-t">
                    <td className="text-fg-muted px-4 py-1.5">{ago(a.createdAt)}</td>
                    <td className="px-2 py-1.5">
                      {TASKS[a.task as AiTask]?.label ??
                        (a.task === "system.provider_test" ? "Provider test" : a.task)}
                    </td>
                    <td className="px-2 py-1.5 font-mono">
                      {a.provider} · {a.model}
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge
                        tone={
                          a.status === "SUCCEEDED"
                            ? "success"
                            : a.status === "SCHEMA_INVALID"
                              ? "warning"
                              : "danger"
                        }
                      >
                        {a.status === "SUCCEEDED" ? "OK" : (a.errorCode ?? a.status)}
                      </Badge>
                      {a.attempt > 1 && (
                        <span className="text-fg-subtle"> attempt {a.attempt}</span>
                      )}
                    </td>
                    <td className="text-fg-muted px-4 py-1.5">
                      {(a.latencyMs / 1000).toFixed(1)} s
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
