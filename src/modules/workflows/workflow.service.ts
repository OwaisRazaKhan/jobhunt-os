import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { recordAudit } from "@/server/audit";
import { withUserContext, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { nodeSpec } from "./catalog";
import {
  DEFINITION_SCHEMA_VERSION,
  emptyDefinition,
  workflowDefinition,
  type WorkflowDefinition,
} from "./definition";
import { definitionHash } from "./hash";
import { validateDefinition, type ValidationReport } from "./validate";

/**
 * Workflow definitions (Phase 9, checkpoint 1): create, autosave drafts (optimistic lock),
 * freeze immutable versions, activate only valid versions, archive/restore, duplicate, export and
 * import. Everything is owner-scoped (RLS + explicit user filters). Nothing here executes a node.
 */

export type ActorRef = { userId: string };

export const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

const tagsInput = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(",")))
  .transform((v) => [...new Set(v.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 12))
  .pipe(z.array(z.string().max(30, "Tags are at most 30 characters")));

export const workflowMetaInput = z.object({
  name: z.string().trim().min(1, "Give the workflow a name").max(120),
  description: z.string().trim().max(2000).nullish(),
  tags: tagsInput.default([]),
});

async function owned(t: Tx, actor: ActorRef, id: string) {
  const w = await t.workflow.findFirst({ where: { id, userId: actor.userId } });
  if (!w) throw new AppError("NOT_FOUND");
  return w;
}

function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Parses a definition's structure (throws a user-facing error); semantics come from validate. */
export function parseDefinition(raw: unknown): WorkflowDefinition {
  const parsed = workflowDefinition.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: `The workflow definition is invalid: ${first?.path.join(".") || "definition"} — ${first?.message ?? "invalid"}`,
    });
  }
  return parsed.data;
}

// --- Reads ----------------------------------------------------------------------------------------

export async function listWorkflows(
  actor: ActorRef,
  opts: { q?: string | null; status?: WorkflowStatus | "ALL" } = {},
) {
  const q = opts.q?.trim();
  return withUserContext(actor.userId, (t) =>
    t.workflow.findMany({
      where: {
        userId: actor.userId,
        ...(opts.status && opts.status !== "ALL"
          ? { status: opts.status }
          : { status: { not: "ARCHIVED" } }),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
                { tags: { has: q.toLowerCase() } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        tags: true,
        status: true,
        latestVersion: true,
        updatedAt: true,
        draftSavedAt: true,
        activeVersion: { select: { versionNumber: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
  );
}

export async function getWorkflow(actor: ActorRef, id: string) {
  const w = await withUserContext(actor.userId, async (t) => {
    const workflow = await owned(t, actor, id);
    const versions = await t.workflowVersion.findMany({
      where: { workflowId: workflow.id },
      select: {
        id: true,
        versionNumber: true,
        definitionHash: true,
        validationStatus: true,
        note: true,
        createdAt: true,
        nodeVersions: true,
      },
      orderBy: { versionNumber: "desc" },
      take: 50,
    });
    return { workflow, versions };
  });
  // Stored JSON is validated on every load.
  const report = validateDefinition(w.workflow.draftDefinition);
  const draft = workflowDefinition.safeParse(w.workflow.draftDefinition);
  return { ...w, draft: draft.success ? draft.data : emptyDefinition(), draftReport: report };
}

export async function getVersion(actor: ActorRef, workflowId: string, versionId: string) {
  return withUserContext(actor.userId, async (t) => {
    const v = await t.workflowVersion.findFirst({
      where: { id: versionId, workflowId, userId: actor.userId },
    });
    if (!v) throw new AppError("NOT_FOUND");
    return v;
  });
}

// --- Writes ----------------------------------------------------------------------------------------

export async function createWorkflow(
  actor: ActorRef,
  raw: unknown,
  opts: { definition?: unknown; origin?: "BLANK" | "TEMPLATE" | "DUPLICATE" | "IMPORT" } = {},
) {
  const meta = workflowMetaInput.parse(raw);
  const definition =
    opts.definition === undefined ? emptyDefinition() : parseDefinition(opts.definition);
  return withUserContext(actor.userId, async (t) => {
    const w = await t.workflow.create({
      data: {
        userId: actor.userId,
        name: meta.name,
        description: meta.description ?? null,
        tags: meta.tags,
        draftDefinition: asJson(definition),
        origin: opts.origin ?? "BLANK",
      },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "workflow_created",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: { origin: w.origin, nodes: definition.nodes.length },
    });
    return w;
  });
}

export async function updateWorkflowMeta(actor: ActorRef, id: string, raw: unknown) {
  const meta = workflowMetaInput.parse(raw);
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (w.status === "ARCHIVED")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Restore the workflow before editing it.",
      });
    const updated = await t.workflow.update({
      where: { id: w.id },
      data: { name: meta.name, description: meta.description ?? null, tags: meta.tags },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "workflow_edited",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: { fields: ["name", "description", "tags"] },
    });
    return updated;
  });
}

/**
 * Autosaves the editor draft. `expectedRevision` prevents a second tab from silently overwriting
 * newer work (CONFLICT). The draft may be semantically invalid; the report says why.
 */
export async function saveDraft(
  actor: ActorRef,
  id: string,
  input: { definition: unknown; expectedRevision: number },
): Promise<{ revision: number; report: ValidationReport; savedAt: Date }> {
  const definition = parseDefinition(input.definition);
  const report = validateDefinition(definition);
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (w.status === "ARCHIVED")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Restore the workflow before editing it.",
      });
    const savedAt = new Date();
    const { count } = await t.workflow.updateMany({
      where: { id: w.id, userId: actor.userId, draftRevision: input.expectedRevision },
      data: {
        draftDefinition: asJson(definition),
        draftRevision: { increment: 1 },
        draftSavedAt: savedAt,
      },
    });
    if (!count)
      throw new AppError("CONFLICT", {
        publicMessage:
          "This workflow was changed in another tab or window. Reload to get the latest version before saving.",
      });
    return { revision: input.expectedRevision + 1, report, savedAt };
  });
}

/** Freezes the current draft into the next immutable version (valid or not — only VALID can run). */
export async function saveVersion(
  actor: ActorRef,
  id: string,
  input: { note?: string | null; expectedRevision?: number } = {},
) {
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (w.status === "ARCHIVED")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Restore the workflow before saving a version.",
      });
    if (input.expectedRevision !== undefined && input.expectedRevision !== w.draftRevision)
      throw new AppError("CONFLICT", {
        publicMessage:
          "The draft changed since you last loaded it. Reload before saving a version.",
      });
    const definition = parseDefinition(w.draftDefinition);
    const report = validateDefinition(definition);
    const hash = definitionHash(definition);
    const latest = await t.workflowVersion.findFirst({
      where: { workflowId: w.id },
      orderBy: { versionNumber: "desc" },
    });
    if (latest && latest.definitionHash === hash)
      return { version: latest, created: false, report };
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const version = await t.workflowVersion.create({
      data: {
        userId: actor.userId,
        workflowId: w.id,
        versionNumber,
        definition: asJson(definition),
        definitionHash: hash,
        schemaVersion: DEFINITION_SCHEMA_VERSION,
        nodeVersions: asJson(report.nodeVersions),
        validationStatus: report.valid ? "VALID" : "INVALID",
        validation: asJson({
          valid: report.valid,
          checks: report.checks,
          issues: report.issues.slice(0, 50),
        }),
        note: input.note?.trim().slice(0, 500) || null,
      },
    });
    await t.workflow.update({ where: { id: w.id }, data: { latestVersion: versionNumber } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "workflow_version_saved",
      resourceType: "workflow_version",
      resourceId: version.id,
      metadata: { workflowId: w.id, versionNumber, valid: report.valid },
    });
    return { version, created: true, report };
  });
}

/** Activates a version (default: the latest). Re-validated against today's node catalog. */
export async function activateWorkflow(actor: ActorRef, id: string, versionId?: string | null) {
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (w.status === "ARCHIVED")
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Restore the workflow before activating it.",
      });
    const version = versionId
      ? await t.workflowVersion.findFirst({ where: { id: versionId, workflowId: w.id } })
      : await t.workflowVersion.findFirst({
          where: { workflowId: w.id },
          orderBy: { versionNumber: "desc" },
        });
    if (!version)
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: "Save a version first — only saved versions can be activated.",
      });
    const report = validateDefinition(version.definition);
    if (version.validationStatus !== "VALID" || !report.valid) {
      const first = report.issues.find((i) => i.severity === "ERROR");
      throw new AppError("VALIDATION_ERROR", {
        publicMessage: `Version ${version.versionNumber} can't be activated: ${first?.message ?? "it has validation errors."}`,
      });
    }
    const now = new Date();
    const updated = await t.workflow.update({
      where: { id: w.id },
      data: { status: "ACTIVE", activeVersionId: version.id, activatedAt: now },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: "workflow_activated",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
    });
    return { workflow: updated, version };
  });
}

export async function deactivateWorkflow(actor: ActorRef, id: string) {
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (w.status !== "ACTIVE") return w;
    const updated = await t.workflow.update({ where: { id: w.id }, data: { status: "DRAFT" } });
    await recordAudit(t, {
      userId: actor.userId,
      action: "workflow_deactivated",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: {},
    });
    return updated;
  });
}

/** Archiving keeps the workflow, its versions and (later) its executions — nothing is deleted. */
export async function archiveWorkflow(actor: ActorRef, id: string, archived: boolean) {
  return withUserContext(actor.userId, async (t) => {
    const w = await owned(t, actor, id);
    if (archived === (w.status === "ARCHIVED")) return w;
    const updated = await t.workflow.update({
      where: { id: w.id },
      data: archived
        ? { status: "ARCHIVED", archivedAt: new Date() }
        : { status: "DRAFT", archivedAt: null },
    });
    await recordAudit(t, {
      userId: actor.userId,
      action: archived ? "workflow_archived" : "workflow_restored",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: {},
    });
    return updated;
  });
}

/** A new, independent workflow (new identity, version history starts at 0) from the current draft. */
export async function duplicateWorkflow(actor: ActorRef, id: string) {
  const src = await withUserContext(actor.userId, (t) => owned(t, actor, id));
  const created = await createWorkflow(
    actor,
    { name: `Copy of ${src.name}`.slice(0, 120), description: src.description, tags: src.tags },
    { definition: src.draftDefinition, origin: "DUPLICATE" },
  );
  await withUserContext(actor.userId, (t) =>
    recordAudit(t, {
      userId: actor.userId,
      action: "workflow_duplicated",
      resourceType: "workflow",
      resourceId: created.id,
      metadata: { from: src.id },
    }),
  );
  return created;
}

// --- Export / import --------------------------------------------------------------------------------

export const EXPORT_FORMAT = "jobhunt-workflow";
/** Config keys that reference the owner's private records; removed on export. */
const PRIVATE_REFS = ["searchProfileId"];

export async function exportWorkflow(actor: ActorRef, id: string, versionId?: string | null) {
  const w = await withUserContext(actor.userId, (t) => owned(t, actor, id));
  const raw = versionId ? (await getVersion(actor, id, versionId)).definition : w.draftDefinition;
  const def = parseDefinition(raw);
  const clean: WorkflowDefinition = {
    ...def,
    nodes: def.nodes.map((n) => ({
      ...n,
      config: Object.fromEntries(
        Object.entries(n.config).filter(([k]) => !PRIVATE_REFS.includes(k)),
      ),
    })),
  };
  await withUserContext(actor.userId, (t) =>
    recordAudit(t, {
      userId: actor.userId,
      action: "workflow_exported",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: { versionId: versionId ?? null },
    }),
  );
  return {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    name: w.name,
    description: w.description,
    tags: w.tags,
    definition: clean,
  };
}

const importEnvelope = z.object({
  format: z.literal(EXPORT_FORMAT),
  formatVersion: z.literal(1),
  name: z.string().max(200),
  description: z.string().max(4000).nullish(),
  tags: z.array(z.string()).max(50).default([]),
  definition: z
    .object({ nodes: z.array(z.unknown()).max(200), edges: z.array(z.unknown()).max(500) })
    .passthrough(),
});

/**
 * Imports untrusted JSON as a new DRAFT (never executed). Unknown node types and their connections
 * are removed and reported; everything else must pass the definition schema.
 */
export async function importWorkflow(actor: ActorRef, text: string) {
  if (text.length > 500_000)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "The file is too large (500 KB max).",
    });
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_ERROR", { publicMessage: "That isn't valid JSON." });
  }
  const env = importEnvelope.safeParse(json);
  if (!env.success)
    throw new AppError("VALIDATION_ERROR", {
      publicMessage: "This is not a JOBHUNT OS workflow export.",
    });
  const removed: string[] = [];
  const nodes = (
    env.data.definition.nodes as { id?: unknown; type?: unknown; name?: unknown }[]
  ).filter((n) => {
    const known = typeof n?.type === "string" && nodeSpec(n.type) !== null;
    if (!known) removed.push(String(n?.name ?? n?.type ?? "unknown node").slice(0, 60));
    return known;
  });
  const keep = new Set(nodes.map((n) => String(n.id)));
  const edges = (env.data.definition.edges as { source?: unknown; target?: unknown }[]).filter(
    (e) => keep.has(String(e?.source)) && keep.has(String(e?.target)),
  );
  const definition = parseDefinition({ ...env.data.definition, nodes, edges });
  const w = await createWorkflow(
    actor,
    {
      name: env.data.name.slice(0, 120) || "Imported workflow",
      description: env.data.description?.slice(0, 2000) ?? null,
      tags: env.data.tags,
    },
    { definition, origin: "IMPORT" },
  );
  await withUserContext(actor.userId, (t) =>
    recordAudit(t, {
      userId: actor.userId,
      action: "workflow_imported",
      resourceType: "workflow",
      resourceId: w.id,
      metadata: { nodes: nodes.length, removed: removed.length },
    }),
  );
  return { workflow: w, removed };
}
