# System Architecture

Status: **Phase 0 — approved design pending** · Owner: CTO/architecture · Last updated: 2026-09-25

This is the top-level technical source of truth. Domain detail lives in the linked documents.

---

## 1. Principles

1. **Modular monolith.** One deployable codebase, strict internal module boundaries. No microservices until a module has a measured reason to leave (independent scaling, isolation, or team ownership).
2. **Truth over fluency.** The system never presents unverified or AI-inferred information as fact. Every generated artefact is traceable to its sources.
3. **Human in the loop for anything outbound.** Nothing leaves the system (email, application submission) without an explicit, recorded human approval of the exact content.
4. **Legitimate access only.** No CAPTCHA solving, no auth/anti-bot/rate-limit circumvention, ToS respected. Sources that forbid automation are not integrated.
5. **Explainable over opaque.** Matching and eligibility produce dimensions with evidence, not a single magic score.
6. **Build incrementally.** Each phase adds only the tables, packages and code it needs.

---

## 2. Technology stack

| Concern         | Choice                                                                                           | Why / alternatives considered                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node.js ≥ 22 (dev on 24)                                                                         | LTS; native `fetch`, `crypto.randomUUID`, `process.loadEnvFile`.                                                                                                                                                                                                                        |
| Web framework   | **Next.js 16 (App Router)** + React 19                                                           | Server Components keep data access server-side; Route Handlers for HTTP; one codebase for UI + API. A separate backend (NestJS/Fastify) was rejected for now — it doubles deploy surface without a current need. The service layer is framework-agnostic so it can be lifted out later. |
| Language        | TypeScript (strict + `noUncheckedIndexedAccess`)                                                 | Type safety across UI, services, AI contracts.                                                                                                                                                                                                                                          |
| Styling         | Tailwind CSS v4 with semantic design tokens                                                      | CSS-first config, tokens in `globals.css`.                                                                                                                                                                                                                                              |
| UI primitives   | shadcn/ui (added in Phase 1, per component)                                                      | Copy-in Radix-based components; we own the code, no runtime dependency lock-in.                                                                                                                                                                                                         |
| Workflow canvas | React Flow (`@xyflow/react`) — Phase 9                                                           | Mature node-graph editor; used by n8n-like tools.                                                                                                                                                                                                                                       |
| Database        | **PostgreSQL 16+**                                                                               | Relational integrity for a highly relational domain; JSONB for raw payloads/configs; `pgvector` for semantic matching (Phase 4); full-text search for jobs. One database for data **and** job queue.                                                                                    |
| ORM             | **Prisma 7** (`prisma-client` generator, driver adapters)                                        | Typed schema + migrations. Pinned to stable 7.10.0 (the npm `latest` tag currently points at an 8.0 RC). Raw SQL (`$queryRaw`/TypedSQL) allowed for vector and analytics queries.                                                                                                       |
| Validation      | **Zod 4**                                                                                        | One schema language for env, API input, forms and **AI structured output**.                                                                                                                                                                                                             |
| Auth            | **Better Auth** (recommended) — Phase 1                                                          | Auth.js is now maintained by the Better Auth team and new projects are directed to Better Auth. It supports DB sessions, Prisma adapter, OAuth, passkeys, 2FA. _Requires approval — see §12._                                                                                           |
| Background jobs | **pg-boss** on the same Postgres + a worker process — Phase 2                                    | Scraping, AI generation and workflow execution outlive a serverless request. pg-boss gives durable queues, retries, scheduling and singleton jobs without adding Redis. Managed alternatives (Inngest, Trigger.dev) are valid if we prefer zero-ops; _decision requested_.              |
| AI              | Own provider-abstraction layer (see ai-architecture.md)                                          | Provider SDKs sit behind an internal `AiProvider` interface; the model router picks models per task. Vercel AI SDK may be used _inside_ adapters, never leaked to call sites.                                                                                                           |
| Object storage  | S3-compatible (Cloudflare R2 recommended) — Phase 1                                              | CV uploads and generated PDFs. Private bucket, signed URLs, no egress fees on R2.                                                                                                                                                                                                       |
| Testing         | Vitest (unit/integration), Playwright (E2E, Phase 1)                                             | Vitest is fast and ESM-native.                                                                                                                                                                                                                                                          |
| Lint/format     | ESLint 9 flat config (next + typescript) + Prettier                                              | `eslint-config-prettier` removes overlap.                                                                                                                                                                                                                                               |
| Hosting         | Web: Vercel · Worker: container host (Railway/Fly/Render) · DB: managed Postgres (Neon/Supabase) | Vercel is ideal for the Next.js app; the long-running worker needs a persistent process. The whole stack can also run as two containers (web + worker) on a single host. _Decision requested._                                                                                          |

---

## 3. Runtime architecture

```
                         ┌─────────────────────────────┐
                         │            USER             │
                         └──────────────┬──────────────┘
                                        │ HTTPS
                ┌───────────────────────▼────────────────────────┐
                │                 WEB APP (Next.js)               │
                │  React Server Components · Client islands       │
                │  Server Actions (UI mutations)                  │
                │  Route Handlers /api/v1 (REST, webhooks, OAuth) │
                │  proxy.ts (auth gate, request id, headers)      │
                └───────────────────────┬────────────────────────┘
                                        │ in-process calls only
┌───────────────────────────────────────▼───────────────────────────────────────┐
│                       APPLICATION / SERVICE LAYER  (src/modules/*)            │
│                                                                               │
│  identity  candidate  jobs  companies  eligibility  matching  documents       │
│  applications  messaging  workflows  integrations  followups                  │
│  notifications  analytics  audit                                              │
│                                                                               │
│  Each module: service (use cases, authz, invariants) → repository (Prisma)    │
└───────┬───────────────────┬───────────────────┬───────────────────┬───────────┘
        │                   │                   │                   │
┌───────▼───────┐  ┌────────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
│  PLATFORM      │  │   AI PLATFORM    │  │  JOB QUEUE     │  │  INTEGRATIONS  │
│  src/server/*  │  │  src/server/ai   │  │  pg-boss       │  │  adapters      │
│  db, auth,     │  │  AI service →    │  │  (in Postgres) │  │  job sources,  │
│  crypto, log,  │  │  router →        │  │                │  │  Gmail, ATS,   │
│  errors, audit │  │  provider adapter│  │                │  │  storage       │
└───────┬───────┘  └────────┬────────┘  └───────┬────────┘  └───────┬────────┘
        │                   │                   │                   │
        ▼                   ▼                   ▼                   ▼
  ┌───────────┐     ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │PostgreSQL │     │ AI providers │    │ WORKER proc. │    │ External APIs│
  │+ pgvector │     │ (A / B / C)  │    │ same codebase│    │ (permitted)  │
  └───────────┘     └──────────────┘    └──────────────┘    └──────────────┘
```

**Two processes, one codebase.** The **web** process serves UI and API. The **worker** process (added in Phase 2, entry `src/worker/index.ts`) consumes the queue: source syncs, AI generations, workflow node execution, follow-up scheduling. Both import the same modules; neither calls the other over HTTP — they communicate through the database and queue.

### Request flow (synchronous)

`Browser → proxy.ts (session check, request id) → Server Component / Server Action / Route Handler → module service (authz + validation + invariants) → repository (userId-scoped Prisma) → Postgres`, with an audit entry written in the same transaction for state-changing operations.

### Long-running flow (asynchronous)

`Service enqueues job (in the same DB transaction as the triggering write — transactional outbox via pg-boss) → worker picks it up → service method executes → results persisted → notification emitted → UI refreshes (polling or SSE, Phase 8+)`.

---

## 4. Module boundaries

| Module          | Owns (tables)                                                      | May call                                   |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------ |
| `identity`      | users, sessions, accounts, user_settings                           | audit                                      |
| `candidate`     | candidate\_\* tables                                               | audit, ai                                  |
| `jobs`          | job_sources, raw_job_postings, jobs, job_requirements, job_skills  | companies, ai, audit                       |
| `companies`     | companies, company_research, contacts                              | ai, audit                                  |
| `eligibility`   | eligibility_rules, eligibility_assessments                         | candidate, jobs                            |
| `matching`      | job_matches, job_match_dimensions                                  | candidate, jobs, eligibility, ai           |
| `documents`     | documents, document_versions                                       | candidate, jobs, companies, ai, audit      |
| `applications`  | applications, application_events, approvals, application_answers   | documents, messaging, notifications, audit |
| `messaging`     | messages, email_threads                                            | integrations, audit                        |
| `workflows`     | workflows, workflow_versions, workflow_executions, node_executions | every module's public API (as node impls)  |
| `integrations`  | integration_connections, oauth_tokens                              | audit                                      |
| `followups`     | followups                                                          | applications, messaging, notifications     |
| `notifications` | notifications                                                      | —                                          |
| `analytics`     | read-only views / materialised views                               | reads others' tables via SQL views only    |
| `audit`         | audit_logs                                                         | —                                          |

Rules: modules expose a public `index.ts`; a module never reads another module's tables directly (analytics views are the one documented exception). Dependency direction is enforced in code review; an ESLint boundary rule can be added once more than three modules exist.

---

## 5. Directory structure

```
/
├── docs/                    Technical source of truth (this folder)
├── prisma/
│   ├── schema.prisma        Data model; grows per phase through migrations
│   └── migrations/          Generated, reviewed, committed (from Phase 1)
├── public/                  Static assets served as-is
├── src/
│   ├── app/                 Next.js routes ONLY: pages, layouts, route handlers. Thin — no business logic.
│   │   └── api/health/      Liveness probe (Phase 0)
│   ├── components/          Shared presentational UI (Phase 1+): ui/ (shadcn primitives), layout/, data/
│   ├── config/              Typed configuration: env validation (env.ts), static app config
│   ├── lib/                 Isomorphic pure utilities (no secrets, no DB, safe for client bundles)
│   ├── modules/             Domain modules — the product systems (see modules/README.md)
│   ├── server/              Server-only platform code: errors, logger, http wrapper; later db, auth, crypto, ai/, queue
│   ├── worker/              Background worker entry point (Phase 2)
│   └── generated/           Prisma client output (git-ignored)
└── tests/
    ├── stubs/               Test doubles for runtime-only packages
    ├── integration/         DB-backed tests (Phase 1)
    └── e2e/                 Playwright specs (Phase 1)
```

Why not top-level `/services`, `/db`, `/types`, `/hooks`?

- **services / db** → inside each module (`service.ts`, `repository.ts`). A global `services/` folder becomes a dumping ground and erodes module boundaries.
- **types** → types live next to the code that owns them. `src/types` is created only if global ambient declarations are needed.
- **hooks** → colocated with the feature that uses them; a shared `src/hooks/` is created when the first hook is reused by two features.

Unit tests are colocated (`*.test.ts`); cross-module and E2E tests live under `/tests`.

---

## 6. Background processing

- **Queue:** pg-boss (Postgres). Queues per concern: `source-sync`, `ai-generation`, `workflow-node`, `followup-scheduler`, `maintenance`.
- **Idempotency:** every job carries an idempotency key; handlers are safe to re-run. Outbound side effects (email send, application submit) additionally check a unique `(action, idempotency_key)` record before acting.
- **Scheduling:** pg-boss cron for source syncs and follow-up scans; per-user schedules stored in DB.
- **Concurrency limits:** per-queue and per-source (respect provider rate limits).
- **Dead letters:** failed-after-retries jobs land in a dead-letter queue surfaced in Settings → System.

---

## 7. Observability

| Log category  | Examples                                                    | Retention (target) |
| ------------- | ----------------------------------------------------------- | ------------------ |
| `app`         | request failures, slow requests                             | 14 days            |
| `ai`          | model, prompt version, tokens, cost, latency, schema errors | 30 days (metadata) |
| `workflow`    | execution / node transitions, retries                       | 30 days            |
| `integration` | source syncs, OAuth refreshes, provider errors              | 30 days            |
| `database`    | query errors, migration runs, slow queries                  | 14 days            |
| `audit`       | who did what to which resource (stored in DB, not logs)     | life of account    |

- **Structured JSON logs** via `src/server/logger.ts` (implemented). Secrets are redacted by key name before serialisation.
- **Correlation:** `x-request-id` is minted or propagated by `route()` (implemented) and will be set in `proxy.ts`; it is attached to every log line, enqueued job (`traceId`), AI generation and audit entry, so one user action can be traced end-to-end across web → queue → worker → provider.
- **Tracing/metrics:** OpenTelemetry via Next.js `instrumentation.ts` when a backend (e.g. Grafana/Honeycomb/Sentry) is chosen — Phase 8. Error reporting (Sentry or equivalent) added in Phase 1.
- **Durable operational records** (AI generations, workflow executions, source runs) are stored in DB tables, not only logs — they are product data the user can inspect.

---

## 8. Error architecture

Implemented in `src/server/errors.ts` and `src/server/http.ts`.

| Code                     | HTTP | Retryable default | Typical source                               |
| ------------------------ | ---- | ----------------- | -------------------------------------------- |
| `VALIDATION_ERROR`       | 400  | no                | Zod parse of input / AI output               |
| `AUTH_ERROR`             | 401  | no                | missing/expired session                      |
| `PERMISSION_ERROR`       | 403  | no                | resource not owned by user                   |
| `NOT_FOUND`              | 404  | no                | missing resource (also used to hide others') |
| `CONFLICT`               | 409  | no                | invalid state transition, optimistic lock    |
| `RATE_LIMIT_ERROR`       | 429  | yes (after delay) | our limiter or upstream 429                  |
| `DATABASE_ERROR`         | 500  | sometimes         | Prisma errors (mapped by code)               |
| `AI_ERROR`               | 502  | yes               | provider failure, schema-invalid output      |
| `INTEGRATION_ERROR`      | 502  | depends           | OAuth/provider API errors                    |
| `EXTERNAL_SERVICE_ERROR` | 503  | yes               | upstream down/timeouts                       |
| `WORKFLOW_ERROR`         | 500  | per node policy   | execution engine                             |
| `UNKNOWN_ERROR`          | 500  | no                | anything unmapped                            |

`NOT_FOUND` and `CONFLICT` are additions to the requested list — they are needed to express ownership-hiding and state-machine violations cleanly.

- **Envelope:** `{ "error": { "code", "message", "requestId", "details?" } }`. `message` is always the safe public message; internals go to logs only.
- **Ownership hiding:** accessing another user's resource returns `NOT_FOUND`, not `PERMISSION_ERROR`, to avoid confirming existence.
- **Server Actions** return a discriminated union `{ ok: true, data } | { ok: false, error: { code, message, details } }` instead of throwing to the client.
- **Workers** record `error_code`, `error_message` (internal) and `retryable` on the job/execution row.

---

## 9. Environment strategy

| Environment   | Purpose                  | Database                               | AI keys                     | Outbound email/submission  |
| ------------- | ------------------------ | -------------------------------------- | --------------------------- | -------------------------- |
| `development` | local                    | local Postgres (Docker) or Neon branch | developer's own, low budget | **disabled** (logged only) |
| `staging`     | pre-release verification | separate managed DB, synthetic data    | separate keys, capped       | sandbox / allow-list only  |
| `production`  | real use                 | managed Postgres, PITR backups         | production keys             | enabled, approval-gated    |

- `APP_ENV` (not `NODE_ENV`) selects behaviour; `NODE_ENV` stays a build concern.
- All variables are validated at startup by `src/config/env.ts` (implemented); invalid config fails fast and reports key names only.
- Secrets live in the host's secret store (Vercel env, container host secrets). `.env` is git-ignored; `.env.example` holds placeholders only.
- Production data is never copied to development. Staging uses synthetic candidates.

---

## 10. Testing strategy

| Layer         | Tool                                                                | Scope                                                                                         | Phase |
| ------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----- |
| Unit          | Vitest                                                              | pure logic: state machines, normalisers, dedupe fingerprints, scoring, redaction, env         | 0+    |
| Database      | Vitest + disposable Postgres (Docker/Testcontainers or Neon branch) | repositories, constraints, migrations, userId scoping                                         | 1     |
| Integration   | Vitest                                                              | service + DB + fake providers (AI, source adapters, email)                                    | 1     |
| API           | Vitest calling route handlers                                       | auth, validation, error envelope, ownership                                                   | 1     |
| AI schema     | Vitest + recorded fixtures                                          | prompt output parses against Zod contracts; grounding checks (no unsupported claims)          | 1     |
| AI evaluation | offline eval suite                                                  | quality regression per prompt version on a fixed dataset; runs on prompt change, not every PR | 6     |
| Workflow      | Vitest                                                              | graph validation, execution ordering, pause/resume/retry, idempotency                         | 9     |
| E2E           | Playwright                                                          | critical journeys (sign-in, profile, approve & submit)                                        | 1     |
| Security      | Vitest + CI scanners                                                | authz matrix (every endpoint × foreign user), `npm audit`, secret scanning, headers           | 1     |

Principles: no network in unit/integration tests (adapters are faked); AI calls in CI use recorded fixtures; every bug fix adds a regression test; `npm run check` must pass before merge.

---

## 11. Deployment & CI (planned)

- **CI (GitHub Actions):** install → `typecheck` → `lint` → `format:check` → `test` → `build`; integration tests against a service Postgres container; `prisma migrate diff` check that the schema and migrations agree.
- **Migrations:** `prisma migrate deploy` runs as a release step before the new web/worker version receives traffic; expand/contract pattern for breaking changes.
- **Backups:** managed Postgres with point-in-time recovery; object storage versioning on.

---

## 12. Architecture decision log

| #   | Decision                                                                                                                                         | Status       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 1   | Modular monolith on Next.js 16 App Router                                                                                                        | Adopted      |
| 2   | PostgreSQL + Prisma 7 (pinned stable); raw SQL allowed for vector/analytics                                                                      | Adopted      |
| 3   | `src/modules/*` domain modules with service/repository split                                                                                     | Adopted      |
| 4   | UUIDv7 primary keys                                                                                                                              | Adopted      |
| 5   | Every user-owned row carries `user_id`; multi-user capable from day one                                                                          | Adopted (P1) |
| 6   | Better Auth instead of Auth.js                                                                                                                   | Adopted (P1) |
| 7   | pg-boss queue + separate worker process (vs managed Inngest/Trigger.dev)                                                                         | Proposed     |
| 8   | Workflow graphs stored as versioned, validated JSON documents                                                                                    | Proposed     |
| 9   | Own AI abstraction; **local Ollama is the default provider** (free-first); cloud providers optional later                                        | Adopted (P1) |
| 10  | pgvector for semantic matching (Phase 4)                                                                                                         | Proposed     |
| 11  | ~~Cloudflare R2~~ → **Supabase Storage** (private bucket, service role server-side)                                                              | Adopted (P1) |
| 12  | Web on Vercel, worker on a container host                                                                                                        | Proposed     |
| 13  | **Supabase (project JOBHUNTOS)** is the Postgres + Storage backend; Prisma connects directly; Better Auth (not Supabase Auth) handles sessions   | Adopted (P1) |
| 14  | RLS enforced for the app via `SET LOCAL ROLE jobhunt_app` + `app.current_user_id` per transaction (`withUserContext`); Supabase API roles denied | Adopted (P1) |
| 15  | Phase 1 background processing uses Next.js `after()` (free, no worker); a queue arrives in Phase 2                                               | Adopted (P1) |
| 16  | Candidate fact dates stored as partial dates (`YYYY` / `YYYY-MM`) — months are never invented                                                    | Adopted (P1) |
| 17  | Free-first rule: no paid service is required to run the product through Phase 1                                                                  | Adopted (P1) |
