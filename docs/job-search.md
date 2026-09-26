# Job Search — Phase 3 as built

Phase 3 turns the discovered catalog into a job-search workspace: server-side search, filters,
sorting, pagination, saved searches, bookmarks and hidden jobs. Migration:
`prisma/migrations/20260929000000_phase3_job_search`.

Search Profile (**what I want to find**, Phase 2) ≠ Saved Search (**a saved /jobs query**, Phase 3)
≠ Candidate Profile ≠ Matching (Phase 4). Nothing in Phase 3 evaluates the candidate.

## 1. What already existed (reused, not duplicated)

`jobs` already had every catalog field (country, city, region, raw + normalised work mode /
employment type / experience level, salary with currency + period, posted / discovered / last-seen,
status, URLs, content hash). Multi-source (`job_source_postings`), categories with provenance
(`job_category_assignments`: method, confidence, classifier version), job ↔ Search Profile ↔ run
(`job_search_profile_hits`) and the full Search Profile system were built in Phase 2.

## 2. Database changes

| Change                                                                                                                                                                                              | Purpose                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `jobs.search_vector` — generated `tsvector` (`simple` config): title + normalised title (A), location / city / region / department / team (B), first 20k chars of description (C); GIN index        | Full-text search, prefix matching, multilingual (no stemming)                              |
| Indexes `(country_code, remote_status)` (replaces `country_code`), `posted_at DESC NULLS LAST`, `discovered_at DESC`, `last_seen_at DESC`, `source_key`; `job_source_postings (source_key, job_id)` | Filters, freshness, sorting, source filter / counts                                        |
| `user_job_states` (user_id, job_id unique, `bookmarked_at`, `hidden_at`)                                                                                                                            | Per-user bookmark / hide; never touches the shared job. A row with neither set is deleted. |
| `saved_searches` (user_id, name unique per user, `params` jsonb ≤ 8 KB, `last_run_at`)                                                                                                              | Saved /jobs query + filters                                                                |

RLS: both new tables are owner-only (`user_id = app_current_user_id()`); `user_job_states` inserts
also require the job to be visible. `anon` / `authenticated` have no access.

## 3. Search & filters (`src/modules/jobs/search`)

`params.ts` (client-safe) defines the URL state and a lenient parser: invalid values are dropped and
reported, lists are capped, the query is capped at 200 characters. `search.repository.ts` builds
parameterised SQL (`Prisma.sql`, no string interpolation of user data); `search.service.ts`
(`searchJobs`) returns one page, the total and real source counts. It is UI-independent so later
workflow nodes can call it.

| URL param                                   | Behaviour                                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`                                         | Up to 8 prefix tokens; each must match the search vector **or** the company name                                                                                                                                                                                                          |
| `country`, `loc`                            | ISO codes; configured locations (name + aliases, city / region / raw text). A location constrains only its own country; `REMOTE_COUNTRY` = remote jobs in that country                                                                                                                    |
| `cat`                                       | System or own categories (a job may have several)                                                                                                                                                                                                                                         |
| `mode`, `type`, `exp`                       | Exact values; `UNKNOWN` only when selected (never treated as remote)                                                                                                                                                                                                                      |
| `salMin`, `salMax`, `cur`, `per`, `salOnly` | Needs a currency. Only same-currency (and same-period, when chosen) salaries are compared; others are kept and labelled `CURRENCY_NOT_COMPARABLE` / `PERIOD_NOT_COMPARABLE`, unknown ones `NOT_STATED` (never zero). `salOnly=1` keeps only comparable, in-range jobs. No exchange rates. |
| `src`                                       | Primary source or any additional posting. Counts are distinct matching jobs per source, computed with all other filters                                                                                                                                                                   |
| `status`                                    | OPEN / CLOSED / STALE / UNKNOWN                                                                                                                                                                                                                                                           |
| `posted`, `disc`, `seen`                    | Within 1 / 3 / 7 / 14 / 30 / 90 days                                                                                                                                                                                                                                                      |
| `profile`                                   | Jobs linked to one of the user's Search Profiles                                                                                                                                                                                                                                          |
| `sort`                                      | Allowlist: newest (posted, nulls last), discovered, seen, salary (only with a currency — ranks that currency), company, title                                                                                                                                                             |
| `page`                                      | 25 per page, max page 400                                                                                                                                                                                                                                                                 |

Hidden jobs are excluded from normal results; `/jobs/bookmarked` and `/jobs/hidden` are views over
the same query.

## 4. UI

| Route                                                              |                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/jobs`                                                            | Search + filter panel, removable active-filter chips, result count, sort, save search, results (table ≥ 1280 px, cards below), pagination, loading / empty / error ("Could not load jobs." + Retry)                                |
| `/jobs/bookmarked`, `/jobs/hidden`                                 | Same workspace for bookmarked / hidden jobs; hidden jobs can be restored                                                                                                                                                           |
| `/jobs/saved`                                                      | Saved searches: run, rename, duplicate, delete; `/jobs?saved=<id>` records the run and opens the full URL; "Update with current filters" on /jobs                                                                                  |
| `/jobs/[id]`                                                       | Adds experience level, source wording, city / region, discovered / last seen / closed, all source postings, the Search Profiles that found the job (with run link), categories with method / confidence, bookmark / hide / restore |
| `/search-profiles`, `/search-profiles/new`, `/search-profiles/:id` | Redirect to `/jobs/profiles…` (Search Profile management, Phase 2 CP11)                                                                                                                                                            |

## 5. Audit

`job_bookmarked`, `job_unbookmarked`, `job_hidden`, `job_restored`, `saved_search_created`,
`saved_search_updated`, `saved_search_duplicated`, `saved_search_deleted` (plus the existing
Search Profile events). Individual searches are **not** logged: they are read-only and their text
can be personal.

## 6. Performance (EXPLAIN on 5,000 synthetic sandbox jobs)

Country / work-mode filters use `jobs_country_code_remote_status_idx`; posted-within uses
`jobs_posted_at_idx` in a BitmapAnd with status; typical queries run in 2–25 ms. Text search is
written so the GIN index and the company-id index can be combined (verified with
`enable_seqscan = off`: BitmapOr on `jobs_search_vector_idx` + `jobs_company_id_idx`); at 5k rows the
planner correctly prefers a sequential scan. Unfiltered "newest" pages sort the visible catalog
(top-N heapsort, ~20 ms at 5k); revisit with a keyset index if the catalog grows past ~100k rows.
