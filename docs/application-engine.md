# Application Engine (Phase 8)

Turns a Phase 7 communication package that is `READY_FOR_APPLICATION` into a real, tracked application
attempt for one job: channel discovery → form discovery → field mapping → answers → review → approval →
autofill → submission → confirmation → log. Where automation is not technically or legitimately possible
the engine stops and hands the candidate the remaining steps (manual fallback).

Code: `src/modules/applications/` · Route: `/applications` · Migration: `20261029000000_phase8_application_engine`.

**Hard rules.** No CAPTCHA / 2FA / authentication / anti-bot / rate-limit bypass, ever — such barriers stop
automation (`NEEDS_HUMAN_INPUT` / manual). No fabricated answers, contacts, emails, application IDs or
confirmations. Human approval before submission by default. A submission is recorded only with evidence;
uncertain results are never retried automatically. No follow-ups (Phase 11), analytics (Phase 12) or
workflow canvas (Phase 9). Email delivery goes through a delivery adapter implemented in Phase 10.

## 1. Build status

| Checkpoint | Scope                                                                                    | State |
| ---------- | ---------------------------------------------------------------------------------------- | ----- |
| 1          | Data model, migration + RLS, state machine, hashes, validation, core services, dashboard | Done  |
| 2          | Communication package → application (validation, version locking, duplicates)            | Next  |
| 3          | Application channel discovery (ATS / official email / provenance)                        | —     |
| 4          | Form discovery (fixture first), field model, fingerprint                                 | —     |
| 5          | Field mapping (deterministic first, AI only for ambiguity), review UI                    | —     |
| 6          | Application question engine (AI orchestrator, grounding, limits)                         | —     |
| 7          | Review, overrides, approval, application hash                                            | —     |
| 8          | Browser worker (fixture), navigation safety, pause/resume/stop                           | —     |
| 9          | Real supported adapters (only those genuinely supported)                                 | —     |
| 10         | Submission + confirmation, uncertain state, duplicate protection                         | —     |
| 11         | Manual fallback (checklist, copy, user confirmation)                                     | —     |
| 12         | Final integration                                                                        | —     |

## 2. Audit (before Phase 8)

No application tables or code existed; `docs/database-schema.md` §3.10 only planned them. Reused: the
communication package handoff (`getCommunicationPackageForApplication`), job `job_url` / `application_url`
(Ashby and Lever provide an apply URL; Greenhouse does not), the AI orchestrator, private storage, audit,
and the local worker pattern (`scripts/scheduler.ts` calling an internal endpoint). No browser automation
dependency exists yet (added in checkpoint 8 with the user's awareness).

## 3. Data model (all owner-only RLS, one policy per table, FK indexes)

| Table                        | Purpose                                                                                                                                                                    | App grants |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `applications`               | One attempt at one job: package, locked `snapshot` + package integrity hash, status, automation mode, readiness, current application hash, submission/confirmation summary | S I U      |
| `application_channels`       | Channel with provenance: type, provider, URL/email, source + source URL, verification, confidence, primary flag                                                            | S I U      |
| `application_attempts`       | Execution attempts (worker unit): number, execution id, adapter + version, lease, status, error code, sanitized steps                                                      | S I U      |
| `application_forms`          | Inspected form (public structure), fingerprint, schema / field-map versions, current flag                                                                                  | S I U      |
| `application_fields`         | Immutable field snapshot: id, label, type, required, options, max length, classification, fingerprint                                                                      | S I        |
| `application_field_mappings` | Versioned private value mapping: type, source ref, value, confidence, policy, status, explanation, author                                                                  | S I U      |
| `application_questions`      | Custom questions: text, answer type, classification, required, max length                                                                                                  | S I U      |
| `application_answers`        | Versioned answers: text, hash, source, supporting fact refs / research claim ids, warnings, validation, approval                                                           | S I U      |
| `application_approvals`      | Human approval of the exact application hash + normalized payload; revocable once                                                                                          | S I U      |
| `application_submissions`    | Submission / email delivery record with idempotency fingerprint and confirmation fields                                                                                    | S I U      |
| `application_evidence`       | Confirmation page/id/message, API success, screenshots (private storage `{userId}/applications/…`), user confirmations                                                     | S I U D    |
| `application_events`         | Append-only timeline with sanitized metadata                                                                                                                               | S I        |

Database-enforced rules:

- **State machine** trigger (`applications_guard_status`) — mirrors `state-machine.ts` (a unit test parses
  the migration and compares every pair). E.g. `DRAFT → SUBMITTED`, `FAILED → SUBMITTED`,
  `SUBMISSION_UNCERTAIN → SUBMITTING` are impossible.
- **Locked versions** (`applications_protect_snapshot`): package, job, candidate, snapshot and package
  integrity hash never change after creation.
- **Never a fake submission**: `SUBMITTED` / `SUBMISSION_CONFIRMED` / `SENT` require a submission time and a
  confirmation source (CHECK on applications and submissions); a recorded submission can't be rewritten
  or downgraded (`application_submissions_protect`).
- **No duplicates**: one active application per candidate + job (archive/cancel frees it); one active
  attempt per application; one live/successful submission per application; unique submission fingerprint.
- **Approvals** immutable except one revocation; one active approval per application.
- **Answers**: an `UNSUPPORTED` answer can never be approved; approved answers are immutable (new version).
- **Mappings**: `AUTO_FILL` only for `EXACT` / `HIGH` confidence; an `UNKNOWN` mapping carries no value.
- **Channels / contacts**: `SOURCE_VERIFIED` needs a real source type and source URL — user-provided,
  unknown or inferred details are never "verified"; an email channel needs an email.
- **Evidence**: user confirmations are always labelled `USER` (never automatic verification); storage paths
  are user-scoped.

## 4. States

`DRAFT → IN_PROGRESS (preparing) → READY (review) → READY_TO_SUBMIT (approved) → SUBMITTING → SUBMITTED
(evidence) → SUBMISSION_CONFIRMED`; side states `NEEDS_HUMAN_INPUT`, `SUBMISSION_UNCERTAIN`, `FAILED`,
`BLOCKED` (with a reason); ends `CANCELLED`, `WITHDRAWN`, `ARCHIVED`. `READY` is never `SUBMITTED`.
Readiness: `NOT_READY | READY | NEEDS_USER_INPUT | BLOCKED | STALE`. Automation modes:
`MANUAL_ONLY | HUMAN_APPROVAL (default) | AUTO_FILL_REVIEW_SUBMIT`.

## 5. Services (checkpoint 1, `application.service.ts`)

- `listApplications` (filters: all, draft, ready, needs attention, in progress, submitted, failed, blocked,
  archived; search by company, role or ATS) · `getApplicationWorkspace`.
- `transitionApplication` — state machine + event + audit; the gated targets (approval, submitting,
  submitted, confirmed, uncertain) are only reachable through their dedicated functions.
- `startAttempt` / `renewLease` / `updateAttempt` — one active attempt, worker leases, sanitized steps; no new
  attempt once a submission may have happened.
- `beginSubmission` — only `READY_TO_SUBMIT` with an active approval of the **current** application hash;
  refuses a second live submission.
- `recordSubmissionOutcome` — `SUBMITTED` only with confirming evidence (page, id, message, API success —
  a screenshot alone is not enough); `UNCERTAIN` stops; `FAILED` keeps the approved package.
- `resolveUncertainSubmission` — the candidate confirms (stored as `USER_CONFIRMED`) or denies.
- `recordEvent` + `sanitizePayload` — no secrets (cookie/token/password/session keys dropped), bounded size.

Pure modules: `state-machine.ts`, `hash.ts` (application content hash, answer hash, form/field fingerprints
from public structure only, form drift → `FORM_CHANGED`), `validation.ts` (required, email, phone, URL,
number, date, options, max length; files: type, size ≤ 10 MB, ownership, exact approved hash).

## 6. Tests

`src/modules/applications/applications.unit.test.ts` (state machine vs DB trigger for all pairs, impossible
transitions, hashes, fingerprints, drift, validation) · `tests/integration/applications.test.ts` (transitions
via service and DB, gated targets, blocking reason, locked snapshot, one active application, no delete,
attempts + leases, evidence-only success, no second submission, stale approval refused, uncertain → no retry
→ user confirmation, failure path, approval/answer/event immutability, mapping and channel rules, cross-user
isolation incl. raw RLS, payload sanitization, search/filters).
