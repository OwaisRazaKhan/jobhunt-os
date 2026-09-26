# Communication Studio (Phase 7)

Prepares **application emails and cover letters** from the candidate's verified facts, the target job, the
match, the associated resume version and sourced company research. It **never sends anything**: there is no
Gmail/Outlook/SMTP integration, no Send button, no follow-ups, bulk outreach, recruiter scraping, application
submission or workflow canvas. The user copies or exports an approved version and sends it themselves.
(Sending is Phase 10 and will require a recorded approval bound to the exact content hash.)

Code: `src/modules/communications/` · Routes: `/communications`, `/communications/new`,
`/communications/[id]`, `/communications/[id]/compare`, `/communications/signatures` ·
API: `/api/v1/communications/versions/[id]/preview`, `/api/v1/communications/exports/[id]/download` ·
Migration: `20261020000000_phase7_communication_studio`.

## 1. Build status

| Checkpoint | Scope                                                                                               | State |
| ---------- | --------------------------------------------------------------------------------------------------- | ----- |
| 1          | Data model, migration + RLS, document schemas, hashing, quality engine, service layer, dashboard    | Done  |
| 2          | Email studio: new email, recipient context, subject/body/signature editor, autosave, versions, copy | Done  |
| 3          | Cover letter studio: templates, header/recipient editor, live preview, job/resume relationship      | Done  |
| 4          | AI email generation via the orchestrator, claim validation, quality checks, regeneration            | Done  |
| 5          | AI cover letter generation (same pipeline), preview, versioning                                     | Done  |
| 6          | Review & approval: ready for review, findings, side-by-side compare, approval preview, restore      | Done  |
| 7          | Export: cover letter PDF/DOCX (+TXT), email TXT, private storage, signed URLs, export history       | Done  |
| 8          | Job detail / Resume Studio integration (job + resume version carried automatically)                 | Done  |
| 9          | Final integration, import, duplicate, signature presets, workflow contract, real end-to-end run     | Done  |

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
- **Import** (`import.ts`): pasted text/HTML is reduced to plain text (scripts, styles and tags dropped,
  never rendered), structured (Subject:/greeting/closing recognised) and saved as an `IMPORTED` version. It
  passes the same claim validation and checks before approval.
- **Save** uses optimistic concurrency (`expectedHash`). A `DRAFT` head is updated in place; any other state
  creates a new `MANUAL_EDIT` version with the parent linked and the claim citations carried over. Editing
  AI content marks it `AI_ASSISTED`; manual content stays `USER_AUTHORED` (never labelled AI).
- **Restore** creates a new `RESTORED` version; **Duplicate** creates a new communication (`DUPLICATED`).
- **Status**: `DRAFT ⇄ READY_FOR_REVIEW → APPROVED → ARCHIVED`, `REJECTED → DRAFT`.
- **Approve** gate: the user ticks a confirmation; the caller confirms the hash they reviewed; content
  re-hashes to the stored hash; a quality check for the exact hash **and** current evidence has zero
  `CRITICAL` findings and no `UNSUPPORTED` statements. Idempotent. The approval stores the validation state.
  Editing an approved version creates a new draft — the approval stays on the old version only.
- **Add as candidate fact**: an explicit button on an unsupported statement about the candidate. It creates
  a `USER_PROVIDED` achievement (never `VERIFIED`) and re-runs the check.
- **Archive** makes a communication read-only until it is restored.
- Every mutation writes an audit record (`communication_*`, `signature_preset_*`).

## 5. Claim validation (`claims.ts`)

Every body sentence is audited deterministically; model-declared citations are hints only.

| Kind           | Rule                                                                                                                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CANDIDATE`    | First-person statements: every number, skill/tool, leadership word and name must be in the candidate facts (or the approved resume text). Low overlap with cited facts → `PARTIALLY_SUPPORTED`.                                          |
| `COMPANY`      | Statements about the company/team/product need a `VERIFIED_FROM_SOURCE` research claim (cited on the claim with its source URL). Plain role statements may be backed by the job posting (`basis: JOB_POSTING`). Otherwise `UNSUPPORTED`. |
| `USER_CONTEXT` | Statements taken from the context the user typed — labelled "not externally verified".                                                                                                                                                   |

Courtesy/intent sentences ("I am applying for the … role at …") and resume-availability lines are not
claims. Checks re-derive claims from the text every time, so a manual edit can never smuggle in an
unsupported statement. The job text is data: a skill that appears only in the (possibly injected) job
description is **not** candidate evidence.

## 6. AI generation (`generation.ts`, `generation.service.ts`)

Tasks `email.generate` / `cover_letter.generate` (PRIVATE_CANDIDATE, default Ollama; Gemini only with the
operator switch + the user's private-cloud consent) — always through `runAiTask`, never a provider SDK.

```
job + requirement set · usable facts · resume version · match · research (current versions)
  → prompt (SYSTEM RULES / candidate_facts / resume_version / match_summary / research_claims /
            job_data (untrusted) / user_context / recipient / task)          prompt id email-generation-v1 /
  → orchestrator (privacy routing, bounded retries, schema validation)       cover-letter-generation-v1
  → reference validation (unknown fact refs / research ids dropped)
  → sentence audit: unsupported, self-flagged-and-unsupported, attachment claims, invented
    relationships, placeholders and greeting/closing lines inside the body are removed
  → new GENERATED / AI_GENERATED version locked to the exact context + claims persisted
  → quality check
```

- The model writes wording only: greeting, signature and cover-letter header are system-controlled.
- Metadata on the version: task, prompt version, provider, model, generation id, duration, stats,
  research/requirement-set versions, fingerprint (no prompts, no keys).
- Idempotent: identical settings + context + engine version return the existing draft; concurrent
  requests for the same communication are refused. Generation is explicit (never on keystrokes).
- If no provider is permitted/available the user is told why and manual writing still works end to end.
- If nothing in the AI draft can be verified, nothing is saved.

## 7. Quality engine (`quality.ts`, `communication-quality-1`)

Deterministic and explainable — **no "human score", no AI-detection probability, no detector-evasion
advice**. Categories: completeness, accuracy, consistency, relevance, personalization, writing, length.

Critical (blocks approval): missing subject/greeting/body/signature; unsupported statements; company
statements without a research source; text claiming a file is attached when none is associated; implied
prior conversations/relationships (a warning instead when the user's own context states them); a greeting
naming someone other than the entered recipient.
Warnings/info: partly supported statements, no concrete evidence, a paragraph repeating the resume word for
word, generic openings, filler, exaggeration, empty enthusiasm, repetition, long sentences, missing
company/role mention, length outside the range for the chosen length.

## 8. Rendering & export (`render/*`, `export.service.ts`)

- One render model (`buildLetterModel`) drives the HTML preview, the PDF (pdfkit) and the DOCX (docx) — the
  Phase 6 engine and template tokens. Templates: `CLASSIC`, `MODERN`, `MINIMAL`, `EDITORIAL` (text only, no
  graphics). "Exact PDF preview" uses the export renderer.
- Export pipeline: integrity (hash) → claim check (no unsupported statements) → render → parse the file back
  and verify every paragraph → private storage `{userId}/communications/{communicationId}/versions/{versionId}/{exportId}.{ext}`
  (DB CHECK enforces the prefix) → export record (`matches_approval` when the exact approved content was
  exported). Reused when unchanged. Downloads: owner check + 60-second signed URL.
- Emails export as plain text (and copy buttons: subject, full email, body); no PDF for emails.

## 9. UI

- `/communications` — real records only; filters All / Emails / Cover letters / Drafts / Ready for review /
  Approved / Archived; New email / New cover letter / Signatures.
- `/communications/new` — type, job, resume version (approved tailored version for the job preselected),
  recipient (only what the user knows), tone, length, template, signature, own context; start with AI,
  manually, or import.
- `/communications/[id]` — context panel (job, requirements version, match, research version, resume version,
  facts, recipient, style), AI draft panel (real provider label, real stage list after completion, removed
  statements), editor with autosave + live preview (email: To / Subject / Body with "Recipient not
  specified."), quality check, statements & evidence (fact labels, research claim + source link, "Add as
  candidate fact"), approval preview (target, company, resume, research, finding counts, hash) with
  confirmation, copy & export with history, version history (type, source label + provider, status,
  compare, restore).
- Entry points: Job detail → "Write application email" / "Write recruiter email" / "Write cover letter";
  Resume Studio → "Create cover letter" / "Write email" (resume version + job carried automatically).

## 10. Workflow contract (Phase 9; no visual node)

The Phase 8 input is the Communication Package handoff (§13.6).

`writeCommunication(actor, { jobId, resumeVersionId?, communicationType, recipientContext?, userContext?, options? })`
→ `{ communicationId, communicationVersionId, contentHash, qualityReport, approvalRequired: true }`.
Phase 8 can read the approved resume version, approved cover letter and approved email with their hashes.

## 11. Tests

- Unit: `communications.test.ts` (schemas, plain text, hashing, greetings, quality engine) and
  `generation.unit.test.ts` (claim auditor scenarios D/E/F, draft validation, prompt isolation, import
  sanitization, diff, PDF/DOCX render + parse-back for every template, real-draft regressions).
- Integration: `tests/integration/communications.test.ts` (CRUD, RLS, concurrency, approval gate, trigger,
  restore, archive, presets) and `tests/integration/communication-generation.test.ts` (grounded generation
  with a fake provider, removal of invented metric / injected skill / attachment claim, provenance,
  idempotency, generated→edited→approved→edited flow, research version locking, no-verifiable-content,
  invalid output, Gemini never used without consent, manual path without AI, add-as-fact, PDF/DOCX storage
  and cross-user download denial, TXT export, workflow contract). `advisors.test.ts` and
  `ai-orchestrator.test.ts` cover the new tables and tasks.

## 12. Real end-to-end run (2026-09-26, owais, Sarvam "Frontend Engineer, Chanakya")

Job research v1 (25 verified claims from the posting) → application email and cover letter drafted locally
by Ollama `qwen3.5:9b` through the orchestrator (30–77 s) with the approved tailored resume. Every factual
sentence was traced: candidate statements cite experience/skill facts or the approved resume; the company
statement is backed by the posting; statements the auditor could not fully support are flagged for review
(`PARTIALLY_SUPPORTED`), and the removed ones are listed. Findings from this review fixed the system
(greeting/closing inside the body, intent sentences counted as claims, posting names flagged as unknown).
Nothing was sent.

## 13. Communication Package — the Phase 7 → Phase 8 boundary

Migration `20261025000000_phase7_communication_packages` · code `package.ts` (pure), `package.service.ts`,
`recipient.service.ts` · routes `/communication-packages`, `/communication-packages/new`,
`/communication-packages/[id]`, `/communications/recipients`, `/communications/preferences` ·
API `GET /api/v1/communication-packages/[id]/handoff`.

A package is the exact set of **approved** assets prepared for **one job**: resume version (always), an
application email and/or a cover letter (optional, per package), a recipient context, and the context
versions they were prepared against. It is the only clean handoff into Phase 8.

**Ready for application means prepared and approved — not submitted.** The UI, the API
(`submitted: false`) and the docs keep that distinction explicit. Nothing in Phase 7 sends or submits.

### 13.1 Data model (all owner-only RLS, one policy per table, FK indexes)

| Table                          | Purpose                                                                                                                                                                                                                                                     | App grants |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `communication_packages`       | Job, channel (`PORTAL` / `EMAIL`), included assets, status, **context snapshot** (match, requirement set, research, job content hash, candidate facts hash, recipient + strategy snapshots), integrity hash, stale reasons, lineage (`previous_package_id`) | S I U      |
| `communication_package_assets` | **Asset manifest**: one row per asset type with the exact version id, its content hash, and the approval id recorded at readiness                                                                                                                           | S I U D    |
| `communication_package_checks` | Every deterministic readiness check run (items + result + integrity hash)                                                                                                                                                                                   | S I        |
| `recipient_contexts`           | Reusable recipients with provenance (source, source URL, verification, confidence, notes)                                                                                                                                                                   | S I U D    |
| `communication_preferences`    | One row per user: greeting word, closing, default tone/length, phrases to avoid                                                                                                                                                                             | S I U D    |

`communications` gained `recipient_context_id` (the saved recipient it mirrors) and `strategy` (jsonb).
Signature profiles were **reused** (`signature_presets`; the default is `is_default`, not duplicated).

Triggers (`search_path = ''`):

- `communication_packages_protect_frozen` — once `READY_FOR_APPLICATION` (and when `STALE` / `INVALID` /
  `ARCHIVED`) references, snapshots, integrity hash and ready time can never change; status only moves
  forward (`READY → STALE | INVALID | ARCHIVED`, `STALE | INVALID → ARCHIVED`).
- `communication_package_assets_guard` — asset rows of a frozen package cannot be added/changed/removed
  (only the approval id recorded at the moment of readiness), and every asset hash must equal the
  referenced version's content hash.

### 13.2 Statuses

| Status                  | Meaning                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `INCOMPLETE`            | A required asset/context is missing or not valid yet (e.g. not approved, critical finding)  |
| `READY_FOR_REVIEW`      | Every check passes; the candidate has not confirmed the final review                        |
| `READY_FOR_APPLICATION` | Confirmed; frozen; exact approval ids + integrity hash recorded                             |
| `STALE`                 | A frozen package whose references are no longer current / approved (never silently updated) |
| `INVALID`               | Integrity problem: hash mismatch, job gone, inconsistent references                         |
| `ARCHIVED`              | Retained history                                                                            |

### 13.3 Deterministic readiness check (no scores)

Each item is PASS / FAIL / WARN / N/A with a reason: candidate profile with usable facts · job exists ·
match exists (current) · requirements current · research (optional) · per asset: selected, **integrity**
(content re-hashes to the stored and selected hash), **approved** (active approval for that exact hash),
**current** (no newer approved version, not edited after approval), is for this job · per communication:
claims validated (no unsupported statements), no critical findings, written for the packaged resume ·
recipient (an `EMAIL` package needs a recipient email you know; `INVALID` / `STALE` recipients block;
unverified is a warning) · recipient matches the email's recipient.

Required assets: `PORTAL` → resume (+ email / cover letter if included); `EMAIL` → resume + email + recipient email.

### 13.4 Stale detection

Evaluated on every view / re-check / handoff; a frozen package moves to `STALE` (with reasons, audited)
when: an asset's approval is revoked or changed · the approved version was **edited** (a `MANUAL_EDIT`
child exists — editing an approved email or resume) · a **newer approved** version of the same resume /
communication exists · the match or requirement set was recomputed · the research was superseded · the job
posting changed · the recipient context changed or became invalid/stale. A newly generated draft elsewhere
does **not** change the package. `INVALID` when an asset hash no longer matches or the job is gone.
Updating = **Duplicate** (same versions) or **Create updated package** (latest approved versions) — a new
package linked to the old one; the stale package is kept as history.

### 13.5 Integrity

`packageIntegrityHash` = SHA-256 over a canonical JSON of: job id + content hash, channel, included assets,
match / requirement set / research ids, candidate facts hash, every asset `(type, version id, content hash)`,
the recipient snapshot and the strategy snapshot. Reproducible (order-independent); it complements — never
replaces — the per-asset content hashes. Stored when the package becomes ready and re-verified at handoff.

### 13.6 Phase 8 handoff

`getCommunicationPackageForApplication(actor, packageId)` re-runs the readiness/stale check, requires
`READY_FOR_APPLICATION` and a matching integrity hash, and returns:
`{ packageId, candidateId, jobId, channel, matchVersionId, requirementSetId, researchVersionId,
candidateSnapshotHash, resume, email, coverLetter (each { versionId, contentHash, approvalStatus, approvalId }),
recipientContext, strategy, readinessStatus, integrityStatus: "VERIFIED", integrityHash, readyAt, submitted: false }`.
Unapproved / stale / tampered / incomplete packages, missing candidate or job, and other users' packages
are rejected. Every handoff is audited.

### 13.7 Recipient context & provenance

Sources: `JOB_POST`, `OFFICIAL_COMPANY_PAGE`, `USER_PROVIDED`, `PUBLIC_PROFESSIONAL_SOURCE`,
`PHASE_8_DISCOVERY` (reserved; not selectable in Phase 7), `UNKNOWN`. Verification: `SOURCE_VERIFIED`,
`UNVERIFIED`, `INVALID`, `STALE`. `SOURCE_VERIFIED` requires a public source type **and** its link **and**
the candidate's explicit confirmation (DB CHECK + service); changing the name/email/source resets it.
Nothing is discovered, inferred or pattern-generated; greetings never use a name that wasn't entered.
Applying a saved recipient to a communication fills its recipient fields and links it; editing those
fields by hand unlinks it.

### 13.8 Personalization & strategy

- **Preferences** (`/communications/preferences`): greeting word ("Hi" → "Hi Priya," / "Hi Hiring Team,"),
  closing, default tone and length, phrases to avoid, default signature profile. New drafts use them; AI
  prompts include the closing and forbidden phrases; the quality check flags an avoided phrase
  (`preference.avoided_phrase`, warning).
- **Strategy** (communication settings): purpose (from the type), requested action, primary / supporting
  evidence (fact references). Passed to AI generation, stored in the version's generation metadata and in
  the package's strategy snapshot.

### 13.9 Entry points

Job detail → **Create communication package** · Resume Studio (approved version for a job) → **Create
communication package** with that exact version · approved email / cover letter → **Add to communication
package** with that exact version. Package detail actions: Re-check readiness, Mark ready for application
(confirmation), Open resume / email / cover letter, Duplicate, Create updated package (when stale), Archive.
No Send / Submit / Apply.

### 13.10 Tests

`package.unit.test.ts` (readiness items, required assets, stale/invalid transitions, forward-only statuses,
integrity reproducibility, greeting preference) and `tests/integration/communication-packages.test.ts`
(approved assets → ready → handoff with exact versions; persistence; frozen trigger; unapproved and missing
assets; foreign-job email refused; email channel recipient rule; stale after editing the approved email,
after a revoked approval and after a recomputed match; tampered hash → INVALID; asset hash guard; cross-user
isolation incl. raw RLS; recipient verification rules + DB CHECK; preferences defaults and avoided phrases).

### 13.11 Real data (2026-09-26, owais, Sarvam "Frontend Engineer, Chanakya")

Created through the UI from the job page: portal package with the approved tailored resume v1, approved
application email v3 and approved cover letter v2, current match and research v1 → every check passed →
confirmed → `READY_FOR_APPLICATION`; the handoff returned the exact versions, hashes and approval ids with
integrity `VERIFIED`. No recipient email is known for this job, so an `EMAIL`-channel package is not possible
without one (none was invented).

## 14. Known limitations

- The claim auditor is lexical: it catches invented numbers, skills, leadership and names, but judges
  paraphrase quality only by word overlap — partly supported statements need the user's review.
- Research synthesis without a web search backend only covers the job posting and (confirmed) official site.
- Generation runs inside the request (local models take 30–90 s); there is no background queue yet.
