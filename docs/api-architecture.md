# API Architecture

Status: design. Only `GET /api/health` exists in Phase 0.

---

## 1. Transport model

The **service layer is the API**. Three thin transports call it:

| Transport                      | Used for                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Server Components**          | Reads for page rendering (call module services directly on the server).                                                                                                                              |
| **Server Actions**             | Mutations triggered by our own UI (forms, buttons). Return `ActionResult<T>`.                                                                                                                        |
| **Route Handlers** `/api/v1/*` | Anything that needs a stable HTTP contract: client-side data fetching (tables, polling), file uploads, OAuth callbacks, webhooks, the worker's internal callbacks, future public API / integrations. |

No business logic lives in any transport. A transport does: authenticate → parse input with Zod → call service → map result/error.

---

## 2. Conventions

| Topic           | Convention                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| Base path       | `/api/v1`. Breaking changes → `/api/v2`; old version kept until clients migrate.                                  |
| Style           | Resource-oriented REST. Commands that are not CRUD use sub-resources: `POST /applications/:id/transitions`.       |
| Format          | JSON, `camelCase` fields, ISO-8601 UTC timestamps, UUID ids.                                                      |
| Auth            | Session cookie (HttpOnly, Secure, SameSite=Lax). Webhooks use HMAC signatures. No API keys in browser.            |
| Authorization   | Every service call receives `actor { userId, role }`; repositories filter by `userId`. Foreign ids → `404`.       |
| Validation      | Zod schemas in the module's `schemas.ts`, shared by Server Actions, Route Handlers and client forms.              |
| Pagination      | Cursor-based: `?limit=50&cursor=…` → `{ data, nextCursor }`. Max limit 100.                                       |
| Filtering/sort  | Explicit allow-listed params per endpoint (`?status=INTERVIEW&country=DE&sort=-updatedAt`).                       |
| Concurrency     | Mutations on versioned resources require `expectedVersion` (or `If-Match`); mismatch → `409 CONFLICT`.            |
| Idempotency     | `Idempotency-Key` header required on side-effecting POSTs (submit, send). Stored in `outbound_actions`.           |
| Errors          | Envelope `{ error: { code, message, requestId, details? } }` (implemented in `src/server/errors.ts`).             |
| Request ids     | `x-request-id` echoed on every response (implemented in `src/server/http.ts`).                                    |
| Rate limits     | Per user + per IP; `429` with `Retry-After`. Stricter on auth, uploads and AI-triggering endpoints.               |
| Long operations | Return `202 Accepted` + `{ jobId }` / resource with `status: PROCESSING`; client polls or subscribes (SSE later). |

### Response shapes

```ts
type Item<T> = { data: T };
type Page<T> = { data: T[]; nextCursor: string | null };
type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: ErrorCode; message: string; details?: ErrorDetail[] } };
```

---

## 3. Domains and intended contracts

Endpoints listed are the planned surface; they are built in the phase shown.

### `/api/v1/candidate` — Phase 1

| Method & path                                 | Purpose                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /candidate/profile`                      | Full profile with facts + provenance                                                                                                    |
| `PATCH /candidate/profile`                    | Update profile fields                                                                                                                   |
| `GET/POST /candidate/{section}`               | List/create facts (`experiences`, `education`, `skills`, `projects`, `certifications`, `portfolio`, `languages`, `work-authorizations`) |
| `PATCH/DELETE /candidate/{section}/:id`       | Edit (resets to USER_PROVIDED) / soft delete                                                                                            |
| `POST /candidate/facts/:id/verify`            | User verifies a fact → VERIFIED                                                                                                         |
| `POST /candidate/facts/:id/accept` / `reject` | Accept or reject an AI suggestion / extracted fact                                                                                      |
| `GET /candidate/review-queue`                 | Facts in NEEDS_REVIEW / AI_INFERRED                                                                                                     |
| `POST /candidate/imports` (multipart)         | Upload CV → `202` extraction job                                                                                                        |
| `GET/PUT /candidate/preferences`              | Preferences + target locations                                                                                                          |
| `GET /candidate/export`                       | Full data export (JSON) — also under privacy                                                                                            |

### `/api/v1/jobs` — Phases 2–3

| `GET /jobs`                                              | Search catalog: `q`, `country`, `city`, `remote`, `sponsorship`, `postedAfter`, `salaryMin`, cursor |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /jobs/:id`                                          | Canonical job + requirements + sources                                                              |
| `POST /jobs/manual`                                      | Add a job from pasted URL/text (private job)                                                        |
| `GET /jobs/sources` / `POST` / `PATCH /jobs/sources/:id` | Manage sources (admin / user-provided boards)                                                       |
| `POST /jobs/sources/:id/sync`                            | Trigger sync → `202`                                                                                |
| `GET /jobs/sources/:id/runs`                             | Sync history                                                                                        |

### `/api/v1/companies` — Phases 3, 5

`GET /companies`, `GET /companies/:id`, `GET /companies/:id/jobs`, `POST /companies/:id/research` (`202`), `GET /companies/:id/research`, contacts: `GET/POST /companies/:id/contacts`, `PATCH/DELETE /contacts/:id`.

### `/api/v1/matches` — Phase 4

`GET /matches?label=STRONG&country=DE` (ranked list), `GET /matches/:jobId` (dimensions + evidence + eligibility), `POST /matches/recompute` (`202`), `PUT /settings/match-weights`.

### `/api/v1/documents` — Phases 6–7

| `GET /documents?type=&jobId=`                         | List                                                      |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `POST /documents`                                     | Create (manual)                                           |
| `POST /documents/generate`                            | `{ type, jobId, baseDocumentId? }` → `202` generation job |
| `GET /documents/:id/versions` / `GET …/versions/:vid` | History / content                                         |
| `POST /documents/:id/versions`                        | New version from edit (`expectedVersion`)                 |
| `POST /documents/:id/versions/:vid/transitions`       | `{ to: IN_REVIEW                                          | APPROVED | ARCHIVED | DRAFT }` |
| `GET /documents/:id/versions/:vid/diff?against=`      | Structured diff                                           |
| `POST /documents/:id/versions/:vid/export`            | Render PDF/DOCX → signed URL                              |

### `/api/v1/applications` — Phase 8

| `GET /applications?status=&country=`    | Pipeline list / board                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `POST /applications`                    | Add job to pipeline (`409` if duplicate)                                     |
| `GET /applications/:id`                 | Detail + timeline + documents + approvals                                    |
| `POST /applications/:id/transitions`    | `{ to, expectedVersion, note? }` — state machine enforced                    |
| `PUT /applications/:id/documents/:role` | Attach document version                                                      |
| `POST /applications/:id/approvals`      | Request approval (snapshot hashes)                                           |
| `POST /approvals/:id/decision`          | `{ decision: APPROVE                                                         | REJECT }` |
| `POST /applications/:id/submit`         | Execute submission via permitted channel (`Idempotency-Key`, valid approval) |
| `POST /applications/:id/events`         | Notes, interview records                                                     |

### `/api/v1/workflows` & `/api/v1/executions` — Phase 9

`GET/POST /workflows`, `GET/PATCH /workflows/:id` (draft autosave), `POST /workflows/:id/validate`, `POST /workflows/:id/publish` (creates version), `POST /workflows/:id/run` (`202`), `GET /workflows/:id/versions`.
`GET /executions?workflowId=`, `GET /executions/:id` (with node executions), `POST /executions/:id/cancel`, `POST /executions/:id/nodes/:nodeKey/retry`, `POST /executions/:id/resume` (resume token).

### `/api/v1/integrations` — Phases 1 (login), 7/10

`GET /integrations` (connections + scopes + status), `GET /integrations/:provider/connect` (starts OAuth with state + PKCE), `GET /integrations/:provider/callback`, `DELETE /integrations/:id` (revokes at provider + deletes tokens), `POST /webhooks/:provider` (signed).

### `/api/v1/notifications` — Phase 8

`GET /notifications?unread=true`, `POST /notifications/:id/read`, `POST /notifications/read-all`.

### Platform

`GET /health` (✓ Phase 0), `GET /privacy/export`, `POST /privacy/delete-account` (re-auth required), `GET /audit?resourceType=&resourceId=` (own audit trail).
