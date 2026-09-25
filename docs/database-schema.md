# Database Schema

Status: **design — not yet migrated.** Tables are created in the phase listed next to them, via reviewed Prisma migrations. Domain behaviour (state machines, verification rules) is specified in [domain-architecture.md](./domain-architecture.md).

---

## 0. Phase 1 as built

Migration `prisma/migrations/20260926000000_phase1_candidate` created 21 tables: `users`, `sessions`, `accounts`, `verifications` (Better Auth), `countries` (249 ISO rows; the 19 initial target markets are flagged), `candidate_profiles`, `candidate_education`, `candidate_experiences`, `candidate_projects`, `candidate_achievements`, `candidate_skills`, `candidate_certifications`, `candidate_portfolio_items`, `candidate_languages`, `candidate_work_authorizations`, `candidate_preferences`, `candidate_target_locations`, `candidate_documents`, `candidate_fact_candidates`, `ai_generations`, `audit_logs`.

Deliberate deviations from the design below (details in [candidate-intelligence.md](./candidate-intelligence.md)):

- `files` → `candidate_documents` (Phase 1 only stores candidate documents).
- The global `skills` taxonomy is deferred to Phase 4; `candidate_skills` stores name, normalized name and category.
- Fact dates are `varchar(7)` partial dates with format checks instead of `date`.
- `candidate_fact_candidates` is the staging table between extraction and approved facts.
- `user_settings` is deferred. `audit_logs` has no `updated_at` (append-only).
- Account deletion cascades audit logs immediately (no 30-day legal hold yet).

## 0b. Phase 2 as built (Checkpoints 2–3)

- `job_sources` (migration `20260927000000_phase2_job_sources`): **user-owned** source configuration (a deliberate change from the global design, per the Phase 2 brief). One row per user per source (ASHBY, LEVER, GREENHOUSE, MANUAL); status/terms are internal states enforced by CHECKs; `terms_status = VERIFIED` requires `terms_reviewed_at`. RLS: owner only.
- `companies` + `jobs` (migration `20260927010000_phase2_manual_jobs`): companies are a shared catalog (app may read/insert, never update/delete). Jobs have `visibility` PUBLIC (shared, written by the system) or PRIVATE (user-entered, visible/editable only by `created_by_user_id`). Manual jobs are forced by CHECK to MANUAL / USER_ENTERED / PRIVATE. No DELETE grant: jobs are soft-deleted and purged after 30 days (`npm run maintenance:purge`). Partial unique index `(source_id, external_job_id)` prepares discovered-job identity.
- The same migration retrofitted all Phase 1 policies to `(SELECT app_current_user_id())` (evaluated once per statement) and pinned the function `search_path`.

## 1. Conventions

| Topic            | Rule                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys     | `id uuid` generated as **UUIDv7** (`@default(uuid(7)) @db.Uuid`). Time-ordered → good B-tree locality, safe to expose, no enumeration. Reference tables use natural keys (e.g. `countries.code`). |
| Naming           | Tables `snake_case` plural; columns `snake_case`; Prisma models PascalCase mapped with `@@map`/`@map`.                                                                                            |
| Timestamps       | `created_at timestamptz not null default now()`, `updated_at timestamptz not null` (Prisma `@updatedAt`) on **every** table. All times UTC.                                                       |
| Soft delete      | `deleted_at timestamptz null` on user-owned aggregates (marked **SD**). Soft-deleted rows are purged after 30 days by a maintenance job. Account deletion is always a **hard** delete.            |
| Ownership        | Every user-owned row has `user_id uuid not null → users.id on delete cascade`, directly — even when reachable via a parent — so every query can be scoped with one predicate and indexed.         |
| Catalog data     | Public, non-personal data (countries, skills, companies, jobs, job sources, eligibility rules) is **global** and has no `user_id`. User-specific views of it live in user-scoped tables.          |
| Optimistic lock  | `version int not null default 1` on rows edited concurrently (applications, documents, workflows). Updates use `where id = ? and version = ?`.                                                    |
| Enums            | Postgres enums for **closed** sets that drive logic (verification status, application status). `text` + Zod validation for **open** sets that grow (source types, node types, document types).    |
| JSON             | `jsonb` only for (a) raw external payloads, (b) versioned configs/definitions validated by Zod, (c) evidence blobs. Never for data we filter or join on routinely.                                |
| Money            | Integer amounts in whole currency units + ISO 4217 `currency char(3)` + `salary_period`. Normalised annual values stored separately for comparison.                                               |
| Codes            | Countries ISO 3166-1 alpha-2; languages ISO 639-1 (+ optional region); currencies ISO 4217.                                                                                                       |
| Case-insensitive | Emails and normalised names use `citext` or a stored lower-cased column with a unique index.                                                                                                      |
| Unique + SD      | Uniqueness on soft-deletable tables uses **partial** unique indexes `where deleted_at is null` (via raw SQL in migrations).                                                                       |

### Shared column groups

**Provenance** (added to every candidate fact table — see §3):

| Column                 | Type                       | Notes                                                                 |
| ---------------------- | -------------------------- | --------------------------------------------------------------------- |
| `verification_status`  | enum `verification_status` | `VERIFIED` · `USER_PROVIDED` · `NEEDS_REVIEW` · `AI_INFERRED`         |
| `source_type`          | text                       | `MANUAL` · `CV_UPLOAD` · `IMPORT` · `AI_EXTRACTION` · `AI_SUGGESTION` |
| `source_file_id`       | uuid null → files          | the uploaded CV the fact came from                                    |
| `source_generation_id` | uuid null → ai_generations | the AI run that extracted/inferred it                                 |
| `source_excerpt`       | text null                  | verbatim snippet supporting the fact (for review UI)                  |
| `confidence`           | real null                  | AI confidence 0–1; null for human-entered                             |
| `verified_at`          | timestamptz null           | set only by an explicit user verification action                      |

DB guard: `check (verification_status <> 'VERIFIED' or verified_at is not null)`. The rule "AI_INFERRED never becomes VERIFIED automatically" is enforced in the candidate service (only the `verifyFact` use case, triggered by a user, can set `VERIFIED`) and recorded in `audit_logs`.

---

## 2. Entity overview

```
users ─┬─ candidate_profiles ─┬─ candidate_experiences ── candidate_achievements
       │                      ├─ candidate_education
       │                      ├─ candidate_skills ───────── skills (global)
       │                      ├─ candidate_projects
       │                      ├─ candidate_certifications
       │                      ├─ candidate_portfolio_links
       │                      ├─ candidate_languages
       │                      ├─ candidate_work_authorizations ── countries
       │                      └─ candidate_preferences ── candidate_target_locations
       ├─ files
       ├─ applications ─┬─ application_events
       │                ├─ application_documents ── document_versions
       │                ├─ approvals
       │                ├─ messages ── contacts
       │                └─ followups
       ├─ documents ── document_versions
       ├─ job_matches ── job_match_dimensions
       ├─ eligibility_assessments ── eligibility_rules (global)
       ├─ contacts ── companies (global)
       ├─ company_research
       ├─ workflows ── workflow_versions ── workflow_executions ── workflow_node_executions
       ├─ integration_connections
       ├─ ai_generations ── ai_generation_sources
       ├─ notifications
       ├─ outbound_actions
       └─ audit_logs

global: countries, skills, skill_aliases, companies, company_domains,
        job_sources, source_runs, raw_job_postings, jobs, job_locations,
        job_requirements, job_skills, eligibility_rules
```

Entities from the initial brief that were **merged or dropped**, and why:

| Brief entity                        | Decision                                                                                                                                                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `candidate_portfolio`               | → `candidate_portfolio_links` (it is a list of links/artefacts).                                                                                                                                                                                                                                 |
| `candidate_documents`               | → `files` (uploaded binaries) + `documents` (managed, versioned docs). Two concepts, not one.                                                                                                                                                                                                    |
| `company_sources`                   | → `company_domains` (identity/dedupe) + sources recorded on `company_research`.                                                                                                                                                                                                                  |
| `job_sources`                       | kept; raw postings split into `raw_job_postings`.                                                                                                                                                                                                                                                |
| `application_answers`               | → a `documents` row of type `APPLICATION_ANSWERS` (versioned + approvable like every other document).                                                                                                                                                                                            |
| `application_messages`              | → `messages` (also used for non-application outreach and inbound replies).                                                                                                                                                                                                                       |
| `workflow_nodes`, `workflow_edges`  | → `workflow_versions.definition jsonb`. The graph is always loaded/saved whole and executions must pin an immutable snapshot; per-node rows would add joins and make versioning harder. Node ids inside the definition are stable string keys referenced by `workflow_node_executions.node_key`. |
| `oauth_connections`, `integrations` | → single `integration_connections` table (one row per connected account, tokens encrypted).                                                                                                                                                                                                      |
| `settings`                          | → `user_settings` (1:1). System settings are env config.                                                                                                                                                                                                                                         |

---

## 3. Tables by module

Legend — **PK** primary key · **FK** foreign key · **UQ** unique · **IX** index · **SD** soft delete · **P** phase introduced.

### 3.1 Identity (P1)

**users** — SD

| Column                               | Type                              | Notes |
| ------------------------------------ | --------------------------------- | ----- |
| id                                   | uuid PK                           |       |
| email                                | citext UQ                         |       |
| email_verified_at                    | timestamptz null                  |       |
| name                                 | text null                         |       |
| image_url                            | text null                         |       |
| role                                 | enum `user_role` (`USER`,`ADMIN`) |       |
| created_at / updated_at / deleted_at |                                   |       |

**sessions**, **accounts**, **verifications** — owned by the auth library (Better Auth schema). `accounts` stores the login provider link only; **no passwords are stored for third-party services**. If email/password login is enabled, the hash (argon2id/scrypt) lives here and nowhere else.

**user_settings** — 1:1 with users

| Column                   | Type               | Notes                                          |
| ------------------------ | ------------------ | ---------------------------------------------- |
| user_id                  | uuid PK/FK → users |                                                |
| timezone                 | text               | IANA tz                                        |
| locale                   | text               |                                                |
| preferred_currency       | char(3)            | display + normalisation target                 |
| match_weights            | jsonb              | user-tunable dimension weights (Zod-validated) |
| ai_preferences           | jsonb              | tone, language, provider opt-outs              |
| notification_preferences | jsonb              |                                                |

### 3.2 Reference data (P1–P2)

**countries** — global, seeded, extensible (the target-market list is **data**, not code)

| Column                  | Type       | Notes                              |
| ----------------------- | ---------- | ---------------------------------- |
| code                    | char(2) PK | ISO 3166-1 alpha-2                 |
| name                    | text       |                                    |
| region                  | text       | e.g. `EU`, `NA`, `GCC`             |
| default_currency        | char(3)    |                                    |
| is_eu_eea               | boolean    | useful for EU mobility signals     |
| is_enabled              | boolean    | toggles the market in discovery UI |
| created_at / updated_at |            |                                    |

**skills** — global canonical taxonomy (P1)

| Column    | Type           | Notes                                               |
| --------- | -------------- | --------------------------------------------------- |
| id        | uuid PK        |                                                     |
| name      | text           | display name                                        |
| slug      | text UQ        | normalised                                          |
| category  | text           | `LANGUAGE`, `FRAMEWORK`, `TOOL`, `DOMAIN`, `SOFT` … |
| embedding | vector(n) null | pgvector (P4)                                       |

**skill_aliases** — `(alias_normalized UQ, skill_id FK)`; maps "JS", "Javascript" → JavaScript.

### 3.3 Files (P1)

**files** — SD — metadata for binaries in object storage

| Column            | Type       | Notes                                        |
| ----------------- | ---------- | -------------------------------------------- |
| id                | uuid PK    |                                              |
| user_id           | uuid FK IX |                                              |
| storage_key       | text UQ    | random key, never user-supplied filename     |
| original_filename | text       | sanitised, display only                      |
| mime_type         | text       | server-sniffed, allow-listed                 |
| size_bytes        | int        |                                              |
| sha256            | char(64)   | IX `(user_id, sha256)` dedupe                |
| purpose           | text       | `CV_SOURCE`, `DOCUMENT_EXPORT`, `ATTACHMENT` |
| scan_status       | text       | `PENDING`,`CLEAN`,`REJECTED`                 |

### 3.4 Candidate knowledge (P1)

All tables below: `user_id` FK IX, `candidate_profile_id` FK, **provenance columns**, SD, timestamps. Display ordering via `sort_order int`.

**candidate_profiles** — 1:1 with user (UQ `user_id`)

| Column                                 | Type                        | Notes                                                                                       |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------- |
| id                                     | uuid PK                     |                                                                                             |
| headline                               | text                        |                                                                                             |
| summary                                | text                        |                                                                                             |
| current_city / current_country_code    | text / char(2) FK countries |                                                                                             |
| date_of_birth                          | —                           | **not stored** (data minimisation; not needed for matching, discriminatory in many markets) |
| phone, public_email                    | text null                   | encrypted at rest (app-level)                                                               |
| availability_date                      | date null                   |                                                                                             |
| notice_period_days                     | int null                    |                                                                                             |
| career_goals                           | text                        | free text goals                                                                             |
| + provenance on the profile as a whole |                             |                                                                                             |

**candidate_experiences**: `employer_name`, `company_id` null FK companies, `title`, `employment_type`, `location_city`, `location_country_code`, `remote_status`, `start_date`, `end_date null`, `is_current`, `description`. IX `(user_id, start_date desc)`.

**candidate_achievements**: `experience_id null FK`, `project_id null FK` (check: exactly one set, or both null for standalone), `statement`, `metric_value text null`, `metric_unit text null`, `evidence_url null`. Achievements are the atoms the Resume Agent may cite.

**candidate_education**: `institution`, `degree_level` (`BACHELOR`,`MASTER`,`PHD`,…, text), `degree_name`, `field_of_study`, `country_code`, `start_date`, `end_date`, `grade text null`, `recognition_status text null` (e.g. anabin/ENIC-NARIC recognition, user-provided).

**candidate_skills**: `skill_id FK skills`, `proficiency` (1–5 null), `years_experience numeric null`, `last_used_year int null`, `evidence_experience_ids uuid[]` (optional links). UQ partial `(user_id, skill_id) where deleted_at is null`.

**candidate_projects**: `name`, `role`, `description`, `url null`, `repo_url null`, `start_date`, `end_date`, `technologies` (via `candidate_project_skills(project_id, skill_id)` join — only if needed for matching; otherwise `skill_ids uuid[]`).

**candidate_certifications**: `name`, `issuer`, `issued_on`, `expires_on null`, `credential_id null`, `credential_url null`.

**candidate_portfolio_links**: `kind` (`GITHUB`,`PORTFOLIO`,`LINKEDIN`,`PUBLICATION`,`OTHER`), `url`, `title`, `description`.

**candidate_languages**: `language_code` (ISO 639-1), `proficiency` (CEFR `A1`…`C2`, `NATIVE`), `certificate text null`. UQ partial `(user_id, language_code)`.

**candidate_work_authorizations**: `country_code FK`, `status` (`CITIZEN`,`PERMANENT_RESIDENT`,`WORK_PERMIT`,`STUDENT_PERMIT`,`NONE`,`UNKNOWN`), `permit_type text null`, `valid_until date null`, `requires_sponsorship boolean null`. UQ partial `(user_id, country_code)`. Highly sensitive → included in export, excluded from AI prompts unless the task needs it (eligibility only).

**candidate_preferences** — 1:1 with profile

| Column                   | Type     | Notes                            |
| ------------------------ | -------- | -------------------------------- |
| target_roles             | text[]   | normalised titles                |
| seniority_levels         | text[]   |                                  |
| employment_types         | text[]   | `FULL_TIME`,`CONTRACT`,…         |
| remote_preference        | text     | `ONSITE`,`HYBRID`,`REMOTE`,`ANY` |
| relocation_willing       | boolean  |                                  |
| salary_min               | int null |                                  |
| salary_currency          | char(3)  |                                  |
| salary_period            | text     |                                  |
| company_size_preferences | text[]   |                                  |
| excluded_companies       | uuid[]   |                                  |
| industries               | text[]   |                                  |

**candidate_target_locations**: `country_code FK`, `city text null`, `priority int`. UQ partial `(user_id, country_code, city)`.

### 3.5 Job catalog (P2–P3) — global

**job_sources**

| Column                          | Type                     | Notes                                                                              |
| ------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| id                              | uuid PK                  |                                                                                    |
| adapter                         | text                     | `GREENHOUSE`, `LEVER`, `ASHBY`, `COMPANY_JSON_LD`, `MANUAL`, …                     |
| name                            | text                     |                                                                                    |
| config                          | jsonb                    | adapter-specific (board token, feed URL), Zod-validated                            |
| status                          | text                     | `ACTIVE`, `PAUSED`, `DISABLED`, `FAILING`                                          |
| access_basis                    | text                     | `PUBLIC_API`, `OFFICIAL_FEED`, `PARTNER_API`, `USER_PROVIDED` — why we are allowed |
| terms_reviewed_at               | timestamptz null         | ToS review record; required to activate                                            |
| terms_url                       | text null                |                                                                                    |
| rate_limit_per_min              | int                      |                                                                                    |
| last_success_at / last_error_at | timestamptz null         |                                                                                    |
| UQ                              | `(adapter, config_hash)` |                                                                                    |

**source_runs**: `job_source_id FK IX`, `status`, `started_at`, `finished_at`, `fetched_count`, `new_count`, `updated_count`, `closed_count`, `error_code`, `error_message`, `trace_id`.

**raw_job_postings**

| Column                       | Type                           | Notes                                            |
| ---------------------------- | ------------------------------ | ------------------------------------------------ |
| id                           | uuid PK                        |                                                  |
| job_source_id                | uuid FK                        |                                                  |
| external_id                  | text                           | source's own id                                  |
| url                          | text                           |                                                  |
| payload                      | jsonb                          | untouched source data (audit / re-normalisation) |
| content_hash                 | char(64)                       | change detection                                 |
| first_seen_at / last_seen_at | timestamptz                    |                                                  |
| removed_at                   | timestamptz null               | disappeared from source                          |
| job_id                       | uuid null FK jobs              | canonical job it resolved to                     |
| normalizer_version           | int                            | re-run when normaliser improves                  |
| UQ                           | `(job_source_id, external_id)` | IX `(job_id)`, IX `(content_hash)`               |

**companies** — global

| Column               | Type         | Notes                                             |
| -------------------- | ------------ | ------------------------------------------------- |
| id                   | uuid PK      |                                                   |
| name                 | text         |                                                   |
| name_normalized      | text IX      | lower, legal suffixes stripped (GmbH, B.V., Inc.) |
| website              | text null    |                                                   |
| hq_country_code      | char(2) null |                                                   |
| size_range           | text null    |                                                   |
| industry             | text null    |                                                   |
| description          | text null    |                                                   |
| known_sponsor_signal | text null    | see eligibility — evidence, not a verdict         |

**company_domains**: `domain UQ`, `company_id FK` — primary dedupe key for companies.

**jobs** — canonical job

| Column                                          | Type                                            | Notes                                                 |
| ----------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| id                                              | uuid PK                                         |                                                       |
| company_id                                      | uuid FK IX                                      |                                                       |
| title                                           | text                                            |                                                       |
| title_normalized                                | text                                            |                                                       |
| description_text                                | text                                            | sanitised plain text                                  |
| description_html                                | text                                            | sanitised (allow-list)                                |
| seniority                                       | text null                                       |                                                       |
| employment_type                                 | text null                                       |                                                       |
| remote_status                                   | text                                            | `ONSITE`,`HYBRID`,`REMOTE`,`REMOTE_COUNTRY`,`UNKNOWN` |
| salary_min / salary_max                         | int null                                        | as published                                          |
| salary_currency                                 | char(3) null                                    |                                                       |
| salary_period                                   | text null                                       | `HOUR`,`DAY`,`MONTH`,`YEAR`                           |
| salary_annual_min_norm / salary_annual_max_norm | int null                                        | converted to base currency                            |
| salary_norm_currency / fx_rate_date             | char(3) / date                                  |                                                       |
| relocation_available                            | text                                            | `YES`,`NO`,`UNKNOWN`                                  |
| visa_sponsorship                                | enum `sponsorship_signal`                       | see domain doc §3                                     |
| work_authorization_text                         | text null                                       | extracted verbatim                                    |
| degree_requirement                              | text null                                       | `NONE`,`BACHELOR`,`MASTER`,`PHD`,`UNKNOWN`            |
| experience_years_min / max                      | numeric null                                    |                                                       |
| language_requirements                           | jsonb                                           | `[{language_code, level, required}]`                  |
| apply_url                                       | text                                            |                                                       |
| apply_channel                                   | text                                            | `ATS_PORTAL`,`EMAIL`,`EXTERNAL`                       |
| status                                          | text                                            | `OPEN`,`CLOSED`,`UNKNOWN`                             |
| posted_at / closes_at                           | timestamptz null                                |                                                       |
| first_seen_at / last_seen_at                    | timestamptz                                     |                                                       |
| dedupe_fingerprint                              | char(64) IX                                     | see job-source doc                                    |
| visibility                                      | text                                            | `PUBLIC` or `PRIVATE` (manually added by a user)      |
| created_by_user_id                              | uuid null FK                                    | for PRIVATE jobs; row is then user-scoped             |
| search_vector                                   | tsvector                                        | generated, GIN index                                  |
| embedding                                       | vector(n) null                                  | P4                                                    |
| IX                                              | `(status, posted_at desc)`, GIN `search_vector` |                                                       |

**job_locations**: `job_id FK`, `country_code FK`, `city null`, `region null`, `is_primary`. IX `(country_code, city)`. A posting may list several cities/countries.

**job_requirements**: `job_id FK`, `kind` (`SKILL`,`EXPERIENCE`,`EDUCATION`,`LANGUAGE`,`CERTIFICATION`,`AUTHORIZATION`,`OTHER`), `text` (verbatim), `importance` (`REQUIRED`,`PREFERRED`), `extraction_method` (`RULE`,`AI`), `source_generation_id null`.

**job_skills**: `job_id FK`, `skill_id FK`, `importance`, UQ `(job_id, skill_id)`.

### 3.6 Companies & contacts (P3, P5) — user-scoped

**contacts** — SD — recruiter/hiring-manager PII the user chose to store

| Column            | Type             | Notes                                                                        |
| ----------------- | ---------------- | ---------------------------------------------------------------------------- |
| id, user_id       |                  |                                                                              |
| company_id        | uuid null FK     |                                                                              |
| full_name, title  | text             |                                                                              |
| email             | text null        | encrypted at rest                                                            |
| linkedin_url      | text null        |                                                                              |
| source            | text             | `USER_ENTERED`, `JOB_POSTING`, `EMAIL_THREAD` — **no scraped personal data** |
| lawful_basis_note | text null        | GDPR legitimate-interest note                                                |
| last_contacted_at | timestamptz null |                                                                              |

**company_research** — SD — versioned research snapshots
`user_id`, `company_id FK`, `job_id null FK`, `summary`, `findings jsonb` (claims each with `source_url`, `retrieved_at`), `ai_generation_id FK`, `status` (`DRAFT`,`REVIEWED`), `stale_after timestamptz`.

### 3.7 Eligibility (P4)

**eligibility_rules** — global, versioned external knowledge

| Column                        | Type        | Notes                                        |
| ----------------------------- | ----------- | -------------------------------------------- |
| id                            | uuid PK     |                                              |
| country_code                  | char(2) FK  |                                              |
| rule_key                      | text        | e.g. `EU_BLUE_CARD_SALARY_THRESHOLD`         |
| rule_version                  | int         | UQ `(country_code, rule_key, rule_version)`  |
| summary                       | text        | neutral description, not advice              |
| parameters                    | jsonb       | e.g. thresholds, currency, year              |
| source_name / source_url      | text        | official source required                     |
| effective_from / effective_to | date null   |                                              |
| last_verified_at              | timestamptz | stale if older than policy (default 90 days) |
| verified_by                   | text        | who reviewed it                              |
| status                        | text        | `ACTIVE`, `STALE`, `RETIRED`                 |

**eligibility_assessments** — user-scoped
`user_id`, `job_id FK`, `sponsorship_signal` enum, `authorization_status` (`AUTHORIZED`,`LIKELY_REQUIRES_SPONSORSHIP`,`NEEDS_VERIFICATION`,`UNKNOWN`), `factors jsonb` (per-factor result + evidence), `rules_used jsonb` (`[{rule_id, rule_version}]`), `candidate_snapshot_hash`, `computed_at`. UQ `(user_id, job_id)` (latest; history via audit).

### 3.8 Matching (P4)

**job_matches** — user-scoped

| Column                                     | Type                            | Notes                                      |
| ------------------------------------------ | ------------------------------- | ------------------------------------------ |
| id, user_id                                |                                 |                                            |
| job_id                                     | uuid FK                         | UQ `(user_id, job_id)`                     |
| summary_score                              | smallint null                   | derived weighted summary for sorting only  |
| summary_label                              | text                            | `STRONG`,`GOOD`,`PARTIAL`,`WEAK`,`BLOCKED` |
| blocking_gaps                              | int                             | count of required gaps                     |
| unknown_count                              | int                             |                                            |
| matcher_version                            | int                             |                                            |
| candidate_snapshot_hash / job_content_hash | char(64)                        | recompute when either changes              |
| explanation                                | text                            | short narrative (AI, grounded)             |
| computed_at                                | timestamptz                     |                                            |
| IX                                         | `(user_id, summary_score desc)` |                                            |

**job_match_dimensions**: `job_match_id FK`, `dimension` (`SKILLS`,`EXPERIENCE`,`EDUCATION`,`PORTFOLIO`,`LOCATION`,`SALARY`,`LANGUAGE`,`AUTHORIZATION`,`CAREER_GOALS`), `score smallint null`, `status` (`MATCH`,`PARTIAL`,`GAP`,`UNKNOWN`,`NEEDS_VERIFICATION`), `evidence jsonb` (`matches[]`, `gaps[]`, `unknowns[]`, each referencing candidate fact ids and job requirement ids), `method` (`RULE`,`AI`,`HYBRID`). UQ `(job_match_id, dimension)`.

### 3.9 Documents (P6–P7)

**documents** — SD — the logical document

| Column              | Type                                   | Notes                                                                                   |
| ------------------- | -------------------------------------- | --------------------------------------------------------------------------------------- |
| id, user_id         |                                        |                                                                                         |
| type                | text                                   | `MASTER_RESUME`, `JOB_RESUME`, `COVER_LETTER`, `RECRUITER_EMAIL`, `APPLICATION_ANSWERS` |
| title               | text                                   |                                                                                         |
| job_id / company_id | uuid null FK                           | required for job-specific types (check)                                                 |
| parent_document_id  | uuid null FK                           | e.g. job resume derived from master                                                     |
| current_version_id  | uuid null FK                           |                                                                                         |
| approved_version_id | uuid null FK                           |                                                                                         |
| version             | int                                    | optimistic lock                                                                         |
| IX                  | `(user_id, type)`, `(user_id, job_id)` |                                                                                         |

**document_versions** — immutable once created

| Column                            | Type                   | Notes                                                       |
| --------------------------------- | ---------------------- | ----------------------------------------------------------- |
| id                                | uuid PK                |                                                             |
| document_id                       | uuid FK                | UQ `(document_id, version_number)`                          |
| user_id                           | uuid FK                |                                                             |
| version_number                    | int                    |                                                             |
| status                            | enum `document_status` | `DRAFT` → `IN_REVIEW` → `APPROVED` → `ARCHIVED`             |
| content                           | jsonb                  | structured content (sections / Q&A), Zod-validated per type |
| content_hash                      | char(64)               | approvals bind to this                                      |
| rendered_file_id                  | uuid null FK files     | PDF/DOCX export                                             |
| generation_source                 | text                   | `MANUAL`, `AI`, `AI_EDITED`                                 |
| ai_generation_id                  | uuid null FK           |                                                             |
| based_on_version_id               | uuid null FK           | edit lineage                                                |
| qc_report                         | jsonb null             | Quality Control Agent findings                              |
| approved_at / approved_by_user_id |                        | set only by the approve use case                            |

Status is the only mutable field on a version; content changes create a new version.

### 3.10 Applications (P8)

**applications** — SD — the user's pipeline record for one job

| Column                       | Type                                              | Notes                                                                                         |
| ---------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| id, user_id                  |                                                   |                                                                                               |
| job_id                       | uuid FK                                           | UQ partial `(user_id, job_id) where deleted_at is null` — **prevents duplicate applications** |
| company_id                   | uuid FK                                           | denormalised for listing / company-level duplicate checks                                     |
| status                       | enum `application_status`                         | see domain doc §6                                                                             |
| previous_status              | enum null                                         | for restore-from-archive                                                                      |
| channel                      | text null                                         | `ATS_PORTAL`, `EMAIL`, `REFERRAL`, `OTHER`                                                    |
| priority                     | smallint                                          |                                                                                               |
| submitted_at                 | timestamptz null                                  |                                                                                               |
| next_action_at               | timestamptz null                                  | IX `(user_id, next_action_at)`                                                                |
| outcome                      | text null                                         | `OFFER_ACCEPTED`, `OFFER_DECLINED`, `GHOSTED`, …                                              |
| source_workflow_execution_id | uuid null FK                                      | if created by automation                                                                      |
| version                      | int                                               | optimistic lock                                                                               |
| IX                           | `(user_id, status)`, `(user_id, updated_at desc)` |                                                                                               |

**application_events** — append-only timeline
`application_id FK IX`, `user_id`, `type` (`STATUS_CHANGED`, `NOTE`, `DOCUMENT_ATTACHED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `INTERVIEW_SCHEDULED`, …), `from_status`, `to_status`, `payload jsonb`, `actor_type` (`USER`,`SYSTEM`,`WORKFLOW`), `actor_id`, `created_at`. No updates, no deletes (except account deletion).

**application_documents**: `application_id FK`, `document_version_id FK`, `role` (`RESUME`,`COVER_LETTER`,`ANSWERS`,`EMAIL`). UQ `(application_id, role)`.

**approvals** — the human gate

| Column                     | Type             | Notes                                                       |
| -------------------------- | ---------------- | ----------------------------------------------------------- |
| id, user_id                |                  |                                                             |
| subject_type / subject_id  | text / uuid      | `APPLICATION_SUBMISSION`, `MESSAGE_SEND`, `WORKFLOW_NODE`   |
| status                     | text             | `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `INVALIDATED` |
| content_hashes             | jsonb            | hashes of every document version / message approved         |
| decided_at                 | timestamptz null |                                                             |
| expires_at                 | timestamptz      |                                                             |
| workflow_node_execution_id | uuid null FK     |                                                             |

An approval is **invalidated** automatically if any referenced content hash changes.

**outbound_actions** — idempotency ledger for side effects
`user_id`, `action` (`SEND_EMAIL`, `SUBMIT_APPLICATION`), `idempotency_key UQ`, `approval_id FK not null`, `status`, `external_ref`, `executed_at`, `error_code`.

### 3.11 Messaging (P7 drafts, P10 sending)

**messages** — SD
`user_id`, `application_id null FK`, `contact_id null FK`, `direction` (`OUTBOUND`,`INBOUND`), `status` (`DRAFT`,`APPROVED`,`QUEUED`,`SENT`,`FAILED`,`RECEIVED`), `subject`, `body_text`, `document_version_id null FK`, `integration_connection_id null FK`, `provider_message_id`, `provider_thread_id`, `sent_at`, `received_at`. IX `(user_id, application_id)`, UQ `(integration_connection_id, provider_message_id)`.

### 3.12 Follow-ups (P11)

**followups** — SD
`user_id`, `application_id FK`, `due_at IX`, `kind` (`EMAIL`,`CHECK_STATUS`,`THANK_YOU`), `status` (`SCHEDULED`,`DUE`,`DRAFTED`,`DONE`,`SKIPPED`,`CANCELLED`), `message_id null FK`, `rule_key` (which cadence rule created it). Partial IX `(due_at) where status in ('SCHEDULED','DUE')`.

### 3.13 Workflows (P9)

**workflows** — SD
`user_id`, `name`, `description`, `status` (`DRAFT`,`ACTIVE`,`PAUSED`,`ARCHIVED`), `active_version_id null FK`, `draft_definition jsonb` (autosaved editor state), `version int`.

**workflow_versions** — immutable
`workflow_id FK`, `user_id`, `version_number` (UQ with workflow_id), `definition jsonb` (nodes, edges, trigger, settings — schema in domain doc §7), `definition_hash`, `schema_version int`, `published_at`.

**workflow_executions**
`id`, `user_id`, `workflow_id FK`, `workflow_version_id FK`, `trigger_type`, `trigger_payload jsonb`, `status` (`QUEUED`,`RUNNING`,`WAITING`,`SUCCEEDED`,`FAILED`,`CANCELLED`), `started_at`, `completed_at`, `error_code`, `error_message`, `cancel_requested_at`, `trace_id`. IX `(user_id, workflow_id, started_at desc)`, IX `(status)`.

**workflow_node_executions**
`id`, `execution_id FK IX`, `user_id`, `node_key` (id within definition), `node_type`, `status` (`PENDING`,`RUNNING`,`WAITING`,`SUCCEEDED`,`FAILED`,`SKIPPED`,`CANCELLED`), `attempt` (retry_count), `input jsonb`, `output jsonb`, `error jsonb`, `started_at`, `completed_at`, `idempotency_key UQ`, `resume_token_hash null` (for approvals/delays). Large inputs/outputs are stored by reference (file id) above a size limit.

### 3.14 Integrations (P10; Google login in P1 uses `accounts`)

**integration_connections** — one row per connected external account

| Column                               | Type             | Notes                                         |
| ------------------------------------ | ---------------- | --------------------------------------------- |
| id, user_id                          |                  |                                               |
| provider                             | text             | `GOOGLE_GMAIL`, `MICROSOFT_OUTLOOK`, …        |
| external_account_id / external_email | text             | UQ `(user_id, provider, external_account_id)` |
| scopes                               | text[]           | granted scopes (minimal)                      |
| access_token_enc / refresh_token_enc | bytea            | AES-256-GCM ciphertext                        |
| key_version                          | int              | encryption key rotation                       |
| token_expires_at                     | timestamptz      |                                               |
| status                               | text             | `ACTIVE`, `NEEDS_REAUTH`, `REVOKED`           |
| last_used_at / revoked_at            | timestamptz null |                                               |

### 3.15 AI (P1)

**ai_generations** — every model call that produced product data

| Column                                         | Type                                             | Notes                                               |
| ---------------------------------------------- | ------------------------------------------------ | --------------------------------------------------- |
| id, user_id                                    |                                                  |                                                     |
| agent                                          | text                                             | `CANDIDATE_EXTRACTION`, `JOB_ANALYSIS`, `RESUME`, … |
| task                                           | text                                             | router task key                                     |
| provider / model                               | text                                             |                                                     |
| prompt_template_id / prompt_version            | text / int                                       |                                                     |
| input_hash                                     | char(64)                                         | cache + reproducibility                             |
| input_redacted                                 | jsonb                                            | inputs with sensitive fields removed                |
| output                                         | jsonb                                            | validated structured output                         |
| status                                         | text                                             | `SUCCEEDED`, `FAILED`, `SCHEMA_INVALID`, `BLOCKED`  |
| input_tokens / output_tokens / cost_usd_micros | int / int / bigint                               |                                                     |
| latency_ms                                     | int                                              |                                                     |
| trace_id                                       | text                                             |                                                     |
| IX                                             | `(user_id, created_at desc)`, `(user_id, agent)` |                                                     |

**ai_generation_sources** — grounding links
`ai_generation_id FK`, `source_type` (`CANDIDATE_FACT`, `JOB_REQUIREMENT`, `COMPANY_FINDING`, `FILE`, `URL`), `source_table`, `source_id`, `source_url null`, `excerpt null`, `claim_path text null` (which output field used it).

### 3.16 Notifications (P8)

**notifications**: `user_id`, `type`, `title`, `body`, `link_path`, `severity`, `read_at null`, `created_at`. IX `(user_id, read_at, created_at desc)`. Purged after 90 days.

### 3.17 Audit (P1)

**audit_logs** — append-only

| Column                      | Type        | Notes                                                                       |
| --------------------------- | ----------- | --------------------------------------------------------------------------- |
| id                          | uuid PK     |                                                                             |
| user_id                     | uuid FK IX  | subject owner                                                               |
| actor_type / actor_id       | text / text | `USER`, `SYSTEM`, `WORKFLOW`, `ADMIN`                                       |
| action                      | text        | `candidate.fact.verified`, `application.submitted`, `integration.revoked` … |
| resource_type / resource_id | text / uuid | IX `(resource_type, resource_id)`                                           |
| changes                     | jsonb       | field-level before/after, **sensitive fields masked**                       |
| request_id / trace_id       | text        |                                                                             |
| ip_hash / user_agent        | text        | hashed IP                                                                   |
| created_at                  | timestamptz | IX `(user_id, created_at desc)`                                             |

The app DB role has `INSERT, SELECT` only on `audit_logs` (no `UPDATE`/`DELETE`); account deletion runs through a privileged maintenance role.

---

## 4. Postgres enums (closed sets)

```
verification_status : VERIFIED | USER_PROVIDED | NEEDS_REVIEW | AI_INFERRED
user_role           : USER | ADMIN
sponsorship_signal  : SPONSORSHIP_EXPLICIT | SPONSORSHIP_POSSIBLE | SPONSORSHIP_UNKNOWN
                      | NO_SPONSORSHIP | EXISTING_AUTHORIZATION_REQUIRED | NEEDS_VERIFICATION
document_status     : DRAFT | IN_REVIEW | APPROVED | ARCHIVED
application_status  : DISCOVERED | QUALIFIED | REVIEW | PREPARING | READY | APPROVAL_REQUIRED
                      | APPROVED | SUBMITTED | EMAIL_SENT | FOLLOW_UP_DUE | RECRUITER_RESPONSE
                      | SCREENING | INTERVIEW | FINAL_ROUND | OFFER | REJECTED | WITHDRAWN | ARCHIVED
```

---

## 5. Deletion, retention & history

| Data                           | Delete behaviour                                                                                                                  | History                                      |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| User-owned aggregates (**SD**) | soft delete → purge after 30 days                                                                                                 | audit_logs                                   |
| Document versions              | never edited; archived; deleted with parent                                                                                       | versions themselves are the history          |
| Workflow versions              | immutable                                                                                                                         | versions                                     |
| Application events             | append-only                                                                                                                       | the table is the history                     |
| Raw job postings               | kept while source active; payload trimmed after 180 days                                                                          | `content_hash` changes logged in source_runs |
| AI generations                 | `input_redacted`/`output` purged after 180 days; metadata kept                                                                    | cost/usage metadata retained                 |
| Account deletion               | **hard delete** of all user rows (cascade) + object storage keys + token revocation; audit rows deleted after a 30-day legal hold | a minimal, non-PII deletion receipt is kept  |

---

## 6. Performance notes

- All user-scoped list queries hit `(user_id, …)` composite indexes.
- Job search: GIN on `jobs.search_vector`, B-tree on `job_locations(country_code)`, later HNSW on `jobs.embedding` / `skills.embedding`.
- Analytics (P12) reads materialised views refreshed by the worker; no heavy aggregates on request paths.
- Connection pooling via the provider's pooler (PgBouncer / Neon pooler) for serverless; migrations use `DIRECT_DATABASE_URL`.
