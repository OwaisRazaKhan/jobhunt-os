# Workflow Engine (Phase 9)

Visual automations over the real JOBHUNT OS capabilities. The **canvas is only an interface**: a
workflow is a persisted, versioned definition; the **execution engine** (server + worker) is the
source of truth; **node definitions** are the bridge to the existing domain services (Phases 2–8).
Nothing is simulated — no fake statuses, counts or progress.

Code: `src/modules/workflows/` · Routes: `/workflows`, `/workflows/[id]` · Export API:
`GET /api/v1/workflows/[id]/export[?version=…]` · Migration: `20261101000000_phase9_workflows`.

Design references: `docs/domain-architecture.md` §7 (definition + engine), `docs/database-schema.md` §3.13.

## 1. Build status

| Checkpoint | Scope                                                                                                 | State |
| ---------- | ----------------------------------------------------------------------------------------------------- | ----- |
| 1          | Data model, RLS, definition schema, node catalog, graph validation, list/detail UI                    | Done  |
| 2          | Canvas (React Flow): palette, nodes, connections, configuration, save/load                            | Next  |
| 3          | Executable nodes: candidate, search profile, job search, filter, dedupe, eligibility, match, research | —     |
| 4          | Content nodes: tailor resume, cover letter, write email, communication package                        | —     |
| 5          | Application + human approval nodes (Phase 8 reused)                                                   | —     |
| 6          | Control nodes: condition, IF, merge, wait, stop, log                                                  | —     |
| 7          | Execution engine: runs, node runs, dependencies, retries, timeouts, events                            | —     |
| 8          | Live controls: start / pause / resume / stop, live node states, logs                                  | —     |
| 9          | Approval + safety: exact-content approval hashes, stale detection, safety gates                       | —     |
| 10         | Execution history, node detail, rerun, retry-from-node, recovery                                      | —     |
| 11         | Templates (job discovery, application preparation, full assisted application)                         | —     |
| 12         | Final integration with real data                                                                      | —     |

## 2. Workflow model

- **`workflows`** (owner-only RLS; grants S I U — never deleted by the app, archive instead):
  name, description, tags, status `DRAFT | ACTIVE | ARCHIVED`, `draft_definition` (autosaved editor
  state), `draft_revision` (optimistic lock), `latest_version`, `active_version_id`, `activated_at`,
  `archived_at`, `origin` (`BLANK | TEMPLATE | DUPLICATE | IMPORT`).
- **`workflow_versions`** (immutable; grants S I): `version_number`, frozen `definition`,
  `definition_hash` (SHA-256 of canonical JSON), `schema_version`, `node_versions`
  (`{ nodeType: typeVersion }`), `validation_status` `VALID | INVALID`, `validation` report, note.

Database rules: versions can never be updated or deleted (trigger + grants); a version must belong
to the workflow owner; the active version must be a **VALID** version of the same workflow (trigger);
an ACTIVE workflow always has an active version; an ARCHIVED one has an archive time; owner can't change.

Lifecycle: create → edit the draft (autosave with `expectedRevision`; a stale tab gets `CONFLICT`
instead of silently overwriting) → **Save version** freezes the draft (valid or not; unchanged drafts
reuse the latest version) → **Activate** only a VALID version, re-validated against today's node
catalog → deactivate / archive / restore. Runs (checkpoint 7) always pin a saved version — never the
live draft — so editing never changes a running execution. Activation history: `activated_at` +
audit (`workflow_activated`, with the version).

## 3. Definition (`definition.ts`)

```ts
{
  schemaVersion: 1,
  trigger: { type: "MANUAL" },               // scheduled/event triggers are later phases
  nodes: [{ id, type, typeVersion, name, position: {x, y}, config, retry?, timeoutMs?, onError }],
  edges: [{ id, source, sourcePort, target, targetPort }],
  settings: { errorPolicy, maxNodeExecutions, timeoutMinutes, maxApplicationsPerRun }
}
```

Strict Zod schemas (unknown keys rejected); at most 60 nodes / 150 edges. There is no field for code,
SQL, shell commands, URLs or secrets. Defaults for run limits: 100 node executions, 120 minutes,
3 applications per run, fail-fast.

## 4. Node catalog (`catalog.ts`)

Each node type declares: `type`, `version`, group, typed input/output **ports**, a strict **config
schema**, its **side effect** (`NONE` / `INTERNAL` writes JOBHUNT records / `EXTERNAL` acts outside
JOBHUNT OS) and its **retry safety** (`SAFE_TO_RETRY` / `IDEMPOTENT` / `NOT_SAFE_TO_RETRY`).
Port kinds: `CANDIDATE`, `SEARCH_PROFILE`, `JOB_LIST`, `RESUME_LIST`, `COMMUNICATION_LIST`,
`PACKAGE_LIST`, `APPLICATION_LIST`, `ERROR`, `ANY` (control/utility nodes pass input through; the
runtime re-checks payloads). Error outputs connect only to `ANY` inputs (e.g. Log → Stop).

| Group       | Nodes (all v1)                                                       |
| ----------- | -------------------------------------------------------------------- |
| Input       | Candidate, Search profile                                            |
| Discovery   | Job search, Filter, Deduplicate                                      |
| Analysis    | Eligibility, Match, Research                                         |
| Content     | Tailor resume, Cover letter, Write email, Communication package      |
| Application | Application (`PREPARE` internal / `SUBMIT` external), Human approval |
| Control     | Condition (per-item split), IF (whole input), Merge, Wait, Stop      |
| Utility     | Log                                                                  |

Checkpoint 1 describes the catalog; **executors are registered per checkpoint (3–6)** against the
existing services (`runMatchingNode`, `runResearchNode`, `tailorResumeToJob`, `writeCommunication`,
package and application services). A node type without an executor can't be run.

Conditions are **structured rules** over a fixed field list (`job.remoteStatus`, `job.countryCode`,
`match.status`, `items.count`, …) with fixed operators — never free-form expressions.

## 5. Validation (`validate.ts`)

Runs on draft save, version save, activation, and again by the engine before each run. Checks:
start node exists · node types + versions known · unique ids · connections reference real nodes and
ports · port kinds compatible · one connection per input (use Merge) · required inputs connected ·
config valid · no loops (DAG only) · every node reachable from a start · **every EXTERNAL node has a
Human approval on every path, via its "Approved" output** · non-retryable nodes have no retry policy
· Stop has no outgoing connections · application limit > 0 when submitting.

## 6. Export / import

Export (JSON, `format: "jobhunt-workflow"`) removes references to private records (e.g. the search
profile id). Import treats the file as untrusted: size limit, envelope check, unknown node types and
their connections are removed and reported, the rest must pass the schema, and the result is a new
**DRAFT** that never runs automatically.

## 7. Security

Owner-only RLS on both tables and server-side ownership checks in every service; versions immutable;
audit events: `workflow_created / edited / version_saved / activated / deactivated / archived /
restored / duplicated / exported / imported` (no definition contents in audit metadata).

## 8. Tests

`src/modules/workflows/workflows.unit.test.ts` (catalog, strict configs, port compatibility, valid
discovery graph, no start, missing input/config, type mismatch, unknown types/ports/versions, loops,
double input, approval-before-submit incl. the "Rejected" path, retry safety, malformed JSON, stable
hashing) · `tests/integration/workflows.test.ts` (draft optimistic lock + conflict, version
immutability and DB-enforced valid activation, active version pinned while editing, archive/restore,
duplicate, export stripping private ids, hostile import, cross-user denial incl. forged version).
