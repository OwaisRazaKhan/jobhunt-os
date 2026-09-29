import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  activateWorkflowAction,
  archiveWorkflowAction,
  deactivateWorkflowAction,
  duplicateWorkflowAction,
  saveVersionAction,
  updateWorkflowMetaAction,
} from "@/app/(app)/workflows/actions";
import { inputClass } from "@/components/forms/field-control";
import { InlineAction } from "@/components/forms/inline-action";
import { buttonClass } from "@/components/ui/button";
import { Alert, Badge, PageHeader } from "@/components/ui/primitives";
import { isUuid } from "@/lib/ids";
import { ActionBox } from "@/modules/applications/ui/controls";
import { ago } from "@/modules/communications/ui/labels";
import { Section } from "@/modules/communications/ui/panels";
import { nodeSpec } from "@/modules/workflows/catalog";
import { getWorkflow } from "@/modules/workflows/workflow.service";
import { AppError } from "@/server/errors";
import { requireActorOrRedirect } from "@/server/session";

export const metadata: Metadata = { title: "Workflow · JOBHUNT OS" };
export const dynamic = "force-dynamic";

export default async function WorkflowPage({ params, searchParams }: PageProps<"/workflows/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();
  let data;
  try {
    data = await getWorkflow(actor, id);
  } catch (error) {
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  const { workflow, versions, draft, draftReport } = data;
  const archived = workflow.status === "ARCHIVED";
  const hidden = { workflowId: workflow.id };
  const errors = draftReport.issues.filter((i) => i.severity === "ERROR");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Workflow"
        title={workflow.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={workflow.status === "ACTIVE" ? "success" : "neutral"}>
              {workflow.status.toLowerCase()}
            </Badge>
            <span>
              {workflow.activeVersionId
                ? `active: v${versions.find((v) => v.id === workflow.activeVersionId)?.versionNumber ?? "?"}`
                : "no active version"}
            </span>
            <span className="text-fg-subtle">
              · draft saved {ago(workflow.draftSavedAt)} · revision {workflow.draftRevision}
            </span>
          </span>
        }
        actions={
          <>
            <a
              href={`/api/v1/workflows/${workflow.id}/export`}
              className={buttonClass("secondary", "sm")}
            >
              Export JSON
            </a>
            <InlineAction action={duplicateWorkflowAction} hidden={hidden}>
              Duplicate
            </InlineAction>
            <InlineAction
              action={archiveWorkflowAction}
              hidden={{ ...hidden, archived: archived ? "0" : "1" }}
            >
              {archived ? "Restore" : "Archive"}
            </InlineAction>
            <Link href="/workflows" className={buttonClass("ghost", "sm")}>
              All workflows
            </Link>
          </>
        }
      />
      {typeof sp.removed === "string" && (
        <Alert tone="warning" title="Imported — some nodes were removed">
          Unknown node types were dropped (with their connections): {sp.removed}. Review the
          workflow before saving a version.
        </Alert>
      )}
      {archived && (
        <Alert tone="info" title="Archived">
          This workflow and its history are kept. Restore it to edit or run it.
        </Alert>
      )}
      <Alert tone="info" title="Canvas coming in checkpoint 2">
        This page manages the saved definition, versions and validation. The visual editor (drag,
        connect, configure) is the next checkpoint.
      </Alert>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Section
            title={`Validation — ${draftReport.valid ? "workflow is valid" : `${errors.length} problem(s)`}`}
          >
            <ul className="flex flex-col gap-1 text-xs">
              {draftReport.checks.map((c) => (
                <li key={c.key} className="flex gap-2">
                  <span className={c.passed ? "text-success" : "text-danger"}>
                    {c.passed ? "✓" : "✕"}
                  </span>
                  <span className="text-fg">{c.label}</span>
                </li>
              ))}
            </ul>
            {draftReport.issues.length > 0 && (
              <ul className="border-border mt-2 flex flex-col gap-1 border-t pt-2 text-xs">
                {draftReport.issues.map((i, n) => (
                  <li key={n} className={i.severity === "ERROR" ? "text-danger" : "text-warning"}>
                    {i.severity === "ERROR" ? "✕" : "!"} {i.message}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Draft — ${draft.nodes.length} node(s), ${draft.edges.length} connection(s)`}
          >
            {draft.nodes.length === 0 ? (
              <p className="text-fg-muted text-xs">
                Empty. Nodes are added on the canvas (checkpoint 2).
              </p>
            ) : (
              <ul className="flex flex-col gap-1 text-xs">
                {draft.nodes.map((node) => {
                  const spec = nodeSpec(node.type);
                  return (
                    <li key={node.id} className="flex flex-wrap gap-2">
                      <span className="text-fg font-medium">{node.name}</span>
                      <Badge>{spec?.label ?? node.type}</Badge>
                      <span className="text-fg-subtle">
                        {node.type}@{node.typeVersion}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-fg-subtle text-[11px]">
              Limits per run: {draft.settings.maxNodeExecutions} node executions ·{" "}
              {draft.settings.timeoutMinutes} min · {draft.settings.maxApplicationsPerRun}{" "}
              applications ·{" "}
              {draft.settings.errorPolicy === "FAIL_FAST" ? "fail fast" : "continue on error"}
            </p>
          </Section>

          <Section title="Versions">
            {versions.length === 0 ? (
              <p className="text-fg-muted text-xs">
                No saved versions yet. Runs always use a saved, valid version — never the live
                draft.
              </p>
            ) : (
              <ul className="divide-border flex flex-col divide-y text-xs">
                {versions.map((v) => (
                  <li
                    key={v.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-fg font-medium">v{v.versionNumber}</span>
                      <Badge tone={v.validationStatus === "VALID" ? "success" : "danger"}>
                        {v.validationStatus.toLowerCase()}
                      </Badge>
                      {v.id === workflow.activeVersionId && <Badge tone="accent">active</Badge>}
                      <span className="text-fg-subtle">
                        {ago(v.createdAt)} · {v.definitionHash.slice(0, 10)}
                        {v.note ? ` · ${v.note}` : ""}
                      </span>
                    </span>
                    <span className="flex gap-1">
                      <a
                        className={buttonClass("ghost", "sm")}
                        href={`/api/v1/workflows/${workflow.id}/export?version=${v.id}`}
                      >
                        JSON
                      </a>
                      {!archived &&
                        v.validationStatus === "VALID" &&
                        v.id !== workflow.activeVersionId && (
                          <InlineAction
                            action={activateWorkflowAction}
                            hidden={{ ...hidden, versionId: v.id }}
                          >
                            Activate
                          </InlineAction>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <aside className="flex flex-col gap-4">
          {!archived && (
            <Section title="Save a version">
              <ActionBox
                action={saveVersionAction}
                hidden={hidden}
                submitLabel="Save version"
                variant="primary"
              >
                <input
                  name="note"
                  maxLength={500}
                  placeholder="What changed (optional)"
                  aria-label="Version note"
                  className={inputClass}
                />
                <p className="text-fg-subtle text-[11px]">
                  Freezes the current draft. Versions never change; runs pin the version they
                  started with.
                </p>
              </ActionBox>
              {workflow.status === "ACTIVE" && (
                <InlineAction action={deactivateWorkflowAction} hidden={hidden}>
                  Deactivate
                </InlineAction>
              )}
            </Section>
          )}
          {!archived && (
            <Section title="Details">
              <ActionBox
                action={updateWorkflowMetaAction}
                hidden={hidden}
                submitLabel="Save details"
              >
                <input
                  name="name"
                  defaultValue={workflow.name}
                  required
                  maxLength={120}
                  aria-label="Name"
                  className={inputClass}
                />
                <textarea
                  name="description"
                  defaultValue={workflow.description ?? ""}
                  rows={3}
                  maxLength={2000}
                  aria-label="Description"
                  className={inputClass}
                />
                <input
                  name="tags"
                  defaultValue={workflow.tags.join(", ")}
                  aria-label="Tags"
                  className={inputClass}
                />
              </ActionBox>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
