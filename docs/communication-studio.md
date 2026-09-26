# Communication Studio (Phase 7)

Prepares **application emails and cover letters** from the candidate's verified facts, the target job and
sourced company research. It **never sends anything**: there is no Gmail/Outlook/SMTP integration, no
Send button, no follow-ups, bulk outreach, recruiter scraping or application submission. The user copies
or exports an approved version and sends it themselves. (Sending is Phase 10 and will require a recorded
approval bound to the exact content hash.)

Code: `src/modules/communications/` · Route: `/communications` · Migration: `20261020000000_phase7_communication_studio`.

## 1. Build status

| Checkpoint | Scope                                                                                            | State |
| ---------- | ------------------------------------------------------------------------------------------------ | ----- |
| 1          | Data model, migration + RLS, document schemas, hashing, quality engine, service layer, dashboard | Done  |
| 2+         | Editor, AI generation (via `runAiTask`), claim validation UI, approval UI, exports               | Next  |

## 2. Data model

| Table                          | Purpose                                                                                                  | App grants |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------- |
| `communications`               | Logical email / cover letter: kind, type, job/company, resume version, recipient, tone, length, template | S I U      |
| `communication_versions`       | Immutable-once-approved content (jsonb, schema v1), plain text, SHA-256 `content_hash`, locked context   | S I U      |
| `communication_claims`         | Checkable statements in a version (`CANDIDATE`, `COMPANY`, `USER_CONTEXT`) with a support status         | S I D      |
| `communication_claim_sources`  | Evidence for a claim: candidate fact, research claim, requirement or user context                        | S I D      |
| `communication_checks`         | One quality-check run for an exact content hash + checker version (summary counts)                       | S I U      |
| `communication_check_findings` | Findings of a check (`PASS`/`INFO`/`WARNING`/`CRITICAL`)                                                 | S I D      |
| `communication_approvals`      | Human approval bound to a content hash; revocable, never deleted; one active per version                 | S I U      |
| `communication_exports`        | Export records (PDF/DOCX/TXT; files in private storage)                                                  | S I U      |
| `signature_presets`            | User-chosen signature fields; at most one default per user                                               | S I U D    |

- Every table has `user_id`, RLS enabled and **one** owner policy `user_id = (SELECT app_current_user_id())`
  (child tables also check the parent row belongs to the user). `anon`/`authenticated` have no grants.
- Communications and versions are never deleted by the app (archive instead).
- CHECK constraints cover every enum, kind/type consistency (`COVER_LETTER` kind ⇔ `COVER_LETTER` type),
  recipient email format and text lengths. Partial unique indexes: one active approval per version, one
  default signature per user. Every FK has a covering index.
- Trigger `communication_versions_protect_approved` (`search_path = ''`) rejects any change to content,
  plain text, hash or context references of an `APPROVED` version.

### Version context locking

Each version records the inputs it was prepared against: `resume_version_id`, `requirement_set_id` (current
set of the job), `job_research_id` (current research version), `match_id` (current match) and a
`context_hash` over those plus a hash of the candidate's usable facts. Later phases compare it to detect
stale drafts; the version itself never changes.

## 3. Content (`document.ts`)

Structured, never HTML-only. Strings are plain text (control characters stripped, rendered escaped).

- **Email:** `subject`, `greeting`, `bodyParagraphs[]`, `closing`, `signature`.
- **Cover letter:** `header {name, email, phone, location, links[]}` (http(s) links only), `date`,
  `recipient {name, title, company}`, `greeting`, `paragraphs[]`, `closing`, `signature`.

Drafts may be incomplete; the quality engine reports gaps and approval requires completeness.
`toPlainText()` produces the clean copy/export text.

**Content hash** (`hash.ts`): SHA-256 over the normalized content fields (whitespace inside lines
collapsed, line endings normalized) — cosmetic whitespace never changes it, any wording does.

## 4. Service rules (`communication.service.ts`)

- **Create** (manual): a neutral skeleton only — factual subject ("Application — {job title}"), greeting
  from the entered recipient name or a generic one by recipient type ("Dear Hiring Team,"), "Kind regards,",
  signature from the chosen/default preset or the profile name. Cover-letter headers use profile facts only.
  Recipient names, relationships, referrals, metrics and attachments are never invented.
- **Save** uses optimistic concurrency (`expectedHash`). A `DRAFT` head is updated in place (its claims are
  cleared); any other state creates a new `MANUAL_EDIT` version with the parent linked. Editing AI content
  marks it `AI_ASSISTED`.
- **Restore** creates a new `RESTORED` version; history is never overwritten.
- **Status**: `DRAFT ⇄ READY_FOR_REVIEW → APPROVED → ARCHIVED`, `REJECTED → DRAFT`.
- **Approve** gate: caller confirms the hash they reviewed; content re-hashes to the stored hash; no
  `UNSUPPORTED` claims; the quality check for the exact hash has zero `CRITICAL` findings. Idempotent.
  The approval stores the validation state. Revoking returns the version to `READY_FOR_REVIEW`.
- **Archive** makes a communication read-only until it is restored.
- Every mutation writes an audit record (`communication_*`, `signature_preset_*`).

## 5. Quality engine (`quality.ts`, `communication-quality-1`)

Deterministic and explainable — **no "human score", no AI-detection probability, no detector-evasion
advice**. Categories: completeness, accuracy, consistency, relevance, personalization, writing, length.

Critical (blocks approval): missing subject/greeting/body/signature; unsupported statements; company
statements without a research source; text claiming a file is attached when none is associated; implied
prior conversations/relationships; a greeting naming someone other than the entered recipient.
Warnings/info: generic openings, filler, exaggeration, empty enthusiasm, repetition, long sentences,
missing company/role mention, length outside the range for the chosen length.

## 6. Tests

- Unit: `src/modules/communications/communications.test.ts` (schemas, plain text, hashing, greetings,
  quality engine).
- Integration: `tests/integration/communications.test.ts` (create/read, cross-user isolation incl. raw RLS,
  optimistic concurrency, approval gate + idempotency, immutability trigger, no DELETE, restore, archive,
  signature presets); `tests/integration/advisors.test.ts` covers the new tables.
