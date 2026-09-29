import type { Metadata } from "next";
import Link from "next/link";
import { createWorkflowAction, importWorkflowAction } from "@/app/(app)/workflows/actions";
import { inputClass } from "@/components/forms/field-control";
import { Badge, EmptyState, PageHeader, type Tone } from "@/components/ui/primitives";
import { cn } from "@/lib/cn";
import { ActionBox } from "@/modules/applications/ui/controls";
import { ago } from "@/modules/communications/ui/labels";
import {
  listWorkflows,
  WORKFLOW_STATUSES,
  type WorkflowStatus,
} from "@/modules/workflows/workflow.service";
import { Section } from "@/modules/communications/ui/panels";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Workflows · JOBHUNT OS" };
export const dynamic = "force-dynamic";

const TONES: Record<WorkflowStatus, Tone> = {
  DRAFT: "neutral",
  ACTIVE: "success",
  ARCHIVED: "neutral",
};

export default async function WorkflowsPage({ searchParams }: PageProps<"/workflows">) {
  const actor = await requireActorOrRedirect();
  const sp = await searchParams;
  const status = (WORKFLOW_STATUSES as readonly string[]).includes(String(sp.status))
    ? (sp.status as WorkflowStatus)
    : undefined;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 100) : "";
  const workflows = await listWorkflows(actor, { q, status });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Automate"
        title="Workflows"
        description="Visual automations over your real JOBHUNT OS capabilities — search, match, research, resume, communication and application. Every run is recorded; anything that acts outside JOBHUNT OS needs your approval first."
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label="Filter workflows" className="flex flex-wrap gap-1.5">
          {([undefined, ...WORKFLOW_STATUSES] as const).map((s) => (
            <Link
              key={s ?? "all"}
              href={`/workflows${s ? `?status=${s}` : ""}`}
              aria-current={s === status ? "page" : undefined}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs",
                s === status
                  ? "border-accent/40 bg-accent/10 text-accent"
                  : "border-border text-fg-muted hover:text-fg",
              )}
            >
              {s ? s.charAt(0) + s.slice(1).toLowerCase() : "All"}
            </Link>
          ))}
        </nav>
        <form className="flex gap-2" action="/workflows">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search workflows…"
            aria-label="Search workflows"
            className={cn(inputClass, "w-56")}
          />
        </form>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {workflows.length === 0 ? (
            <EmptyState
              title="No workflows yet"
              description="Create one to start building an automation. Nothing runs until you start it."
            />
          ) : (
            <div className="border-border overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Version</th>
                    <th className="px-3 py-2 font-medium">Last run</th>
                    <th className="px-3 py-2 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {workflows.map((w) => (
                    <tr key={w.id} className="hover:bg-surface-2/50">
                      <td className="px-3 py-2">
                        <Link
                          href={`/workflows/${w.id}`}
                          className="text-fg font-medium hover:underline"
                        >
                          {w.name}
                        </Link>
                        {w.tags.length > 0 && (
                          <span className="text-fg-subtle ml-2">
                            {w.tags.map((t) => `#${t}`).join(" ")}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={TONES[w.status as WorkflowStatus] ?? "neutral"}>
                          {w.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="text-fg-muted px-3 py-2">
                        {w.activeVersion
                          ? `v${w.activeVersion.versionNumber} active`
                          : w.latestVersion
                            ? `v${w.latestVersion} saved`
                            : "draft only"}
                      </td>
                      <td className="text-fg-subtle px-3 py-2">Never run</td>
                      <td className="text-fg-subtle px-3 py-2">{ago(w.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          <Section title="New workflow">
            <ActionBox
              action={createWorkflowAction}
              hidden={{}}
              submitLabel="Create workflow"
              variant="primary"
            >
              <input
                name="name"
                required
                maxLength={120}
                placeholder="e.g. India remote AI jobs"
                aria-label="Name"
                className={inputClass}
              />
              <textarea
                name="description"
                rows={2}
                maxLength={2000}
                placeholder="What it's for (optional)"
                aria-label="Description"
                className={inputClass}
              />
              <input
                name="tags"
                placeholder="Tags, comma separated (optional)"
                aria-label="Tags"
                className={inputClass}
              />
            </ActionBox>
          </Section>
          <Section title="Import a workflow">
            <ActionBox action={importWorkflowAction} hidden={{}} submitLabel="Import as draft">
              <input
                type="file"
                name="file"
                accept="application/json,.json"
                aria-label="Workflow JSON file"
                className="text-fg-muted text-xs"
              />
              <p className="text-fg-subtle text-[11px]">
                JOBHUNT OS workflow exports only. Imported workflows are validated, unknown node
                types are removed, and nothing runs until you review and start it.
              </p>
            </ActionBox>
          </Section>
        </aside>
      </div>
    </div>
  );
}
