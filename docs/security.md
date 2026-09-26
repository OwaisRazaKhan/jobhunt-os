# Security & Privacy Architecture

Status: design. Phase 0 implements: env validation that never echoes values, secret redaction in logs, a uniform error envelope that hides internals, request ids, `.env` git-ignored.

JOBHUNT OS will hold CVs, employment history, work-authorization status, email access and recruiter contacts. Treat all of it as sensitive personal data (GDPR applies — the target markets are largely EU).

---

## 1. Threat model (summary)

| Threat                                                      | Primary controls                                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Account takeover                                            | Strong auth, rate-limited login, optional passkeys/2FA, session revocation                                                    |
| Cross-user data access (IDOR)                               | `userId` on every row + repository scoping + authz tests per endpoint                                                         |
| Token theft (Gmail etc.)                                    | Encrypted at rest, minimal scopes, server-only, revocation                                                                    |
| Prompt injection via job posts / emails / web pages         | Untrusted-content delimiting, no side-effect tools for agents reading untrusted text, human approval for all outbound actions |
| Unintended outbound actions (mass email, wrong application) | Approval bound to content hash, idempotency ledger, per-day send caps                                                         |
| Malicious file upload                                       | Type allow-list, size limit, content sniffing, isolated parsing, private storage                                              |
| Secret leakage                                              | Server-only env, no `NEXT_PUBLIC_` secrets, log redaction, secret scanning in CI                                              |
| Supply chain                                                | Lockfile, minimal deps, `npm audit`, Dependabot/Renovate, install-script allow-list                                           |
| SSRF (user-supplied job URLs, research fetcher)             | URL allow-list/validation, block private IP ranges, no redirects to internal hosts                                            |

---

## 2. Authentication

- Library: **Better Auth** (proposed) with database sessions (Prisma adapter). Sign-in methods: Google OAuth and email magic link / passkeys; email+password optional (argon2id/scrypt hashes, breached-password check).
- Sessions: opaque random tokens in `HttpOnly; Secure; SameSite=Lax` cookies, `__Host-` prefix, rolling expiry (7 days idle, 30 days absolute), rotated on privilege change, revocable per device from Settings.
- Re-authentication required for: account deletion, data export, connecting/disconnecting integrations, changing sign-in methods.
- Login, magic-link and password-reset endpoints are rate limited per IP and per account.

## 3. Authorization

- Single-tenant-per-user model: resources belong to exactly one `user_id`. Roles: `USER`, `ADMIN` (admin manages global catalog: sources, eligibility rules, countries).
- Enforcement point: **module services** receive an `Actor` and repositories always filter by `actor.userId`. `proxy.ts` only does coarse "is signed in" gating — never the sole check.
- Foreign resource ids return `404` (no existence leak).
- Automated authorization test matrix: for every endpoint/action, a request as user B against user A's resource must fail.
- Workflows execute with the owner's identity and only the permissions their node types declare.

### Row Level Security (Phase 1)

- RLS is enabled on every table. Tables are owned by the migration user (`postgres`), which is used only by Better Auth, migrations and privileged maintenance.
- All candidate data access goes through `withUserContext(userId, fn)` in `src/server/db.ts`. It opens a transaction, runs `set_config('app.current_user_id', …, true)` and `SET LOCAL ROLE jobhunt_app`. The `jobhunt_app` role is `NOLOGIN NOBYPASSRLS`, and its policies allow only rows where `user_id = app_current_user_id()`. `audit_logs` is SELECT/INSERT only.
- Services still filter by `userId` explicitly (defence in depth). Foreign ids return `NOT_FOUND`.
- The Supabase `anon` and `authenticated` roles have every table privilege revoked (including default privileges), so the Supabase Data API exposes nothing.
- Supabase Storage uses a private bucket with no storage policies; only the server's service-role key can reach objects.
- `tests/integration/isolation.test.ts` runs the real migration on PGlite and proves isolation at both the service layer and the RLS layer.

## 4. OAuth security (integrations)

- Authorization Code flow with **PKCE** and a signed, single-use `state` bound to the session; strict redirect URI allow-list.
- **Least privilege & incremental consent:** login requests only `openid email profile`. Gmail scopes are requested separately and only when the user enables email features (prefer `gmail.send` + `gmail.readonly`/metadata scoped as narrowly as the feature allows). Google's restricted-scope verification/security assessment is a known requirement before public launch.
- Tokens: access and refresh tokens encrypted with AES-256-GCM (app-level envelope encryption, key version stored per row), never sent to the browser, never logged.
- Refresh failures mark the connection `NEEDS_REAUTH` and notify the user; revoked tokens are deleted.
- Disconnect = revoke at provider + delete tokens + audit entry.
- **We never ask for or store third-party passwords** (job portals, email, ATS). Where a portal has no API, the user submits manually using prepared materials.

## 5. Secret management

| Secret kind                                          | Where it lives                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| App secrets (auth, encryption keys, DB URL, AI keys) | Host secret store (Vercel / container host env); `.env` locally, git-ignored |
| User OAuth tokens                                    | DB, encrypted (per-row key version)                                          |
| User-provided API keys (optional BYO AI key, later)  | DB, encrypted like OAuth tokens; used server-side only                       |

- Env is validated once at startup (`src/config/env.ts`); modules read config from there, not from `process.env`.
- Only `NEXT_PUBLIC_*` variables reach the client bundle; none may hold secrets (review rule + CI grep).
- `import "server-only"` guards every module that touches secrets, the DB or AI providers — importing them from a client component fails the build.
- Key rotation: `ENCRYPTION_KEY_CURRENT` + `ENCRYPTION_KEY_PREVIOUS`; a maintenance job re-encrypts rows to the current version.

## 6. Encryption

- In transit: TLS everywhere (HSTS with preload once the domain is stable); DB connections require TLS.
- At rest: managed Postgres and object storage encryption (provider level).
- Application-level encryption (field level) for: OAuth tokens, user BYO keys, candidate phone/email, contact emails. Work-authorization rows are protected by access scoping and excluded from AI context by default.

## 7. Rate limiting & abuse controls

- Per user and per IP limits on all `/api/v1` mutations; stricter on auth, uploads, AI-triggering endpoints.
- Implementation: Postgres-backed limiter for Phase 1 (single region, low volume); move to Redis (e.g. Upstash) if latency or volume requires.
- Outbound caps: max emails/day and max submissions/day per user (configurable, conservative defaults) — protects deliverability and prevents runaway workflows.
- AI budgets per user/month.

## 8. Input validation & output encoding

- Zod validation at every trust boundary: HTTP input, Server Action input, env, queue job payloads, AI outputs, external API responses, workflow node configs.
- Job descriptions and any external HTML are sanitised with an allow-list sanitiser before storage/rendering; React escaping for everything else; no `dangerouslySetInnerHTML` except the sanitised job HTML component.
- Security headers via `proxy.ts`/`next.config.ts`: CSP (nonce-based scripts), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `frame-ancestors 'none'`.
- CSRF: Server Actions have built-in origin checks; Route Handlers that mutate require same-origin + SameSite cookies; webhooks use HMAC signatures with timestamp tolerance.
- SSRF: outbound fetches of user-supplied URLs go through a guarded HTTP client (scheme allow-list, DNS resolution check against private/link-local ranges, max redirects, size/time limits).
  Implemented for research in `src/modules/research/fetch/` (Phase 5): the DNS check runs inside the socket's own lookup (no rebinding gap), redirects are re-validated hop by hop, 401/403/CAPTCHA/robots blocks are recorded and never bypassed, and external HTML is reduced to escaped plain text. See [research.md](./research.md) §4.

## 9. File upload security

- Allow-list: PDF, DOCX, TXT (CVs); max 10 MB.
- MIME type sniffed from bytes, not trusted from the client; extension must agree.
- Stored under a random key in a **private** bucket; downloads via short-lived signed URLs.
- Parsing (PDF/DOCX text extraction) runs in the worker with timeouts and memory limits; malware scanning hook (`scan_status`) before the file is used.
- Original filenames are sanitised and used for display only.

## 10. Audit logging

- `audit_logs` records security- and trust-relevant actions: sign-ins, session revocations, fact verification, document approval, application transitions, approvals, sends/submissions, integration connect/disconnect, exports, deletions, admin changes to global data.
- Each entry: actor, action, resource, masked field changes, request/trace id, hashed IP, timestamp.
- Append-only at the DB permission level; users can view their own audit trail.

---

## 11. Privacy architecture

### Data inventory & minimisation

| Category                                                  | Collected?                          | Notes                                                                                                                             |
| --------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| CV content, experience, education, skills                 | Yes                                 | Core purpose                                                                                                                      |
| Contact details (phone, email)                            | Optional                            | Encrypted; only used when rendering documents                                                                                     |
| Work authorization                                        | Yes (user-provided)                 | Only for eligibility; excluded from AI writer context by default                                                                  |
| Date of birth, photo, marital status, nationality as such | **No**                              | Not needed; discriminatory in many markets. Some countries' CV norms include a photo — user can attach one to an export manually. |
| Special-category data (health, religion, ethnicity)       | **No**                              | Application Answer Agent refuses to draft EEO/demographic answers                                                                 |
| Recruiter/contact data                                    | Only what the user saves            | Source + lawful-basis note stored                                                                                                 |
| Email content                                             | Only threads linked to applications | Metadata-first; bodies fetched on demand where possible                                                                           |

### User rights

- **Access & export:** one-click JSON export of all user data (profile, facts with provenance, jobs saved, applications, documents with versions, messages, workflows, audit trail) + original files as a ZIP via signed URL.
- **Rectification:** every fact is editable; edits are audited.
- **Deletion:** account deletion → immediate access revocation → OAuth tokens revoked at providers → hard delete of all rows and stored files (async job, completes within 30 days, typically minutes) → deletion receipt. Individual items: soft delete with 30-day purge.
- **Restriction:** users can pause all automation and disable individual AI providers.
- **OAuth revocation:** from Settings → Integrations at any time; also detects provider-side revocation.

### Retention

See database-schema.md §5. Defaults: soft-deleted data 30 days; AI generation payloads 180 days; notifications 90 days; logs 14–30 days; audit trail for the life of the account.

### Processors & transfers

- Each sub-processor (hosting, DB, storage, AI providers, email) is listed in a privacy notice; prefer EU regions for DB/storage; AI providers used with no-training / zero-retention settings where available; DPAs signed before production.

---

## 12. Security testing

- Authz matrix tests (every endpoint × foreign user).
- Tests that secrets never appear in logs, errors or client bundles.
- Dependency audit + secret scanning in CI; periodic OWASP ZAP baseline scan against staging.
- Pre-launch: threat-model review, penetration test of auth, upload and integration flows.
