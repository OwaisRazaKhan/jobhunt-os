# Application Engine (Phase 8)

Turns a Phase 7 communication package that is `READY_FOR_APPLICATION` into a real, tracked application
attempt for one job: channel discovery → form discovery → field mapping → answers → review → approval →
autofill → submission → confirmation → log. Where automation is not technically or legitimately possible
the engine stops and hands the candidate the remaining steps (manual fallback).

Code: `src/modules/applications/`, `src/server/browser/` · Routes: `/applications`, `/applications/[id]`,
`/applications/[id]/review`, `/applications/[id]/questions`, `/applications/settings` · Worker:
`npm run worker:applications` · Migrations: `20261029000000_phase8_application_engine`,
`20261030000000_phase8_execution`.

**Hard rules.** No CAPTCHA / 2FA / authentication / anti-bot / rate-limit bypass, ever — such barriers stop
automation (`NEEDS_HUMAN_INPUT` / manual). No fabricated answers, contacts, emails, application IDs or
confirmations. Human approval before submission by default. A submission is recorded only with evidence;
uncertain results are never retried automatically. No follow-ups (Phase 11), analytics (Phase 12) or
workflow canvas (Phase 9). Email delivery goes through a delivery adapter implemented in Phase 10.

## 1. Build status

All twelve checkpoints are built and tested: unit tests, integration tests, and browser tests against the controlled
fixture using the installed Microsoft Edge.

| Checkpoint | Scope                                                                                    | State |
| ---------- | ---------------------------------------------------------------------------------------- | ----- |
| 1          | Data model, migration + RLS, state machine, hashes, validation, core services, dashboard | Done  |
| 2          | Communication package → application (validation, version locking, duplicates)            | Done  |
| 3          | Application channel discovery (ATS / official email / provenance)                        | Done  |
| 4          | Form discovery (official API or browser), field model, fingerprint, drift                | Done  |
| 5          | Field mapping (deterministic first, AI only for ambiguous optional labels), review UI    | Done  |
| 6          | Application question engine (local AI, claim audit, limits, injection defence)           | Done  |
| 7          | Review, overrides, approval, application hash, invalidation                              | Done  |
| 8          | Browser worker, navigation safety, pause/resume/stop, leases, timeouts                   | Done  |
| 9          | Adapters — only what is genuinely supported (see §7)                                     | Done  |
| 10         | Submission + confirmation evidence, uncertain state, duplicate protection                | Done  |
| 11         | Manual fallback (checklist, copy, files, user confirmation) and email payload            | Done  |
| 12         | Final integration (real Sarvam application prepared to review — not approved/submitted)  | Done  |

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

Migration `20261030000000_phase8_execution` adds:

- **Attempts:** a `QUEUED` status (the default), `phase` (`INSPECT | FILL | FILL_AND_SUBMIT | SUBMIT`), `control_command`
  (`NONE | PAUSE | RESUME | STOP`), `human_action`, `heartbeat_at`, and a queue index.
- **Forms:** `inspection_source` (`API | BROWSER | FIXTURE`) and `is_test_adapter`.
- **`application_settings` table:** default automation mode and the auto-submit confidence threshold (owner RLS, S I U).
- **Manual path in the status trigger:** → `SUBMITTED` is allowed only with `confirmation_source = 'USER_CONFIRMED'`, and
  only from `IN_PROGRESS`, `NEEDS_HUMAN_INPUT`, `READY`, `READY_TO_SUBMIT`, `FAILED` or `BLOCKED` (`MANUAL_CONFIRM_FROM`).
- **Answer approval:** a `USER_AUTHORED` answer to a legal or preference question may be approved while `NOT_VALIDATED`,
  because it is the candidate's own statement. `UNSUPPORTED` answers can never be approved.

## 5. Architecture

```
UI (server components + thin server actions, src/app/(app)/applications)
  └─ services (src/modules/applications)
       application.service   state machine, attempts, submission recording, uncertain resolution
       prepare.service       package → application, channels, inspection, mapping, settings
       files.service         exact approved files (PDF exports), hash verification, temp materialization
       answer.service        question engine (AI orchestrator + claim audit)
       review.service        readiness, application hash, overrides, approval
       execution.service     queue, worker run, CAPTCHA/barrier policy, email payload, manual fallback
  └─ worker (scripts/application-worker.ts) → src/server/browser (isolated Playwright session)
```

Routes stay thin, and every database access is scoped to the user (`withUserContext` + RLS). The worker claims
attempts over the owner connection (`FOR UPDATE SKIP LOCKED`), then does all its work under the attempt owner's
user context. No browser ever runs inside a web request.

## 6. Flow

1. **Create** (`createApplicationFromPackage`).
   - Uses the Phase 7 handoff, which re-checks that the package is `READY_FOR_APPLICATION`, uses approved assets, is
     not stale, and passes integrity checks.
   - Locks the exact versions and their hashes into `snapshot`.
   - Refused with `CONFLICT` (the error includes the existing application id) when the job already has an active
     application.
   - The button is on the package page.
2. **Channel discovery** (`discoverChannels`, pure `channel.ts`). Channels are ranked in this order:
   1. The ATS public-API channel (`SOURCE_VERIFIED`).
   2. A link on an ATS host (unverified).
   3. An email the posting presents as the way to apply (`SOURCE_VERIFIED`, with the posting excerpt).
   4. A generic application link.
   5. An email found on official pages that research already fetched.
   6. Otherwise, manual.

   User-entered URLs and emails are recorded as `USER_PROVIDED` / `UNVERIFIED`. Privacy, support and press
   addresses are never treated as application channels. Nothing is scraped for contacts.

3. **Form discovery** (`inspectApplicationForm`).
   - **Greenhouse:** read from the official public Job Board API (`?questions=true`) during the request.
   - **Browser adapters:** queued as an `INSPECT` attempt for the worker. robots.txt is checked first; if it
     disallows the page, the application goes to the manual path.
   - **Email and manual:** there is no form.

   Each field keeps its semantic metadata (label, aria attributes, name), type, required flag, options, maximum
   length and a fingerprint. A later inspection compares the structure (`formDrift`). A significant change (a
   required field added or removed, or a changed label, type or option list) marks the form `CHANGED`, revokes the
   approval and sets readiness to `STALE`.

4. **Mapping** (`mapApplication`, pure `mapping.ts`).
   - Profile fields are filled from the candidate profile; files map to the exact approved exports.
   - These are only ever filled from explicit candidate data, and always go to review; otherwise they stay
     `NEEDS_USER_INPUT`:
     - work authorization and sponsorship
     - salary
     - relocation
     - start date
     - demographic questions
     - consent checkboxes
   - Skill ratings are left to the candidate.
   - Custom questions go to the question engine.
   - Re-mapping never overwrites a user's override.
   - AI (`application.map_fields`) is used only for _optional_ text/URL fields with unknown labels, and receives the
     labels only. Its suggestions are `NEEDS_REVIEW`.
5. **Questions** (§9) → **review** (§10) → **approval** → **execution** (§11), or the **manual / email** path (§12).

## 7. Adapters (honest capabilities)

| Adapter            | Inspection                  | Autofill / upload / submit | Verification                                                            |
| ------------------ | --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| `TEST_FIXTURE`     | browser                     | yes                        | Automated tests (Edge) — **test adapter, never used for a real job**    |
| `GREENHOUSE`       | official Job Board API      | browser (generic filling)  | Inspection verified live (read-only); fill/submit **not verified live** |
| `ASHBY`            | browser (public apply page) | browser (generic filling)  | Inspection verified live, read-only (Sarvam); fill/submit not verified  |
| `LEVER`            | browser (public apply page) | browser (generic filling)  | Not verified live                                                       |
| `GENERIC_WEB_FORM` | browser                     | browser (cautious)         | Not verified live                                                       |
| `EMAIL`            | —                           | payload only               | Delivery needs a Phase 10 connector → `READY_TO_SEND`                   |
| `MANUAL`           | —                           | —                          | Checklist + user confirmation                                           |

No adapter has been tested by submitting to a real company. The UI shows each adapter's limitations and how it was
verified. The test adapter is selected only when the channel URL's origin equals `APPLICATION_FIXTURE_ORIGIN`.

## 8. Browser worker

- **Browser.** `playwright-core` drives the browser that is already **installed** (`APPLICATION_BROWSER_CHANNEL`:
  `msedge` by default, or `chrome` / `chromium`). Nothing is downloaded.
- **Isolation.** Each attempt gets a fresh, non-persistent context: no stored cookies or sessions, service workers
  blocked, downloads cancelled, dialogs dismissed. No stealth, fingerprint spoofing or proxies.
- **Navigation guard** (`navigation.ts`). Every request is checked:
  - http(s) only, on default ports, with no embedded credentials;
  - no localhost, `.local` or `.internal` hosts;
  - no private or reserved IPs;
  - main-frame navigations and redirects also get a DNS check: every resolved address must be public.

  The only exceptions are explicit trusted origins (the fixture).

- **Barriers.**
  - Sign-in, 2FA and anti-bot pages (and 401/403 responses) always stop the attempt with `NEEDS_HUMAN_INPUT` and the
    reason. They are never bypassed.
  - A **CAPTCHA on the form**:
    - does not stop inspection from reading the public fields;
    - stops a headless fill (`CAPTCHA_REQUIRED` → manual);
    - in a visible window (`APPLICATION_BROWSER_HEADLESS=false`), the worker fills the fields and then hands over.
      The candidate completes the CAPTCHA and clicks submit. The worker never clicks submit on a CAPTCHA-protected
      form; it only watches for the confirmation.
- **Fill.**
  - Before filling, the live form is fingerprinted again. If it changed, the form is re-inspected; if the approval no
    longer matches, the attempt ends with `FORM_CHANGED` and nothing is filled.
  - The application hash is recomputed and must equal the approved hash.
  - Values are typed, then read back. An option must exist as-is; a different option is never picked.
  - Only the approved exports are uploaded, and each is re-verified first: owned by the user, still approved, stored
    bytes matching the recorded hash, and an allowed type and size. The files are written to a private temp directory
    that is always removed afterwards.
- **Modes.**
  - `HUMAN_APPROVAL` (default): after filling, the attempt waits (`NEEDS_HUMAN_INPUT`). The candidate either clicks
    **Submit application** in JOBHUNT (`requestSubmit`) or submits in the visible window, which the worker observes and
    records with evidence.
  - `AUTO_FILL_REVIEW_SUBMIT`: fills and submits after approval. If the user set the `EXACT` threshold
    (`/applications/settings`), any value that isn't an exact match makes it wait, as in `HUMAN_APPROVAL`.
  - `MANUAL_ONLY`: never automated.
- **Control.** Pause, Resume and Stop take effect between steps. Stopping a queued attempt cancels it.
- **Leases and timeouts.**
  - Leases last 5 minutes and are kept alive by a heartbeat.
  - An expired lease ends the attempt with `SESSION_EXPIRED`. If a submission was in progress, it becomes
    `SUBMISSION_UNCERTAIN` and is never resubmitted.
  - Step, whole-attempt and confirmation timeouts are configurable.
- **In-page script.** The inspection script is serialized with a `__name` shim, because tsx/esbuild can inject helper
  functions that don't exist inside the page.

## 9. Question engine

`classifyQuestion` never drafts these question types:

- demographic
- legal / work authorization
- salary
- availability
- preferences
- self-ratings

It does draft:

- motivation
- company
- project
- behavioural
- experience
- technical (only for skills that appear in the facts)
- optional free text

Drafts come from `application.answers`, which runs on the local model only. The model sees:

- usable candidate facts and the approved resume text;
- the locked job requirements and match strengths;
- only the `VERIFIED_FROM_SOURCE` research claims from the locked research version.

The question text goes inside `<application_question>` tags and is treated as untrusted; the orchestrator also adds
its untrusted-content rule.

Every sentence of a draft is audited again (`auditAnswer` → communication `auditSentence`), and unsupported sentences
are removed. The answer is cut to the character limit only at sentence boundaries. An empty result is marked
`NEEDS_USER_INPUT`. User edits are re-audited and flagged, never rewritten.

Answers are versioned. Approval applies to one version and is immutable, and an unsupported answer can't be approved.

## 10. Review and approval

`evaluateReview` checks that:

- the package is not stale;
- the channel is resolved (for email applications, with a verified email);
- the deadline hasn't passed;
- the form is current;
- every required field has a valid value, and nothing is waiting for confirmation;
- every required question has an approved answer, and no answer is unsupported;
- the approved files exist.

The **application hash** covers:

- the locked assets and their hashes;
- every filled field: key, mapping type, source and value (files by sha256);
- the approved answers, by hash;
- the files;
- the channel.

`approveApplication`:

1. Re-validates the package.
2. Checks the job is still open (Greenhouse and Lever APIs only).
3. Requires readiness `READY`, and requires the caller to send the exact hash they reviewed (`CONFLICT` otherwise).
4. Creates an immutable approval and moves `READY → READY_TO_SUBMIT`.

Any later change produces a new hash, and `computeReadiness` then revokes the approval (`APPROVAL_INVALIDATED`).
Overrides and confirmations are saved as new mapping versions (`USER`, `EXACT`).

## 11. Submission and evidence

`beginSubmission` requires `READY_TO_SUBMIT`, an approval of the current hash, and no live submission. The worker
clicks submit **once** and watches for a confirmation:

| Outcome              | What is recorded                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Success message / ID | `SUBMITTED` with `SUCCESS_MESSAGE`, `CONFIRMATION_PAGE`, `CONFIRMATION_ID` (+ external id)            |
| Form rejection       | `FAILED` / `SUBMISSION_REJECTED` with the reason                                                      |
| Nothing              | `SUBMISSION_UNCERTAIN`; never retried — the candidate resolves it (`USER_CONFIRMED` or not submitted) |

Screenshots (review state, confirmation, failures) are stored privately at `{userId}/applications/…` and expire after
180 days. A screenshot on its own never counts as confirmation.

## 12. Manual fallback and email

- **Manual checklist** (`buildManualChecklist`). Shows:
  - the apply URL or email;
  - every field in form order with its value, each with a copy button;
  - the approved answers;
  - download links for the exact approved files.

  **I submitted it** (`confirmManualSubmission`) records a submission with `USER_CONFIRMED` evidence. It is never
  presented as automatic verification.

- **Email channel.**
  - `buildEmailPayload` builds the recipient, subject and body from the approved email version (its hash is
    re-checked) and attaches the approved files.
  - `prepareEmailSubmission` records `READY_TO_SEND`. It is idempotent and reserves the single live submission.
  - The `EmailDeliveryAdapter` interface exists, but its only implementation is "not configured" until Phase 10.
  - The candidate sends the email from their own mail client, then confirms. JOBHUNT OS sends nothing.

## 13. Setup

```
APPLICATION_AUTOMATION_ENABLED=true         # default false: no browser automation at all
APPLICATION_BROWSER_CHANNEL=msedge          # installed Edge (or chrome); nothing is downloaded
APPLICATION_BROWSER_HEADLESS=false          # visible window: take over CAPTCHAs / submit yourself
APPLICATION_WORKER_TIMEOUT_MS=900000        # whole attempt incl. waiting for you
APPLICATION_STEP_TIMEOUT_MS=30000
APPLICATION_CONFIRMATION_TIMEOUT_MS=20000
# APPLICATION_FIXTURE_ORIGIN=http://127.0.0.1:4010   # development only: trusts the local test form
```

Run `npm run worker:applications` alongside `npm run dev` (add `-- --once` to process a single attempt).

To try the automation safely:

1. Run `npm run fixture:application`. It serves a TEST form on 127.0.0.1:4010 with the variants `basic`, `changed`,
   `captcha`, `login`, `slow` and `reject`.
2. Set `APPLICATION_FIXTURE_ORIGIN`.
3. Enter `http://127.0.0.1:4010/apply?variant=basic` as the channel URL of an application.

## 14. Security

- **Isolation.** RLS on every table, with a cross-user test for each one.
- **Secrets.** Never included in prompts or logs. Event payloads are sanitized (keys named cookie, token, password or
  session are dropped). No passwords, cookies or sessions are stored.
- **Uploads.** Only the approved files: type and size allow-list, hash match, owner check.
- **SSRF / browser pivoting.** Blocked by the navigation guard.
- **Prompt injection.** Questions and labels are treated as untrusted, and outputs are claim-audited.
- **Duplicates.** One active application per job, one active attempt, one live submission, unique fingerprints.
- **AI limits.** The AI never marks anything as verified and never submits.

## 15. Troubleshooting

| Symptom                                        | Cause / fix                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| "Browser automation is turned off"             | Set `APPLICATION_AUTOMATION_ENABLED=true`, restart the app and the worker |
| Attempt stays `QUEUED`                         | The worker is not running: `npm run worker:applications`                  |
| `CAPTCHA_REQUIRED` / `AUTHENTICATION_REQUIRED` | Expected: use a visible browser (CAPTCHA only) or the manual checklist    |
| `FORM_CHANGED`                                 | The employer changed the form: review the new fields, approve again       |
| `VALIDATION_FAILED` "robots.txt disallows"     | The site doesn't permit automated access: apply manually                  |
| `SUBMISSION_UNCERTAIN`                         | Check the ATS / inbox, then record the outcome on the application page    |
| Browser fails to launch                        | Install Edge/Chrome or set `APPLICATION_BROWSER_CHANNEL`                  |

## 16. Tests

- **`applications.unit.test.ts`:** the state machine compared with the DB trigger (every pair, including the manual
  path), hashes, drift and validation.
- **`engine.unit.test.ts`:**
  - channel ranking and email context;
  - the test adapter is selected only for the fixture;
  - mapping never guesses legal, salary, demographic or consent answers, and never rates skills;
  - question classes and `fitToLimit`;
  - removal of fabricated metrics and skills;
  - the Greenhouse parser (hidden inputs skipped; compliance → demographic);
  - drift, the navigation guard and confirmation detection.
- **`tests/integration/applications.test.ts`:** the data model and services.
- **`tests/integration/application-engine.test.ts`:**
  - package → application: locked versions, `CONFLICT` on a duplicate, a non-ready package refused;
  - channel discovery and mapping;
  - AI answers from a fake local provider, with the injected instruction and the fabricated metric removed;
  - approval with a stale hash is refused, and approval is invalidated by an edit and by a form change;
  - an unsupported answer can't be approved;
  - manual confirmation and the email `READY_TO_SEND` path;
  - cross-user isolation.
- **Browser tests against the fixture** (skipped when Edge isn't installed):
  - `HUMAN_APPROVAL` full flow: waits, submits once, gets a `CONFIRMATION_ID`, uploads the resume, leaves the
    demographic field empty, records evidence, and refuses a duplicate;
  - CAPTCHA hand-over;
  - sign-in wall;
  - form changed after approval;
  - no confirmation → uncertain, with no retry;
  - rejection → failed, with the package kept;
  - stop before start;
  - private URL blocked;
  - lease expiring during submission → uncertain.

## 17. Known limitations

- ATS filling and submission use generic DOM filling, verified only against the test fixture. Custom widgets such as
  React comboboxes, and multi-page forms, may need to be completed by hand.
- Ashby (the real Sarvam form) embeds a CAPTCHA, so the candidate always submits there themselves.
- Job-open checks exist only for Greenhouse and Lever (through their APIs). Other sources rely on the catalog status.
- No email delivery until Phase 10. No follow-ups (Phase 11), analytics (Phase 12) or workflow canvas (Phase 9).
