# Job Discovery — Search Profiles, Ingestion, Deduplication

Phase 2 (Checkpoints 9–10, with the India / Search Profile scope update).
Migration: `prisma/migrations/20260927020000_phase2_discovery`.

## 1. Three separate concepts (mandatory)

| Concept               | Question                    | Where                                             |
| --------------------- | --------------------------- | ------------------------------------------------- |
| **Search Profile**    | What do I want to find?     | `search_profiles` (`src/modules/search-profiles`) |
| **Candidate Profile** | Who am I?                   | `candidate_*` (Phase 1)                           |
| **Matching Engine**   | How well does a job fit me? | `job_matches` (Phase 4)                           |

A Search Profile never makes a claim about the candidate, and category search terms
(e.g. "n8n", "Zapier") are search keywords, not skills.

## 2. Configuration data (never hard-coded)

- `countries.is_target_market` — 20 initial markets incl. **India**.
- `market_locations` — cities/regions/metros per country, with lower-case aliases
  (Bangalore → Bengaluru, Gurgaon → Gurugram). Kind `REMOTE_COUNTRY` = "Remote / Anywhere in <country>".
  Seeded: 11 Indian locations + Dubai, Abu Dhabi, Sharjah, Doha, Riyadh, Jeddah.
- `job_categories` + `job_category_terms` — 16 seeded categories, 113 terms.
- `user_id NULL` = system default (read-only); rows with a `user_id` are the user's own
  additions (locations, custom categories, extra terms). RLS: read system + own, write own.

## 3. Search Profile model

Countries, locations (join table), categories (join table), extra search terms, work modes
(REMOTE/HYBRID/ONSITE/UNKNOWN), job types, experience levels, salary min/max + currency +
period, visa preference, source keys, schedule interval. Empty selection = any value.
Owner-only (service filter + RLS).

## 4. Evaluation rules (`criteria.ts`, pure + unit-tested)

- UNKNOWN (work mode, job type, experience) is included **only when selected**.
- Country filter needs a known country — an unstated country is never assumed.
- Locations constrain only jobs in the location's own country; `REMOTE_COUNTRY` matches
  REMOTE jobs in that country.
- Categories: a job matches if it is classified into a selected category **or** its title/
  department contains any term of the selected categories or the profile's own terms.
- Salary: never compares different currencies or periods, never uses exchange rates.
  Only a comparable out-of-range salary excludes a job; missing or non-comparable salaries
  are kept and labelled (`NOT_STATED`, `CURRENCY_NOT_COMPARABLE`, `PERIOD_NOT_COMPARABLE`).
- Visa is informational only (eligibility is a matching concern).
- Experience level comes only from explicit title wording (`experience_level_raw` keeps it).

## 5. Pipeline (`run.service.ts`)

SEARCH PROFILE → SOURCE SELECTION (user's enabled ATS sources ∩ profile source keys) →
FETCH (adapters, guarded HTTP, rate limiter) → NORMALIZE (canonical Zod schema) →
DEDUPLICATE + SAVE (`ingest.ts`) → PROFILE MATCHING (`job_search_profile_hits`).

- One active run per user (partial unique index). Stale runs (no heartbeat for 10 min) fail.
- Every board writes a `source_sync_runs` row; run counters update after each board.
- ATS public APIs return whole boards (no query parameters), so every valid posting is
  saved to the shared catalog and the profile decides which ones are linked as hits.

## 6. Catalog ingestion & deduplication (`ingest.ts`)

Discovered jobs are PUBLIC catalog rows written by the system (owner client).

1. `source + board + external id` (job_source_postings unique) → update / unchanged.
2. Fingerprint (normalized company | title | location) → attach another posting to the
   existing job (multi-source, no duplicate job).
3. Same company on another board: identical description or title similarity ≥ 0.85 in the
   same country → new job **and** a `PENDING` `job_duplicate_candidates` row. Never merged.

Closure only after a complete (untruncated) fetch: missing postings get `removed_at`; a job
closes when none of its postings remain; it reopens if it reappears.

Categories: system rule classification (`user_id NULL`) at ingestion; the user's own terms
and custom categories produce user-scoped assignments during their runs. AI classification
(optional, later) must set `method = AI` and `model`, and never overwrites the job.

## 7. User interface

| Route                              | Purpose                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jobs/profiles`                   | List Search Profiles with their configuration, linked-job count, last/next run; enable/disable, edit, duplicate (disabled copy), delete.                                                                             |
| `/jobs/profiles/new`, `/[id]/edit` | Profile form. Every option is read from the DB (`loadProfileFormOptions`): target markets + any country, locations of the selected countries, categories with term counts, the user's ATS sources with board counts. |
| `/jobs/profiles/configuration`     | Locations per country (add own, remove own), categories (add/remove custom) and search terms (add to any category, remove own). System rows are read-only.                                                           |

| `/jobs/discovery` | Pick a profile, see its full configuration, category terms and the exact boards a run will fetch (`previewDiscovery`), start a run and watch real progress; recent runs with per-run details (`?run=`). |

Running discovery (CP12):

- `POST /api/v1/discovery/runs` `{ profileId }` (JSON only) → `startDiscovery` creates a QUEUED run and
  `after(() => executeDiscoveryRun(...))` executes it once the response is sent (`maxDuration = 300`).
- `GET /api/v1/discovery/runs/:id` → `toDiscoveryRunView` (counters, stage, per-board sync rows; no payloads).
  The page polls every 1.5 s until the status is terminal (SUCCEEDED / PARTIAL / FAILED / CANCELLED).
- An active run (any profile) is resumed on page load; only one active run per user.

| `/jobs/sources` | Per source: status, terms review, boards, last sync/success/test/error, jobs discovered, **health**, Configure, **Test** (live, max 3 boards, no catalog writes) and **History**. |
| `/jobs/sources/[id]` | Source history: every TEST and SYNC run (`source_sync_runs`) newest first — time, kind, board, status, requests, counts, duration, error — plus the health summary. |

Board configuration accepts the board name **or the provider's own careers link**
(`jobs.ashbyhq.com/<board>`, `jobs[.eu].lever.co/<site>`, `[job-]boards[.eu].greenhouse.io/<token>`);
`boardFromUrl` keeps only the first path segment. Other providers' links, other sites and Greenhouse
`embed` links are rejected, and links are never fetched when saved.

Source health (`src/modules/jobs/source-health.ts`, pure + unit-tested) is computed from the latest 20
finished runs of the source: no runs → `UNTESTED` (or `DISABLED`), latest 3 failed in a row →
`FAILING`, any failure in the window → `DEGRADED`, otherwise `HEALTHY`. Manual Entry is
`NOT_APPLICABLE`. Nothing is inferred beyond the recorded runs.

Server Actions live in `src/app/(app)/jobs/profiles/actions.ts` (thin: auth → service). Deleting a profile
removes its hits only; canonical jobs and run history are kept.

## 8. Scheduling (CP14, free)

A Search Profile with an automatic-run interval (`schedule_interval_hours` 24 / 72 / 168) is **due**
when `next_run_at <= now`. Enabling or changing the schedule sets `next_run_at = now + interval`;
every finished run sets it again from its finish time.

**Endpoint** — `POST` (or `GET`) `/api/internal/cron/discovery` with
`Authorization: Bearer <CRON_SECRET>` (`src/config/env.ts`; unset = endpoint returns 404, wrong or
missing secret = 401, constant-time comparison).

1. `claimDueProfiles` (owner client — the only cross-user step; reads `id`, `user_id`, `next_run_at`)
   picks up to `CRON_MAX_PROFILES` (default 5) due, enabled profiles and **claims** each with a
   compare-and-set that moves `next_run_at` one interval ahead. Two overlapping cron calls can never
   claim the same profile.
2. The response (`202 { data: { claimed } }`) is returned; `after()` runs the claimed profiles **one
   after another** through the normal RLS-scoped pipeline with `trigger = SCHEDULED`.
3. A profile whose user already has an active run is retried 30 min later. A profile that cannot run
   (disabled, no boards) keeps its next interval and gets a `CANCELLED` run with the message
   "Scheduled run skipped: …", visible under Recent runs.

**Ways to call it (all free):**

| Option                      | How                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local loop                  | `npm run scheduler` next to `npm run dev` / `npm start` — ticks every `SCHEDULER_INTERVAL_MINUTES` (default 15).                                                             |
| Single tick                 | `npm run scheduler -- --once` from Windows Task Scheduler / cron (exit code 0 = ok).                                                                                         |
| GitHub Actions              | A scheduled workflow running `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/internal/cron/discovery` (only when the app is publicly deployed). |
| Supabase pg_cron (optional) | Only when the app has a public URL. Enable `pg_cron` + `pg_net`, keep the secret in Vault, then:                                                                             |

```sql
-- Supabase SQL editor (optional). Replace the URL; store the secret in Vault first:
-- select vault.create_secret('<CRON_SECRET>', 'jobhunt_cron_secret');
select cron.schedule(
  'jobhunt-discovery-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<your-app>/api/internal/cron/discovery',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'jobhunt_cron_secret')
    )
  );
  $$
);
-- Remove: select cron.unschedule('jobhunt-discovery-tick');
```

pg_cron cannot reach `localhost`; on a local machine use `npm run scheduler`.

## 9. Reliability hardening (CP15)

- **Auto-pause:** when the last `AUTO_PAUSE_AFTER` (5) discovery syncs of a source all failed, the
  source is disabled, `last_error` says "Paused automatically after 5 failed syncs in a row…", and a
  `source_auto_paused` audit entry is written. Manual tests never count. Re-enable it on Sources.
- **Stale work:** runs without a heartbeat for 10 min are failed, and so are their `RUNNING` board
  rows (`error_kind = STALE`). A crashed run marks its unfinished board rows `FAILED` (`INTERNAL`).
- **API errors:** discovery endpoints return 401 without a session, 400 for malformed ids / non-JSON
  bodies, 404 for another user's run; the cron endpoint 404 when disabled, 401 on a bad secret.

## 10. Phase 2 acceptance (verified 2026-09-25)

| #   | Criterion                                                      | Status                   | Evidence                                                                                                             |
| --- | -------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| 1   | Source registry with honest states and ToS review              | ✅                       | `job_sources`, `sources.schemas.ts`; `sources.test.ts`                                                               |
| 2   | 2–4 public ATS adapters + manual entry                         | ✅                       | Ashby, Lever, Greenhouse public posting APIs + Manual; `adapters.test.ts`                                            |
| 3   | Raw posting store                                              | ✅                       | `job_source_postings.raw` (long text stripped)                                                                       |
| 4   | Rate limiting, honest user agent, 429 / Retry-After            | ✅                       | `rate-limiter.ts`, `http.ts`                                                                                         |
| 5   | Run history per discovery and per board                        | ✅                       | `discovery_runs`, `source_sync_runs`; `/jobs/discovery`, `/jobs/sources/[id]`                                        |
| 6   | Per-source health visible                                      | ✅                       | `source-health.ts` + Sources page; `source-health.test.ts`                                                           |
| 7   | Sync scheduling                                                | ✅                       | cron endpoint + `npm run scheduler`; `scheduler.test.ts`                                                             |
| 8   | Re-runs are idempotent                                         | ✅                       | layer-1 dedupe (unchanged/updated), claims never double-run; `discovery.test.ts`                                     |
| 9   | Zero ToS-violating access                                      | ✅                       | only documented public APIs, no scraping, no CAPTCHA/login bypass                                                    |
| 10  | India first-class, configurable locations / categories / terms | ✅                       | seeded config + `/jobs/profiles/configuration`; `discovery.test.ts`                                                  |
| 11  | Search Profiles drive discovery; one job ↔ many profiles       | ✅                       | `job_search_profile_hits`; `discovery.test.ts`                                                                       |
| 12  | Multi-layer dedupe, possible duplicates flagged never merged   | ✅                       | `ingest.ts`; `discovery.test.ts`                                                                                     |
| 13  | Scheduled syncs run unattended for a week                      | ⏳ HUMAN ACTION REQUIRED | Needs a week of `npm run scheduler` against Supabase JOBHUNTOS with real boards; cannot be observed from a test run. |

**Deviation from the original plan:** no separate worker process / pg-boss. Runs execute in-process
after the response (`after()`), triggered by the UI or the cron endpoint; stale-run detection and
atomic claiming replace queue semantics. Free, no extra infrastructure. A queue can be added in
Phase 13 if volumes require it.
