# JOBHUNT OS — Project Status

Single handover record of the **verified** state. Update it at the end of every phase.
Plan and phase definitions: [docs/roadmap.md](docs/roadmap.md). Technical detail: [docs/](docs/README.md).

## Last synchronized

**2026-09-26** — AI provider/orchestration layer complete (Ollama + optional Gemini, privacy routing, `/settings/ai`); lint fixed and full suite green. Earlier: Phase 6 (Resume Studio) built and migrated.

| Item                | State                                                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current phase       | **Phase 6 — Resume Studio: built, awaiting approval**                                                                                                                           |
| Completed phases    | 0, 1, 2, 3, 4, 5                                                                                                                                                                |
| Partially completed | none                                                                                                                                                                            |
| Git                 | `main` = `origin/main`; Cloud branch `claude/jobhunt-os-phase2-iihr1l` points at the same commit                                                                                |
| Supabase project    | **JOBHUNTOS**, ref `vrgtvlwxxgfseniqtgmx` (only environment; direct connection on :5432)                                                                                        |
| Migrations          | 12 in the repo, all applied on JOBHUNTOS (latest `20261015000000_advisor_fixes`)                                                                                                |
| Schema drift        | none — the only Prisma diff is `jobs.search_vector` (generated tsvector + GIN index, intentionally hand-written SQL, modelled as `Unsupported`)                                 |
| AI                  | Orchestrated: Ollama `qwen3.5:9b` (local, default) + optional Gemini `gemini-3.8-flash`; private data local unless operator switch + user opt-in (`docs/ai-architecture.md` §0) |

## Phase state (verified)

| Phase | State    | Evidence                                                                                                                                                           |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | Complete | modular monolith, `docs/`, env contract, RLS model, error/route helpers                                                                                            |
| 1     | Complete | candidate facts + provenance, CV import (PDF/DOCX/TXT), review queue, documents in private storage                                                                 |
| 2     | Complete | Ashby/Lever/Greenhouse adapters, Search Profiles, discovery runs, 3-layer dedupe, source health, scheduler (acceptance: `docs/job-discovery.md` §10)               |
| 3     | Complete | server-side `/jobs` search (tsvector), filters, sorting, saved searches, bookmarks/hidden (`docs/job-search.md`)                                                   |
| 4     | Complete | versioned requirement sets, deterministic evidence-first engine, history, batches, optional AI assist (`docs/matching.md`)                                         |
| 5     | Complete | SSRF-safe research fetcher with robots.txt, claims with evidence, company resolution, exports (`docs/research.md`)                                                 |
| 6     | Built    | Resume Studio: versions + content hash, editor, tailoring + claim validation, Resume Check, approval, PDF/DOCX export (`docs/resume-studio.md`); awaiting approval |

| AI | Complete | Provider registry, task registry + sensitivity, privacy routing, orchestrator (`runAiTask`) used by all 4 AI call sites, `/settings/ai`; real tests passed with `qwen3.5:9b` and `gemini-3.8-flash` |

## Database (JOBHUNTOS, verified live)

- 64 tables, **RLS enabled on all**; 0 grants to `anon` / `authenticated`.
- Supabase advisor lints (re-checked 2026-09-26 with read-only catalog queries — the Supabase MCP was not available in the session): security and performance findings **all resolved** by `20261015000000_advisor_fixes` (32 FK indexes, pinned trigger `search_path`, no multiple permissive policies); guarded by `tests/integration/advisors.test.ts`.
- App role `jobhunt_app`: NOLOGIN, NOBYPASSRLS; every user-owned table has an owner policy
  `user_id = app_current_user_id()`. Shared catalog tables (jobs, companies, postings, requirement sets)
  follow job visibility. Better Auth tables have no app policies (owner client only).
- 97 CHECK constraints. Functions: `app_current_user_id` (project), `rls_auto_enable` (Supabase platform
  `ensure_rls` event trigger — compatible, not managed by this repo). One trigger: `resume_versions_protect_approved` (approved resume content is immutable). No `pg_cron`.
- Storage: bucket `candidate-documents` — **private**, 10 MB limit, no public policies (server uses the
  service role and short-lived signed URLs).
- Real data present (preserve it): 3 users, 1,721 jobs (all PUBLIC catalog), 1,721 source postings,
  2,735 job requirements, 45 matches, 2 search profiles, 5 discovery runs, 39 sync runs, 1 candidate profile,
  1 stored document, 106 audit records. Research tables are empty (not run on real data yet).

## Scheduling

Discovery schedules run through `POST /api/internal/cron/discovery` (requires `CRON_SECRET`) or the local
`npm run scheduler`. Supabase `pg_cron` is documented as optional and is **not** enabled.

## Environment

Required and set: `DATABASE_URL`, `DIRECT_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ENCRYPTION_KEY`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `CRON_SECRET`.
Optional, unset: `SEARXNG_URL` (research web search; without it the company website is confirmed once by the
user), `GOOGLE_CLIENT_ID/SECRET`, `CRON_MAX_PROFILES`, `RESEARCH_*` limits (defaults apply).
Only `NEXT_PUBLIC_APP_URL` is client-exposed (not a secret). All server config is read via `src/config/env.ts`.

## Validation (2026-09-26, after the AI orchestration fix-up)

| Command                               | Result                                                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                       | pass — typecheck, lint, format, **476 tests passed, 3 skipped** (37 files)                                                                |
| `npm run build`                       | pass                                                                                                                                      |
| `REAL_AI=1 npx vitest run tests/real` | passed on the local machine (Ollama `qwen3.5:9b`, Gemini `gemini-3.8-flash`); skipped where no `.env`/providers exist (e.g. Claude Cloud) |

## Fixed during the real-data run (2026-09-26)

- **CV AI extraction truncated:** Ollama used its default 4096-token context, cutting long JSON (a full CV) at ~2.8k output tokens → `SCHEMA_INVALID`. Now each request sets `num_ctx` (prompt estimate + output budget, capped by `OLLAMA_NUM_CTX`, default 16384), truncation (`done_reason=length`) is reported as an output-limit failure, and CV extraction / resume tailoring have 300 s timeouts. Real CV: 45 facts extracted locally (7,240 output tokens).
- **Cloud redaction corrupted fact references:** the phone-number pattern could match digit-only UUID groups in `<kind>:<uuid>` references. UUIDs are now shielded before redaction (regression test added).
- **Tailor page never showed results after long AI calls:** an idle pooled DB connection was closed by the server during the 60–100 s local AI call; the re-render used the dead connection (`Connection terminated unexpectedly`). The runtime pool now retires idle connections (30 s) with TCP keep-alive, and `withUserContext` retries once on a fresh connection when a transaction fails before any work ran (never after — no repeated side effects). Tests: `src/server/db.test.ts`.
- **Confirmed skills landed in the wrong resume group:** confirming a job skill saved it with no category and tailoring put newly shown skills into the first group (React under "AI"). Confirmed skills now get a deterministic category from the skill lexicon (`skill-category.ts`) and tailoring places each skill in its own category group ("Web").
- **Real run (owais):** CV → 45 facts approved → master resume → 6 job skills confirmed by the user → tailored for Sarvam "Frontend Engineer, Chanakya": readiness passes, Resume Check 11 passed / 0 issues; AI proposals that claimed React work or copied job wording were rejected by claim validation.

## Known issues

- **Windows line endings (fixed in re-sync):** `core.autocrlf=true` checked files out as CRLF and
  `format:check` failed on 137 files. `.gitattributes` now forces LF; no content changed.
- Gemini may return temporary 503 "high demand"; shown as "busy, try again", never retried in a loop.
- The signed-in `owais` account has no candidate profile or facts yet, so matching shows "Complete your
  candidate profile" and Resume Studio asks for the profile first (it builds resumes only from real facts). The existing matches belong to another account (per-user isolation working as designed).
- Documented limitations: `docs/matching.md` and `docs/research.md` → "Known limitations"
  (in-process batches/rate limits, no headless browser for research).

## Next phase

**Phase 7 — Email & Cover Letter Studio** (after Phase 6 approval). Consumes `TAILOR_RESUME`
(`src/modules/resumes/tailor.service.ts`) and approved resume versions (content hash).
