# Domain Architecture

Behavioural rules for the core domains. Table definitions are in [database-schema.md](./database-schema.md).

---

## 1. Candidate knowledge

The candidate knowledge base is the **only** source of truth the AI may draw on when writing about the candidate. Anything not in it cannot appear in a generated document.

### 1.1 Model

```
CandidateProfile (1 per user)
 ├── Experience ──< Achievement          (achievements are citable atoms)
 ├── Project ─────< Achievement
 ├── Education
 ├── Skill ──> Skill taxonomy (global)   (with evidence links to experience/projects)
 ├── Certification
 ├── PortfolioLink
 ├── Language (CEFR level)
 ├── WorkAuthorization (per country)
 └── Preferences
       ├── target roles, seniority, employment types
       ├── salary (min, currency, period)
       ├── work mode (onsite/hybrid/remote), relocation
       └── TargetLocation (country, city, priority)
     + career goals, availability, notice period (on the profile)
```

Every fact row carries **provenance** (`verification_status`, `source_type`, source file / AI generation, verbatim excerpt, confidence, timestamps).

### 1.2 Verification states

| State           | Meaning                                                    | Usable by AI writers?                                                                  |
| --------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `VERIFIED`      | The user explicitly confirmed this exact fact.             | Yes                                                                                    |
| `USER_PROVIDED` | The user typed it; not separately confirmed.               | Yes (the user asserted it)                                                             |
| `NEEDS_REVIEW`  | Extracted from a CV or conflicting with another fact.      | No — shown to the user as a review task                                                |
| `AI_INFERRED`   | AI derived it (e.g. "likely knows Docker" from a project). | **Never** stated as fact; may only drive suggestions like "Add Docker to your skills?" |

Allowed transitions (all user-initiated except creation):

```
(create by AI extraction) → NEEDS_REVIEW ──user confirms──▶ VERIFIED
(create by AI inference)  → AI_INFERRED  ──user accepts───▶ USER_PROVIDED ──user verifies──▶ VERIFIED
(create by user)          → USER_PROVIDED ──user verifies──▶ VERIFIED
any state ──user edits content──▶ USER_PROVIDED  (edits reset verification)
any state ──user rejects──▶ soft-deleted
```

**Invariant:** no code path other than the user-triggered `candidate.verifyFact` / `candidate.acceptSuggestion` use cases may change a fact's status upward. AI agents have no write permission to `verification_status`. Every change is audited.

### 1.3 CV ingestion (Phase 1)

`Upload (files) → text extraction → Candidate Agent extracts structured facts (Zod schema) → facts saved as NEEDS_REVIEW with excerpt + confidence → review queue UI → user confirms/edits/rejects`. Duplicate detection merges facts that already exist rather than creating copies.

---

## 2. International jobs

- Markets are rows in `countries` (`is_enabled`). Initial seed: DE, NL, FR, IE, SE, DK, FI, BE, AT, PT, ES, PL, CZ, EE, US, CA, AE, QA, SA. Adding a market = inserting a row + (optionally) eligibility rules and sources. **No country list in code.**
- A job has one or more `job_locations` (country, city) plus `remote_status` (`REMOTE_COUNTRY` = remote but restricted to a country).
- Salaries are stored as published (min/max/currency/period) and normalised to an annual figure in a base currency with the FX date used, so a EUR monthly salary and an AED annual salary can be compared. Missing salary stays `null` — never estimated silently. Estimates, if added, are a separate, labelled field.
- Language requirements are structured (`language_code`, CEFR level, required/preferred) because they are a frequent hard gate in EU markets.
- Every extracted requirement keeps the verbatim text it came from.

---

## 3. Eligibility engine (Phase 4)

**Purpose:** surface _signals_ about whether the candidate can legally work in the job's location. It is **not** immigration advice and must say so in the UI.

### 3.1 Inputs

- Job: location(s), remote status, sponsorship text, work authorization text, salary, degree, language requirements.
- Candidate: work authorizations, citizenship-derived rights (e.g. EU/EEA mobility — captured as an authorization row, not inferred), education level/recognition, experience years, languages, current location.
- `eligibility_rules` for the job's country: versioned, sourced, dated.

### 3.2 Sponsorship classification (from job text + company signals)

| Signal                            | Assigned when                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `SPONSORSHIP_EXPLICIT`            | Posting explicitly offers visa sponsorship / relocation with visa support.    |
| `SPONSORSHIP_POSSIBLE`            | Indirect evidence (e.g. company historically sponsors; "relocation support"). |
| `SPONSORSHIP_UNKNOWN`             | Posting is silent.                                                            |
| `NO_SPONSORSHIP`                  | Posting explicitly says no sponsorship.                                       |
| `EXISTING_AUTHORIZATION_REQUIRED` | "Must have the right to work in X" / "EU citizens only" or equivalent.        |
| `NEEDS_VERIFICATION`              | Conflicting signals, or an AI classification below confidence threshold.      |

Rule-based keyword detection runs first; AI classifies only ambiguous text and always cites the sentence it relied on.

### 3.3 Evaluation

For each factor (country authorization, sponsorship, degree, experience, language, salary thresholds from rules, location) the engine outputs `{ factor, result: PASS | FAIL | UNKNOWN | NEEDS_VERIFICATION, evidence, rule_id?, rule_version? }`. The overall status is the most conservative factor result. Assessments store the rule ids + versions used, so a result can always be explained and re-computed when rules change.

### 3.4 Changing external information

- Rules are data with `source_url`, `last_verified_at`, `rule_version`, `effective_from/to`.
- A rule older than the staleness policy (default 90 days) becomes `STALE`; results using stale rules are downgraded to `NEEDS_VERIFICATION` and the UI shows "last verified on …" with the official link.
- Rule updates create a new version; affected assessments are recomputed by a background job.
- No rule text is hard-coded in application logic; code evaluates parameters (e.g. `salary >= parameters.threshold`), content lives in the table.

---

## 4. Matching engine (Phase 4)

**No single opaque score.** A match is a set of dimensions, each with a status and evidence.

| Dimension     | Method                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------- |
| Skills        | Taxonomy match (exact/alias) → embedding similarity for near matches → AI only for ambiguous cases |
| Experience    | Years + seniority + relevant-role overlap from experience rows                                     |
| Education     | Degree level/field vs requirement; recognition status                                              |
| Portfolio     | Projects/links relevant to required skills                                                         |
| Location      | Target locations, remote status, relocation willingness                                            |
| Salary        | Normalised annual range vs candidate minimum (UNKNOWN if job salary missing)                       |
| Language      | CEFR levels vs requirements                                                                        |
| Authorization | Taken from the eligibility assessment                                                              |
| Career goals  | Target roles/industries vs job (AI-assisted, low weight)                                           |

Each dimension produces `status ∈ {MATCH, PARTIAL, GAP, UNKNOWN, NEEDS_VERIFICATION}` and evidence:

```json
{
  "matches": [{ "requirement_id": "…", "candidate_fact_ids": ["…"], "note": "5y TypeScript" }],
  "gaps": [{ "requirement_id": "…", "importance": "REQUIRED", "note": "No Kubernetes evidence" }],
  "unknowns": [{ "requirement_id": "…", "note": "Salary not published" }],
  "needs_verification": [{ "candidate_fact_id": "…", "note": "Skill is AI_INFERRED" }]
}
```

The UI groups results as **MATCHES / GAPS / UNKNOWN / REQUIRES VERIFICATION**. A `summary_score` (weighted by the user's `match_weights`) exists only to sort lists; any REQUIRED gap on a hard gate (authorization, mandatory language) sets `summary_label = BLOCKED` regardless of score. Only `VERIFIED`/`USER_PROVIDED` facts count as matches; `AI_INFERRED` facts appear under "requires verification". Matches are recomputed when the candidate snapshot hash or job content hash changes.

---

## 5. Documents (Phases 6–7)

- **Logical document** (`documents`) + **immutable versions** (`document_versions`).
- Types: `MASTER_RESUME`, `JOB_RESUME`, `COVER_LETTER`, `RECRUITER_EMAIL`, `APPLICATION_ANSWERS`.
- Version status lifecycle: `DRAFT → IN_REVIEW → APPROVED → ARCHIVED` (and `IN_REVIEW → DRAFT` on "request changes"). Editing an approved version creates a new DRAFT version; the old approval does not carry over.
- Each version knows: candidate (user), job, company, type, version number, generation source (`MANUAL` / `AI` / `AI_EDITED`), AI generation id, parent version, created/updated timestamps, content hash.
- Content is **structured JSON** (sections, bullet items each with `source_fact_ids`), rendered to PDF/DOCX on export. This keeps every AI-written bullet traceable to candidate facts and allows diffing between versions.
- Before a version can enter `IN_REVIEW`, the Quality Control Agent checks grounding (every claim cites a source), forbidden content (unverified facts, invented numbers), length/format, language, and keyword coverage; its report is stored on the version.

---

## 6. Application lifecycle (Phase 8)

### 6.1 States

| Group    | States                                                    |
| -------- | --------------------------------------------------------- |
| Pipeline | `DISCOVERED`, `QUALIFIED`, `REVIEW`, `PREPARING`, `READY` |
| Gate     | `APPROVAL_REQUIRED`, `APPROVED`                           |
| Sent     | `SUBMITTED` (portal/ATS), `EMAIL_SENT` (applied by email) |
| Waiting  | `FOLLOW_UP_DUE`, `RECRUITER_RESPONSE`                     |
| Process  | `SCREENING`, `INTERVIEW`, `FINAL_ROUND`, `OFFER`          |
| Terminal | `REJECTED`, `WITHDRAWN`, `ARCHIVED`                       |

`EMAIL_SENT` means the application itself was sent by email. Outreach emails sent alongside a portal submission are `messages` + timeline events, **not** a status change.

### 6.2 Valid transitions

| From                 | To                                                                                             |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `DISCOVERED`         | `QUALIFIED`, `ARCHIVED`                                                                        |
| `QUALIFIED`          | `REVIEW`, `ARCHIVED`                                                                           |
| `REVIEW`             | `PREPARING`, `QUALIFIED`, `ARCHIVED`                                                           |
| `PREPARING`          | `READY`, `REVIEW`, `ARCHIVED`                                                                  |
| `READY`              | `APPROVAL_REQUIRED`, `PREPARING`, `ARCHIVED`                                                   |
| `APPROVAL_REQUIRED`  | `APPROVED`, `PREPARING` (changes requested), `ARCHIVED`                                        |
| `APPROVED`           | `SUBMITTED`, `EMAIL_SENT`, `PREPARING` (reopen → approval invalidated), `ARCHIVED`             |
| `SUBMITTED`          | `FOLLOW_UP_DUE`, `RECRUITER_RESPONSE`, `SCREENING`, `INTERVIEW`, `REJECTED`, `WITHDRAWN`       |
| `EMAIL_SENT`         | `FOLLOW_UP_DUE`, `RECRUITER_RESPONSE`, `SCREENING`, `INTERVIEW`, `REJECTED`, `WITHDRAWN`       |
| `FOLLOW_UP_DUE`      | `RECRUITER_RESPONSE`, `SCREENING`, `INTERVIEW`, `REJECTED`, `WITHDRAWN`, `ARCHIVED` (no reply) |
| `RECRUITER_RESPONSE` | `SCREENING`, `INTERVIEW`, `FOLLOW_UP_DUE`, `REJECTED`, `WITHDRAWN`                             |
| `SCREENING`          | `INTERVIEW`, `OFFER`, `REJECTED`, `WITHDRAWN`                                                  |
| `INTERVIEW`          | `FINAL_ROUND`, `OFFER`, `REJECTED`, `WITHDRAWN` (additional rounds = timeline events)          |
| `FINAL_ROUND`        | `OFFER`, `REJECTED`, `WITHDRAWN`                                                               |
| `OFFER`              | `ARCHIVED` (with outcome ACCEPTED/DECLINED), `WITHDRAWN`, `REJECTED` (offer rescinded)         |
| `REJECTED`           | `ARCHIVED`                                                                                     |
| `WITHDRAWN`          | `ARCHIVED`                                                                                     |
| `ARCHIVED`           | restore → `previous_status` only if it was a pipeline state (`DISCOVERED`…`READY`)             |

### 6.3 Enforcement

- The transition table lives in **one** TypeScript module (`src/modules/applications/state-machine.ts`, Phase 8) and is unit-tested exhaustively (every pair of states).
- `applications.transition(id, to, expectedVersion)` validates the transition, applies guards, updates `status` with optimistic locking, and writes an `application_events` row + audit entry in one transaction. Invalid transitions throw `CONFLICT`.
- **Guards:**
  - `→ APPROVAL_REQUIRED` requires resume (and cover letter / answers if the job needs them) versions that passed QC.
  - `→ APPROVED` requires a user action that creates an `approvals` row bound to the exact content hashes.
  - `→ SUBMITTED | EMAIL_SENT` requires a valid, unexpired, non-invalidated approval, and runs through `outbound_actions` with an idempotency key. **No workflow or agent can skip this.**
  - Duplicate protection: unique `(user_id, job_id)`; plus a warning (not a block) when the user already has an active application at the same company within 90 days.

---

## 7. Workflow system (Phase 9)

### 7.1 Definition (stored in `workflow_versions.definition`)

```ts
type WorkflowDefinition = {
  schemaVersion: 1;
  trigger: { type: "MANUAL" | "SCHEDULE" | "EVENT" | "WEBHOOK"; config: unknown };
  nodes: Array<{
    id: string; // stable key, referenced by edges and node executions
    type: NodeType; // registry key, e.g. "JOB_FILTER"
    typeVersion: number; // node implementations are versioned
    name: string;
    position: { x: number; y: number };
    config: unknown; // validated by the node type's Zod schema
    inputs: PortSpec[]; // declared by the node type
    outputs: PortSpec[];
    retry?: { maxAttempts: number; backoff: "fixed" | "exponential"; delayMs: number };
    onError?: "fail" | "continue" | { route: string /* ERROR_HANDLER node id */ };
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    sourcePort: string;
    target: string;
    targetPort: string;
    condition?: string;
  }>;
  settings: { timezone: string; maxConcurrentExecutions: number; timeoutMinutes: number };
};
```

Node types (registry, open set): `TRIGGER`, `JOB_SEARCH`, `JOB_FILTER`, `CONDITION`, `JOB_MATCH`, `RESEARCH`, `AI_GENERATION`, `DOCUMENT_GENERATION`, `HUMAN_APPROVAL`, `EMAIL`, `APPLICATION`, `DATABASE`, `NOTIFICATION`, `DELAY`, `WEBHOOK`, `ERROR_HANDLER`.

Each node type implementation declares: config schema, input/output port schemas, `sideEffect: none | internal | external`, required permissions, and an `execute(ctx, input)` function that **calls module services** — nodes never touch the database directly. Nodes with `sideEffect: external` (`EMAIL`, `APPLICATION`, outbound `WEBHOOK`) are only valid if a `HUMAN_APPROVAL` node precedes them on every path; the validator rejects the graph otherwise.

Publishing validates: acyclic graph (loops only via explicit iterator nodes, later), port type compatibility, config schemas, approval-before-side-effect rule, and permission scope.

### 7.2 Execution engine

```
Trigger fires
  → workflow_execution (QUEUED, pinned to workflow_version)
  → scheduler resolves ready nodes (all inputs satisfied)
  → enqueue one queue job per ready node (idempotency key = execution_id:node_key:attempt)
  → worker runs node → writes workflow_node_execution (input, output, status)
  → scheduler re-evaluates downstream nodes
  → execution completes when no runnable nodes remain
```

| Capability       | Mechanism                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause            | `HUMAN_APPROVAL` / `DELAY` nodes set status `WAITING` and store a hashed resume token; the execution becomes `WAITING`.                                                                                         |
| Resume           | Approval decision or delay timer (pg-boss scheduled job) resumes the node with the token.                                                                                                                       |
| Cancel           | `cancel_requested_at` set; running nodes finish their current step, pending nodes are marked `CANCELLED`.                                                                                                       |
| Retry            | Per-node policy for `retryable` errors; each attempt increments `attempt`. Manual "retry from node" re-runs a failed node with its stored input.                                                                |
| Failure recovery | Node state is persisted before and after every step, so a crashed worker's job is re-delivered and resumes from the last completed node. External side effects are protected by `outbound_actions` idempotency. |
| Limits           | Per-user concurrent executions, per-execution timeout, max nodes per graph, AI budget checks before AI nodes run.                                                                                               |

The canvas UI (React Flow) is a view over this definition; it is not built until Phase 9.
