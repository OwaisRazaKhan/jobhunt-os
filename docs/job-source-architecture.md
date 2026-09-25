# Job Source Architecture

Status: design (implementation in Phases 2–3).

---

## 1. Compliance rules (non-negotiable)

1. **Only legitimate access.** A source is integrated only if one of these is true: it offers a public API/feed intended for consumption (e.g. public ATS job-board APIs), we have a partner/API agreement, the employer publishes structured job data (schema.org `JobPosting`) on pages whose `robots.txt` permits access, or the user manually provides the job (paste text / URL).
2. **Never bypass** CAPTCHAs, logins, paywalls, anti-bot systems, rate limits or access controls. No headless-browser evasion, no IP rotation to dodge limits, no fake user agents.
3. **Terms of service are reviewed and recorded** (`job_sources.terms_reviewed_at`, `terms_url`, `access_basis`) before a source can be activated. Platforms whose terms prohibit automated access (many large job boards and professional networks) are **not** scraped; they are supported only via user-provided links/text or official APIs if they become available.
4. **Identify ourselves.** Outbound fetchers send an honest user agent with a contact URL and respect `robots.txt`, `Retry-After`, and `429` responses.
5. **Minimise personal data.** Recruiter names/emails on postings are stored only when the user chooses to save a contact.

---

## 2. Pipeline

```
┌────────────┐   ┌───────────────┐   ┌──────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────┐
│ Job Source │──▶│ Source Adapter│──▶│ Raw Job  │──▶│ Normalizer │──▶│ Canonical Job│──▶│  Dedupe  │──▶ jobs
│ (config)   │   │ fetch + page  │   │ (as-is)  │   │ per adapter│   │ (validated)  │   │ + merge  │
└────────────┘   └───────────────┘   └──────────┘   └────────────┘   └──────────────┘   └──────────┘
      ▲                                    │                                                   │
  scheduler                          raw_job_postings                                  enrichment queue
 (pg-boss cron)                      (payload, hash)                              (Job Analysis Agent, P3)
```

1. **Scheduler** enqueues `source-sync` jobs per active source according to its cadence and rate limit (singleton per source — never two syncs of one source at once).
2. **Adapter** fetches listings (incremental where supported), yields `RawJob` items. Adapters contain all source-specific knowledge; nothing downstream knows about a specific source.
3. **Raw store** upserts into `raw_job_postings` by `(job_source_id, external_id)`; unchanged `content_hash` → only `last_seen_at` updates.
4. **Normalizer** maps a raw payload to the `CanonicalJob` Zod schema (title, company, locations, salary, employment type, remote status, description, apply URL, dates). Rule-based; AI enrichment happens later, asynchronously.
5. **Company resolution** by domain (`company_domains`) → normalised name → create.
6. **Deduplication** finds an existing canonical job or creates one; links the raw posting via `raw_job_postings.job_id`.
7. **Closure detection:** a posting absent from a full sync N times (default 2) gets `removed_at`; a canonical job closes when all its raw postings are removed or `closes_at` passes.
8. **Enrichment** (Phase 3): Job Analysis Agent runs once per canonical job content hash.

---

## 3. Adapter contract

```ts
interface JobSourceAdapter<TConfig> {
  key: string; // "GREENHOUSE", "LEVER", "ASHBY", "SCHEMA_ORG", "MANUAL", …
  configSchema: z.ZodType<TConfig>; // validated when a source is created
  accessBasis: "PUBLIC_API" | "OFFICIAL_FEED" | "PARTNER_API" | "STRUCTURED_DATA" | "USER_PROVIDED";
  capabilities: { incremental: boolean; salary: boolean; closedJobs: boolean };
  defaultRateLimitPerMin: number;
  fetch(
    ctx: AdapterContext,
    config: TConfig,
    cursor?: string,
  ): AsyncIterable<{ items: RawJob[]; nextCursor?: string }>;
  normalize(raw: RawJob): CanonicalJobInput; // pure, unit-testable with fixtures
}

interface AdapterContext {
  http: RateLimitedHttpClient; // enforces per-source rate limits, robots.txt, timeouts, UA
  log: Logger;
  signal: AbortSignal;
}
```

- Adapters are registered in a registry map; adding a source type = one new file + fixtures + tests.
- Each adapter ships recorded fixtures; `normalize` is tested offline. A nightly contract test (optional) detects upstream schema drift.
- Adapters never write to the database; the sync service does.

### Candidate adapters (to be confirmed per ToS review in Phase 2)

| Adapter                                                              | Access basis               | Notes                                                                                             |
| -------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------- |
| `GREENHOUSE`                                                         | PUBLIC_API                 | Public job-board API per company board token                                                      |
| `LEVER`                                                              | PUBLIC_API                 | Public postings API per company                                                                   |
| `ASHBY`                                                              | PUBLIC_API                 | Public job-board API per company                                                                  |
| `SMARTRECRUITERS`, `WORKABLE`, `PERSONIO`, `RECRUITEE`, `TEAMTAILOR` | PUBLIC_API / OFFICIAL_FEED | Common in EU; verify each public endpoint and terms                                               |
| `SCHEMA_ORG`                                                         | STRUCTURED_DATA            | Company career pages exposing `JobPosting` JSON-LD, robots-permitting                             |
| `GOV_FEEDS`                                                          | OFFICIAL_FEED              | Public-sector / employment-agency APIs where they offer open data (e.g. national job-agency APIs) |
| `AGGREGATOR_API`                                                     | PARTNER_API                | Licensed job-data APIs, if we choose to pay for one                                               |
| `MANUAL`                                                             | USER_PROVIDED              | User pastes URL/text; normaliser + Job Analysis Agent structure it                                |

Search engines are used, if at all, only through their official APIs to _discover company career pages_, never to scrape result pages.

---

## 4. Canonical job & deduplication

**Canonical fields** — see `jobs` in database-schema.md.

**Fingerprint** (exact duplicates):
`sha256(company_id | normalize(title) | primary country | primary city | employment_type)`.
Title normalisation lower-cases, strips gender markers (e.g. "(m/w/d)", "(f/h)"), seniority punctuation, and location suffixes.

**Near-duplicate detection** (same job posted on several boards):

1. Candidate set: same `company_id`, overlapping location, posted within ±30 days.
2. Similarity: normalised title similarity + description shingle (MinHash/Jaccard) ≥ threshold.
3. Above high threshold → merge (raw posting links to the existing job). Between thresholds → keep separate, mark `possible_duplicate_of` for review.

**Merge policy:** a canonical job keeps the richest value per field (prefer structured salary over none, ATS source over aggregator), and records which raw posting supplied each field (in `jobs.field_sources jsonb`, added when needed).

---

## 5. Reliability

- **Per-source health**: consecutive failures → `FAILING` → auto-pause after N; surfaced in Settings.
- **Timeouts & retries**: exponential backoff with jitter on 5xx/timeouts; honour `Retry-After`; no retry on 4xx other than 429.
- **Partial failure isolation**: one failing source never blocks others (separate queue jobs).
- **Observability**: every run writes a `source_runs` row (counts, duration, error) with `trace_id`.
- **Re-normalisation**: raw payloads are kept so an improved normaliser (`normalizer_version`) can re-process without re-fetching.

---

## 6. Rate-limit policy

| Layer                            | Mechanism                                                   |
| -------------------------------- | ----------------------------------------------------------- |
| Per source                       | token bucket in the HTTP client, configured per source      |
| Per host (shared across sources) | host-level limiter (many companies share one ATS host)      |
| Global                           | worker concurrency for `source-sync` queue                  |
| Upstream signals                 | `429` / `Retry-After` pause the source until the given time |
