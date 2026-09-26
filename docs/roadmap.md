# Development Roadmap

Each phase ends with a review and **explicit approval** before the next begins. A phase adds only the tables, packages and code it needs.

| Phase | Name                        | Depends on |
| ----- | --------------------------- | ---------- |
| 0     | Architecture                | —          |
| 1     | Candidate Intelligence      | 0          |
| 2     | Job Discovery               | 1          |
| 3     | Job Database                | 2          |
| 4     | Matching Engine             | 1, 3       |
| 5     | Company + Job Research      | 3          |
| 6     | Resume Studio               | 1, 4       |
| 7     | Email + Cover Letter Studio | 5, 6       |
| 8     | Application System          | 6, 7       |
| 9     | Workflow Builder            | 2–8        |
| 10    | External Integrations       | 7, 8       |
| 11    | Follow-up Engine            | 8, 10      |
| 12    | Analytics                   | 8          |
| 13    | Production Automation       | 9–12       |

---

## Phase 0 — Architecture ✅

- **Objective:** technical foundation and source-of-truth documentation.
- **Dependencies:** none.
- **Inputs:** product brief.
- **Outputs:** initialised Next.js/TypeScript project, lint/format/test tooling, env validation, error/logging/request-id primitives, health route, design tokens, docs set.
- **Success criteria:** `npm run check` and `npm run build` pass; all docs exist and are approved.
- **Not included:** any product feature, DB models, auth, AI calls, UI shell.

## Phase 1 — Candidate Intelligence ✅ (awaiting approval — see candidate-intelligence.md)

> As built: Supabase (Postgres + Storage), Better Auth, optional local Ollama. Changes vs. the original plan: no paid AI, no R2, no Playwright suite yet (an HTTP-level end-to-end check plus integration tests instead).

- **Objective:** a trustworthy, verifiable candidate knowledge base.
- **Dependencies:** Phase 0; decisions on auth, hosting, DB provider, storage.
- **Inputs:** user's CV(s), manual entries.
- **Outputs:** auth (Better Auth) + app shell + settings skeleton; Prisma models for identity, candidate, files, skills, countries, ai_generations, audit_logs; migrations; CV upload + text extraction; AI platform (service, router, Anthropic adapter, budgets, logging); Candidate Agent extraction into NEEDS_REVIEW; review queue; profile editor for every section with provenance badges; preferences & target locations; data export; Playwright + DB test harness; CI.
- **Success criteria:** a user can upload a CV, review every extracted fact, and end with a complete profile where each fact has correct provenance; AI can never set VERIFIED (tested); authz matrix passes; export returns all data.
- **Not included:** jobs, matching, document generation, Gmail, workflows.

## Phase 2 — Job Discovery ✅ (awaiting approval — see job-discovery.md §10)

> As built: Search Profiles + discovery UI, public ATS adapters (Ashby, Lever, Greenhouse) + Manual, in-process runs via `after()` with a secret-protected cron endpoint and a local scheduler (no pg-boss worker), source health with auto-pause. One criterion needs a week of real-world observation (§10 #13).

- **Objective:** ingest jobs from legitimate sources reliably.
- **Dependencies:** Phase 1 (auth, DB, worker infra decision).
- **Inputs:** approved source list with ToS review; target countries.
- **Outputs:** worker process + pg-boss; source registry; 2–4 public ATS adapters + manual job entry; raw posting store; sync scheduling, rate limiting, source health, run history.
- **Success criteria:** scheduled syncs run unattended for a week with per-source health visible; re-runs are idempotent; zero ToS-violating access.
- **Not included:** AI enrichment, matching, search UI polish.
- **Scope update (2026-09-26):** India as a first-class market, configurable locations/categories/search terms, user-owned Search Profiles driving discovery, multi-layer dedupe. See [job-discovery.md](./job-discovery.md).

## Phase 3 — Job Database ✅ (awaiting approval — see job-search.md)

> As built: server-side full-text search + filters (country, city/region, category, work mode, employment type, experience level, salary without currency conversion, source, status, freshness, search profile), allowlisted sorting, pagination, saved searches, bookmarks and hidden jobs. Canonical jobs, dedupe and rule classification were delivered in Phase 2. Not built here: Job Analysis Agent (AI requirement extraction) and a labelled duplicate-rate study.

- **Objective:** a clean, searchable canonical job catalog.
- **Dependencies:** Phase 2.
- **Inputs:** raw postings.
- **Outputs:** normalisers, canonical jobs, company resolution, dedupe (fingerprint + near-duplicate), closure detection, Job Analysis Agent (requirements, skills, salary, languages, sponsorship text), full-text search, Jobs list/detail UI with filters (country, city, remote, salary, sponsorship signal).
- **Success criteria:** duplicate rate < 2% on a labelled sample; requirement extraction precision agreed on a test set; search < 300 ms p95.
- **Not included:** candidate matching, eligibility verdicts, research.

## Phase 4 — Matching Engine

> **Status: complete (CP1–CP7).** Implementation details and rules: [matching.md](matching.md).
> Deviations from the original plan: no embeddings/pgvector (deterministic lexicon + optional local
> AI RELATED suggestions instead), no numeric ranking (documented status categories only), matching
> weights replaced by explicit "mandatory preference" switches.

- **Objective:** explainable job-to-candidate matching including eligibility signals.
- **Dependencies:** Phases 1, 3.
- **Inputs:** candidate facts, canonical jobs, eligibility rules (seeded for initial countries, sourced and dated).
- **Outputs:** skill taxonomy + embeddings (pgvector), dimension matchers, eligibility engine + rule catalog admin, Matching & Eligibility agents, match list and match breakdown UI, user weights, recompute on change.
- **Success criteria:** every match shows per-dimension status with evidence; hard gates produce BLOCKED; AI_INFERRED facts never count as matches; users agree with top-10 ranking in qualitative review.
- **Not included:** immigration advice, document generation, applying.

## Phase 5 — Company + Job Research

- **Objective:** cited company research to inform tailoring.
- **Dependencies:** Phase 3.
- **Inputs:** companies, jobs, permitted web sources.
- **Outputs:** guarded research fetcher (robots, allow-list, SSRF protection), Company Research Agent, research snapshots with citations and staleness, company pages, contacts CRUD (user-entered).
- **Success criteria:** every finding has a source URL and retrieval date; no uncited claims shown; stale research flagged.
- **Not included:** contact scraping/enrichment, outreach.

## Phase 6 — Resume Studio

- **Objective:** grounded, versioned, job-specific resumes.
- **Dependencies:** Phases 1, 4.
- **Inputs:** verified candidate facts, master resume, job requirements, match evidence.
- **Outputs:** document + version model, master resume editor, Resume Agent, Quality Control Agent + deterministic grounding checks, version diff, approval flow, PDF/DOCX rendering, AI eval suite.
- **Success criteria:** 0 ungrounded claims in the eval set; every bullet links to facts; approved versions are immutable.
- **Not included:** cover letters, emails, sending.

## Phase 7 — Email + Cover Letter Studio

- **Objective:** grounded cover letters, recruiter emails and application answers.
- **Dependencies:** Phases 5, 6.
- **Inputs:** facts, research, contacts, job, application questions.
- **Outputs:** Cover Letter, Email and Application Answer agents; message drafts; answer documents with sensitive-question flagging; studio UI.
- **Success criteria:** same grounding bar as Phase 6; legal/EEO questions are never auto-answered.
- **Not included:** actually sending email (Phase 10), submissions.

## Phase 8 — Application System

- **Objective:** the tracked, approval-gated application lifecycle.
- **Dependencies:** Phases 6, 7.
- **Inputs:** jobs, documents, messages.
- **Outputs:** applications + events + approvals + outbound_actions; state machine with exhaustive tests; board/table UI; application detail timeline; approval panel; manual submission tracking ("I submitted on the portal") and email-channel preparation; notifications.
- **Success criteria:** impossible transitions rejected (tested for all pairs); no path to SUBMITTED without a valid approval; duplicate applications blocked.
- **Not included:** automated portal submission, email sending, workflows.

## Phase 9 — Workflow Builder (n8n-style)

- **Objective:** user-defined automations over existing capabilities.
- **Dependencies:** Phases 2–8 (nodes wrap their services).
- **Inputs:** node registry built from module services.
- **Outputs:** workflow definition schema + validator, versions, execution engine (queue-driven, pause/resume/cancel/retry), React Flow canvas, execution viewer, templates (e.g. "new DE jobs → match → draft resume → ask approval").
- **Success criteria:** crash-safe executions (kill worker mid-run → resumes correctly); side-effect nodes impossible without upstream approval; execution history fully inspectable.
- **Not included:** third-party app nodes beyond our own integrations, public webhooks marketplace.

## Phase 10 — External Integrations

- **Objective:** connect external accounts through official APIs.
- **Dependencies:** Phases 7, 8.
- **Inputs:** OAuth apps (Google, possibly Microsoft); approved ATS/partner APIs.
- **Outputs:** integration connections with encrypted tokens, Gmail send/read (thread linking, reply detection), calendar interview detection (optional), official ATS apply APIs where available, webhooks.
- **Success criteria:** Google OAuth verification path started/passed for restricted scopes; token refresh/revocation robust; sends are approval-bound and idempotent.
- **Not included:** browser automation of portals, any password-based integration.

## Phase 11 — Follow-up Engine

- **Objective:** timely, appropriate follow-ups.
- **Dependencies:** Phases 8, 10.
- **Inputs:** application timelines, message threads, cadence rules.
- **Outputs:** cadence rules, follow-up scheduler, reply-aware cancellation, Follow-up Agent drafts, due/overdue views.
- **Success criteria:** no follow-up after a reply/rejection (tested); configurable cadence per country.
- **Not included:** unapproved automatic sending.

## Phase 12 — Analytics

- **Objective:** understand what works.
- **Dependencies:** Phase 8 (Phase 11 enriches it).
- **Inputs:** events, applications, sources, matches.
- **Outputs:** materialised views, dashboard (funnel, conversions, countries, sources, follow-ups), exports.
- **Success criteria:** dashboard numbers reconcile with raw data; loads < 1 s.
- **Not included:** predictive models.

## Phase 13 — Production Automation

- **Objective:** run safely at scale, unattended where allowed.
- **Dependencies:** Phases 9–12.
- **Inputs:** production workloads.
- **Outputs:** OpenTelemetry tracing, alerting, SLOs, backups/restore drills, cost dashboards, load tests, security review/pen test, runbooks, scheduled workflows at scale with safety caps.
- **Success criteria:** restore drill passes; alerting on source/AI/workflow failures; pen-test findings resolved.
- **Not included:** removing human approval for outbound actions.
