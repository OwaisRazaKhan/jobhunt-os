import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultConfig } from "@/modules/workflows/catalog";
import { emptyDefinition, type WorkflowDefinition } from "@/modules/workflows/definition";
import {
  activateWorkflow,
  archiveWorkflow,
  createWorkflow,
  duplicateWorkflow,
  exportWorkflow,
  getWorkflow,
  importWorkflow,
  listWorkflows,
  saveDraft,
  saveVersion,
} from "@/modules/workflows/workflow.service";
import { withUserContext } from "@/server/db";
import { createTestUser, startTestDb, type TestDb } from "../support/test-db";

let db: TestDb;
let a: { userId: string };
let b: { userId: string };
const PROFILE = "01a0db28-1998-71bc-b0c5-fa69eb240b59";

const n = (id: string, type: string, config: Record<string, unknown> = {}) => ({
  id,
  type,
  typeVersion: 1,
  name: id,
  position: { x: 0, y: 0 },
  config: { ...defaultConfig(type), ...config },
  onError: "FAIL" as const,
});
const valid = (): WorkflowDefinition => ({
  ...emptyDefinition(),
  nodes: [
    n("p", "SEARCH_PROFILE", { searchProfileId: PROFILE }),
    n("s", "JOB_SEARCH"),
    n("l", "LOG"),
  ],
  edges: [
    { id: "e1", source: "p", sourcePort: "profile", target: "s", targetPort: "profile" },
    { id: "e2", source: "s", sourcePort: "jobs", target: "l", targetPort: "input" },
  ],
});

beforeAll(async () => {
  db = await startTestDb();
  a = await createTestUser(db.prisma, "Workflow A");
  b = await createTestUser(db.prisma, "Workflow B");
});
afterAll(async () => db.stop());

describe("workflow definitions", () => {
  it("create → autosave draft with optimistic lock → second tab conflict", async () => {
    const w = await createWorkflow(a, { name: "India remote jobs", tags: "Remote, india, remote" });
    expect(w).toMatchObject({ status: "DRAFT", draftRevision: 1, tags: ["remote", "india"] });
    const saved = await saveDraft(a, w.id, { definition: valid(), expectedRevision: 1 });
    expect(saved.revision).toBe(2);
    expect(saved.report.valid).toBe(true);
    // A stale tab (still at revision 1) can't overwrite the newer draft.
    await expect(
      saveDraft(a, w.id, { definition: emptyDefinition(), expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Structurally broken JSON is refused; a semantically invalid draft is saved with its report.
    await expect(
      saveDraft(a, w.id, { definition: { nodes: "x" }, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const invalid = await saveDraft(a, w.id, {
      definition: emptyDefinition(),
      expectedRevision: 2,
    });
    expect(invalid.report.valid).toBe(false);
  });

  it("versions are immutable snapshots; only valid versions can be activated", async () => {
    const w = await createWorkflow(a, { name: "Versioned" });
    // v1: invalid (empty) → saved, but can't be activated.
    const v1 = await saveVersion(a, w.id);
    expect(v1.version).toMatchObject({ versionNumber: 1, validationStatus: "INVALID" });
    await expect(activateWorkflow(a, w.id)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    // The database refuses an invalid active version even on a direct write.
    await expect(
      withUserContext(a.userId, (t) =>
        t.workflow.update({
          where: { id: w.id },
          data: { status: "ACTIVE", activeVersionId: v1.version.id, activatedAt: new Date() },
        }),
      ),
    ).rejects.toThrow();

    await saveDraft(a, w.id, { definition: valid(), expectedRevision: 1 });
    const v2 = await saveVersion(a, w.id, { note: "first valid" });
    expect(v2.version).toMatchObject({ versionNumber: 2, validationStatus: "VALID" });
    expect((await saveVersion(a, w.id)).created).toBe(false); // unchanged draft → same version
    const act = await activateWorkflow(a, w.id);
    expect(act.workflow).toMatchObject({ status: "ACTIVE", activeVersionId: v2.version.id });

    // Editing the draft does not change the active version (executions pin versions).
    const ws = await getWorkflow(a, w.id);
    await saveDraft(a, w.id, {
      definition: {
        ...valid(),
        nodes: valid().nodes.map((x) => (x.id === "l" ? { ...x, name: "renamed" } : x)),
      },
      expectedRevision: ws.workflow.draftRevision,
    });
    const after = await getWorkflow(a, w.id);
    expect(after.workflow.activeVersionId).toBe(v2.version.id);

    // Versions can't be modified or deleted.
    await expect(
      withUserContext(a.userId, (t) =>
        t.workflowVersion.update({ where: { id: v2.version.id }, data: { note: "tampered" } }),
      ),
    ).rejects.toThrow();
    await expect(
      withUserContext(a.userId, (t) => t.workflowVersion.delete({ where: { id: v2.version.id } })),
    ).rejects.toThrow();
  });

  it("archive keeps versions; restore; duplicate creates an independent workflow", async () => {
    const w = await createWorkflow(a, { name: "Archivable" }, { definition: valid() });
    await saveVersion(a, w.id);
    await archiveWorkflow(a, w.id, true);
    expect((await listWorkflows(a)).some((x) => x.id === w.id)).toBe(false);
    expect((await listWorkflows(a, { status: "ARCHIVED" })).some((x) => x.id === w.id)).toBe(true);
    await expect(
      saveDraft(a, w.id, { definition: valid(), expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await getWorkflow(a, w.id)).versions).toHaveLength(1);
    await archiveWorkflow(a, w.id, false);

    const copy = await duplicateWorkflow(a, w.id);
    expect(copy).toMatchObject({
      name: "Copy of Archivable",
      origin: "DUPLICATE",
      latestVersion: 0,
    });
    expect(copy.id).not.toBe(w.id);
    expect((await listWorkflows(a, { q: "archivable" })).length).toBe(2);
  });

  it("export strips private references; import treats JSON as untrusted and never activates", async () => {
    const w = await createWorkflow(a, { name: "Exportable" }, { definition: valid() });
    const exported = await exportWorkflow(a, w.id);
    expect(JSON.stringify(exported)).not.toContain(PROFILE);

    const hostile = {
      ...exported,
      definition: {
        ...exported.definition,
        nodes: [
          ...exported.definition.nodes,
          {
            id: "x",
            type: "RUN_SHELL",
            typeVersion: 1,
            name: "rm -rf",
            position: { x: 0, y: 0 },
            config: { cmd: "rm -rf /" },
          },
        ],
        edges: [
          ...exported.definition.edges,
          { id: "ex", source: "l", sourcePort: "output", target: "x", targetPort: "input" },
        ],
      },
    };
    const imported = await importWorkflow(b, JSON.stringify(hostile));
    expect(imported.removed).toEqual(["rm -rf"]);
    expect(imported.workflow).toMatchObject({
      status: "DRAFT",
      origin: "IMPORT",
      userId: b.userId,
    });
    const ws = await getWorkflow(b, imported.workflow.id);
    expect(ws.draft.nodes.map((x) => x.type)).not.toContain("RUN_SHELL");
    expect(ws.draftReport.valid).toBe(false); // the search profile reference was stripped → needs the user's choice
    await expect(importWorkflow(b, "{not json")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(importWorkflow(b, JSON.stringify({ format: "n8n" }))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("cross-user access is denied (service + RLS)", async () => {
    const w = await createWorkflow(a, { name: "Private" }, { definition: valid() });
    const { version } = await saveVersion(a, w.id);
    await expect(getWorkflow(b, w.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      saveDraft(b, w.id, { definition: valid(), expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(activateWorkflow(b, w.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(exportWorkflow(b, w.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const seen = await withUserContext(b.userId, async (t) => [
      await t.workflow.count({ where: { id: w.id } }),
      await t.workflowVersion.count({ where: { id: version.id } }),
    ]);
    expect(seen).toEqual([0, 0]);
    // B can't attach a version to A's workflow even by forging ids.
    await expect(
      withUserContext(b.userId, (t) =>
        t.workflowVersion.create({
          data: {
            userId: b.userId,
            workflowId: w.id,
            versionNumber: 9,
            definition: {},
            definitionHash: "a".repeat(64),
            schemaVersion: 1,
            nodeVersions: {},
            validationStatus: "VALID",
            validation: {},
          },
        }),
      ),
    ).rejects.toThrow();
  });
});
