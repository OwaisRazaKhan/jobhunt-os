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

Server Actions live in `src/app/(app)/jobs/profiles/actions.ts` (thin: auth → service). Deleting a profile
removes its hits only; canonical jobs and run history are kept.
