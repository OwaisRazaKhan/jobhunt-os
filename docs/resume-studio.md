# Resume Studio (Phase 6)

Grounded, versioned, job-specific resumes. **The candidate database is the source of truth; a
resume is a presentation of it.** AI may reorganise and reword; it can never add a fact.

Migration: `prisma/migrations/20261010000000_phase6_resume_studio` · Module: `src/modules/resumes/`
· Routes: `/resumes`, `/resumes/[id]`, `/resumes/[id]/compare`, `/resumes/tailor?job=`.

## 1. Model

| Table                                     | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `resumes`                                 | User-owned container: `kind` MASTER (one active per user) · TAILORED (has `target_job_id`, `source_resume_id`) · GENERAL; template, page format, `current_version_id` (working head); archived, never deleted                                                                                                                                                                                                                                   |
| `resume_versions`                         | `content` = canonical **ResumeDocument** (JSON, Zod-validated), `content_hash` (SHA-256 of canonical content), `version_type` MASTER/TAILORED/MANUAL_EDIT/RESTORED/DUPLICATE, `status` DRAFT/READY_FOR_REVIEW/APPROVED/REJECTED/ARCHIVED, `parent_version_id`, `target_job_id`, `change_summary` (diff vs parent), `change_set` (tailoring changes + reasons), `ai_assisted`, `generation` (method/provider/model/options — no private content) |
| `resume_fact_references`                  | (version, item, fact ref) — which candidate fact supports which resume item                                                                                                                                                                                                                                                                                                                                                                     |
| `resume_checks` + `resume_check_findings` | Resume Check results for an exact `content_hash` (+ optional job)                                                                                                                                                                                                                                                                                                                                                                               |
| `resume_approvals`                        | Exact-content approvals (`content_hash`); revoked with a reason, never deleted; one active per version (partial unique index)                                                                                                                                                                                                                                                                                                                   |
| `resume_exports`                          | PDF/DOCX files: status, user-scoped `storage_path`, file SHA-256, `content_hash`, `matches_approval`                                                                                                                                                                                                                                                                                                                                            |

Templates (CLASSIC, MODERN, TECHNICAL, EDITORIAL) are code-defined design tokens (`templates.ts`).

**ResumeDocument** (`document.ts`): header · summary (+ saved variants) · experience · projects ·
education · skills (groups) · certifications · languages · links · additional sections · section
order/visibility. Every item has a stable `id`, `hidden`, `factRefs` (`"<kind>:<uuid>"` Phase 1
fact references), `origin` (FACT · PROFILE · AI_REWRITE · MANUAL) and `claimStatus`.

## 2. Rules

- **Building**: `buildResumeFromFacts` uses only VERIFIED / USER_PROVIDED facts
  (`getCandidateFacts` → `isUsableStatus`; NEEDS_REVIEW / AI_INFERRED and sensitive work
  authorisation are excluded). Empty sections are not printed.
- **Editing**: the head version is edited in place only while DRAFT (autosave, optimistic
  concurrency via `expectedHash`). Any other state → new MANUAL_EDIT version. Changed text gets
  `origin: MANUAL`, `editedAt`, and is re-validated against the facts it cites (`UNKNOWN` when it
  cites none) — a manual edit is never shown as verified. "Add new facts" pulls newly verified
  candidate facts into a resume; missing information is added in the candidate profile.
- **Approval**: binds the exact `content_hash`; idempotent; blocked while a visible item is
  UNSUPPORTED. **APPROVED content is immutable** (DB trigger
  `resume_versions_protect_approved`); editing creates a new draft, so the approval never applies to
  changed content. Withdrawing keeps history.
- **Master safety**: tailoring reads the source version only and always creates a new TAILORED
  resume linked to the job.

## 3. Tailoring (`TAILOR_RESUME`, `tailor.service.ts`)

Input `{ sourceResumeId, sourceVersionId?, jobId, options }` → output `{ resumeId, resumeVersionId,
jobId, changeSet, qualityReport, approvalRequired: true }` — the backend capability for the Phase 9
workflow node. Steps (with real timings in `stages`):

1. **Job context** (`job-context.ts`): job + current Phase 4 requirement set, latest match, and
   verified Phase 5 research claims (research only adds INFORMATIONAL emphasis; company facts
   never become candidate facts).
2. **Candidate evidence**: usable facts.
3. **Deterministic tailoring** (`tailorDeterministic`): bullets ordered by relevance
   (required hit = 3, preferred = 1, small recency bonus), projects ordered/optionally hidden,
   job-relevant skills first (hidden verified skills shown on balanced/strong), section order by
   emphasis, best stored summary variant. Experience stays reverse-chronological. Every change has a
   reason. Nothing is added.
4. **AI wording** (optional; `resume.tailor` task, **local providers only**): prompt separates
   SYSTEM RULES / `<candidate_facts>` / `<resume_items>` / `<job_data>` (marked untrusted, control
   characters and delimiter tags stripped) / `<task>`. Output must match a **strict** Zod schema.
5. **Claim validation** (`claims.ts`, `applyAiProposals`): unknown item ids or fact refs, or
   rewrites that do not cite a fact the bullet already cites → INVALID. Every number, known
   skill/tool, leadership/seniority wording and named entity must be found in the cited facts
   (+ original wording): SUPPORTED → applied (origin AI_REWRITE); PARTIALLY_SUPPORTED → listed for
   review, not applied; UNSUPPORTED → rejected. Invalid AI output → deterministic result only.
6. Save the version (idempotent: same source hash + job + options → the existing draft), then run the
   Resume Check against the job.

Missing requirements are reported ("not in your verified profile — it will not be added"), never
inserted.

## 4. Resume Check (`check.ts`, `check.service.ts`)

Deterministic findings — PASS · INFO · OPPORTUNITY · WARNING · ISSUE — in STRUCTURE, CONTENT,
READABILITY, FORMATTING (ATS-friendly structure), PROVENANCE and (with a job) ALIGNMENT, each with a
recommendation. Page count comes from the actual PDF. Alignment (`alignment.ts`) classifies each
requirement MATCHED · PARTIALLY_MATCHED · MISSING · UNSUPPORTED · NOT_RELEVANT and job terms the same
way. Missing _preferred_ requirements are INFO, never failures. **No ATS score and no guarantees** —
the UI says so. Checks are cached per content hash + job + checker version.

## 5. Rendering & export

`ResumeDocument → render model (render/layout.ts) → HTML preview | PDF | DOCX`.

- **PDF**: `pdfkit` (server-side, no browser, no paid service), standard fonts, extractable text,
  links, single column, pagination keeps headings with content, page numbers when > 1 page. Non
  Latin-1 characters are transliterated or reported by the Resume Check.
- **DOCX**: `docx` library — real OOXML, styles, bullet numbering, hyperlinks, footer page numbers.
- **Preview**: live HTML preview with the same model/tokens; exact preview =
  `GET /api/v1/resumes/versions/[id]/preview` (the real PDF, inline, not stored).
- **Export pipeline** (`export.service.ts`): content validation → integrity (hash) → provenance
  (no unsupported claims) → render → **render validation** (file signature, parse back with
  `unpdf`/`mammoth`, name/sections/entries present) → private storage
  `{userId}/resumes/{resumeId}/versions/{versionId}/{exportId}.{pdf|docx}` → record. Failures record
  a FAILED export and never mark a file as available. Identical exports are reused.
- **Download**: `GET /api/v1/resumes/exports/[id]/download` → ownership check (service + RLS) →
  60-second signed URL (Supabase) or streamed bytes (local/test storage). Exports whose content hash
  differs from the active approval are labelled.
- File names come from the candidate's profile name (`filename.ts`): ASCII, no separators, bounded.

## 6. Security

- RLS on all 7 tables: owner-only (`user_id = app_current_user_id()`), WITH CHECK that parents
  belong to the caller and target jobs are visible. No DELETE grant on resumes/versions/approvals/
  exports (history is archived).
- Server actions and routes call services that filter by `userId`; ids in URLs are validated.
- AI: personal data only to local providers (router policy); prompt-injection separation; strict
  output schema; claim validation; nothing auto-applied without validation.
- Logs/audit contain ids, counts and hashes — never resume text. Audit actions: `resume_created`,
  `resume_edited`, `resume_version_created`, `resume_restored`, `resume_duplicated`,
  `resume_tailored`, `resume_checked`, `resume_status_changed`, `resume_approved`,
  `resume_approval_revoked`, `resume_archived`, `resume_exported`, `resume_export_failed`, …
- Rendering never uses HTML from content (React text nodes); URLs must be `http(s)`.

## 7. Development

- Run: `npm run dev` → http://localhost:3000/resumes. A master resume needs candidate facts
  (`/candidate`, or import a CV in `/candidate/documents` and approve the extracted facts).
- Tailor: open a job → **Tailor resume** (`/resumes/tailor?job=<id>`).
- AI wording: start Ollama (`OLLAMA_BASE_URL`, `OLLAMA_MODEL`, `AI_ENABLED=true`); without it
  tailoring runs deterministically. No cloud AI is used for resume content.
- Tests: `npx vitest run src/modules/resumes tests/integration/resumes.test.ts` (unit: builder,
  hashing, diff, claims, alignment, tailoring, AI validation, prompt injection, checks, PDF/DOCX
  parse-back, file names; integration: ownership/RLS, autosave conflicts, approval immutability,
  tailoring, AI failure modes, exports, downloads, storage failure).
- Import: existing resumes are imported through Phase 1 document import (PDF/DOCX/TXT → pending
  facts → review → verified), then "Add new facts".

## 8. Known limitations

- The HTML preview marks page heights; exact pagination is the PDF preview.
- PDF standard fonts cover Latin-1; other scripts need the DOCX export.
- Claim validation is lexical (numbers, lexicon skills, leadership words, capitalised names, word
  overlap). Paraphrases can be flagged for review; the candidate decides.
- Gemini or other cloud providers are not used: resume tailoring always contains personal data, and
  the router restricts such tasks to local providers.
