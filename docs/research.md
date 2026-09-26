# Company & Job Research (Phase 5)

Question answered: **what do the job listing and the company's own public sources actually say?**
Research is evidence-first: every factual claim links to the source(s) that support it, and
FACT / INTERPRETATION / INFERENCE / UNKNOWN / CONFLICTING are never mixed up. Unknowns stay unknown.

Phase 5 produces research only. It never writes resumes, cover letters, answers or emails, and it never
applies. Candidate data is not used and nothing is written about the candidate.

Code: `src/modules/research/`. Engine version: `RESEARCH_ENGINE_VERSION` in `types.ts` (`research-1.0`).
Changing it makes existing research STALE.

## 1. Pipeline

```
Route / action / workflow node
  → research.service (validation, ownership, run creation, audit)
    → pipeline.executeResearchRun (background via after(), or inline for workflow)
      → company-resolution (website: never guessed)
      → fetch/session  (robots.txt, rate limits, page + time caps, concurrency 2, retries)
        → fetch/safe-fetch (SSRF-safe HTTP)
      → extract/page, extract/company, extract/job (pure, deterministic)
      → claims (validation, conflicts, stats, completeness, status)
      → synthesis (optional AI, validated)
      → research.repository (Supabase / Postgres, RLS)
```

Each run records **progress steps only after the work happened**, for example: Loaded job ·
Identified company · Searched relevant public sources (or _skipped — no search provider_) · Fetched
company website · Fetched official company pages · Extracted company evidence · Built company research
brief / Reused current company research · Read official job listing · Extracted job evidence · AI
synthesis (or _skipped_) · Validated claims · Built research brief · Complete. Failed and skipped
steps are shown as such.

## 2. Sources

| Source type                                 | Reliability    | How it is obtained                                                                 |
| ------------------------------------------- | -------------- | ---------------------------------------------------------------------------------- |
| OFFICIAL_JOB                                | AUTHORITATIVE  | Stored copy of the listing from the ATS API (not re-fetched)                       |
| MANUAL (job you entered)                    | SECONDARY      | The job text you entered                                                           |
| OFFICIAL_COMPANY / CAREERS / PRODUCT / NEWS | AUTHORITATIVE  | Company website + same-site pages linked from its homepage                         |
| OFFICIAL_BLOG / DOCUMENTATION               | STRONG         | Same-site pages linked from the homepage                                           |
| PUBLIC_NEWS                                 | SECONDARY      | Pages found by the optional search provider, used only if the company is mentioned |
| MANUAL (URL you added)                      | SECONDARY      | A public URL you add, fetched through the same pipeline and never trusted blindly  |
| SEARCH_RESULT                               | DISCOVERY_ONLY | Search hits are hints only, never evidence                                         |

Relevance of fetched public pages: HIGH (company name in the title), MEDIUM (in the text), otherwise
IRRELEVANT. Irrelevant pages are recorded as `SKIPPED_IRRELEVANT` and not used.

**Company website** (`company-resolution.ts`), in priority order:

1. CONFIRMED: set by you on the company page (per user).
2. The shared catalog value (system-derived only).
3. LIKELY: the job's own URL is on a non-job-board domain.
4. LIKELY: a search result whose domain matches the company name exactly.

UNCERTAIN candidates are never used. Without a website the run says **"Company website could not be
confidently identified."** Job boards and ATS hosts (Ashby, Lever, Greenhouse, LinkedIn…) are never
treated as the employer's site. Similar company names are shown as _Company match uncertain_ and are
never merged.

**Search provider** (`search/provider.ts`): an abstraction with no paid provider. Optional free adapter:
a SearXNG instance you run (`SEARXNG_URL`). Without it, official-site discovery and manual URLs still work.

## 3. Depth tiers (bounded)

| Tier     | Max pages | Max time | Pages beyond the homepage                                 | Search                    |
| -------- | --------- | -------- | --------------------------------------------------------- | ------------------------- |
| Quick    | 3         | 45 s     | about                                                     | none                      |
| Standard | 8         | 90 s     | about, careers, 1 product, newsroom, blog                 | 1 query, 2 page fetches   |
| Deep     | 16        | 180 s    | about, careers, 3 products, newsroom, blog, documentation | 2 queries, 4 page fetches |

Manual sources and search pages share an extra allowance of 4 pages. Deep research is never an
unbounded crawl.

## 4. Fetching safety & limits

- **SSRF protection** (`fetch/safe-fetch.ts`, `fetch/ip.ts`):
  - Only http(s) on default ports.
  - No credentials, IP-literal hosts or local/internal names.
  - Every DNS answer is checked inside the socket's own lookup: private, loopback, link-local,
    cloud-metadata, CGNAT, multicast and reserved ranges (IPv4 + IPv6, mapped forms) are refused,
    so there is no rebinding gap.
  - Redirects are followed manually (max 4) and re-validated.
- **Limits:**
  - Response size capped while streaming, compressed and decompressed (default 1.5 MB).
  - 12 s timeout.
  - Only `text/html`, `application/xhtml+xml` and `text/plain` are read.
- **robots.txt:** cached per host per run; longest-match rules. A 4xx on robots.txt means no restrictions;
  5xx or a network error means the whole site is disallowed for the run.
- **Rate limits** (env-configurable):
  - Per user: 30 requests/min and 300/hour.
  - Per host: 12/min (spaced).
  - Per run: page and time caps.
  - Concurrency: 2.
  - One active research run per user (partial unique index).
- **Retries:** only for 5xx, 429, timeouts and network errors, with backoff (max 2). Never for 401, 403,
  404, 451, anti-bot challenges, robots disallow or unsafe URLs. These are recorded as _unavailable_
  and **never bypassed**.
- **External content:** extracted as plain text (scripts, styles, iframes and SVG removed; JSON-LD
  parsed as data). It is stored as text (max 20 000 characters per source) and rendered escaped. Links
  are shown only for safe public URLs, with `rel="noopener noreferrer nofollow"`.

## 5. Evidence and claims

`research_claims` + `research_claim_evidence` (excerpt + source reference) + `research_sources`
(URL, type, reliability, relevance, fetch status, HTTP status, title, published / updated / retrieved
dates, content hash, text).

- **Claim types:** FACT (quoted or structured data from a source) · INTERPRETATION (e.g. "The posting
  emphasizes analytics (7 mentions)", with the supporting lines) · INFERENCE (AI only) · UNKNOWN (stated
  gap, no evidence) · CONFLICTING.
- **Verification:** VERIFIED_FROM_SOURCE (deterministic quote or structured value) · PENDING_REVIEW (every
  AI claim that passed validation) · REJECTED (with a reason) · CONFLICTING.
  The database refuses `method = AI` with `VERIFIED_FROM_SOURCE`.
- **Conflicts:** the same `value_key` (founded year, headquarters, employee count, industry) with
  different values → every version is kept and marked CONFLICTING. Nothing is chosen for you, and
  higher-reliability sources are listed first. The same value from several sources becomes one claim
  with all its evidence.
- **Current vs historical:** dated activity older than 12 months is HISTORICAL and labelled. Publication
  date ≠ retrieval date; both are stored.
- **Company facts** are only recorded when a source states them (never estimated): self-description
  (meta / JSON-LD), products listed on official pages, founding year, headquarters, employee count,
  industry, dated newsroom/blog items, and signals (technology / marketing / growth) as interpretations.
- **Job facts** are quoted from the posting (the original description is never replaced):
  - role summary
  - role purpose (only when stated: "help us build…", "new team"…; otherwise UNKNOWN)
  - responsibilities
  - application instructions
  - requirements (from the Phase 4 requirement set)
  - important terminology (lexicon skills + employer terms with counts; never added to your skills)
  - themes the posting emphasizes (interpretations)
  - related company context (interpretations quoting company evidence)

## 6. AI synthesis (optional)

- Off by default: Research settings → "AI synthesis". Task `research.synthesize` goes through the
  existing AI service; the router picks the provider (Ollama by default). No provider is hard-coded, and
  cloud AI is never required. Only numbered public evidence excerpts are sent (never candidate data),
  inside `<untrusted_evidence>`, with instructions to ignore any instructions in them.
- Output is validated with Zod. Each claim must cite existing evidence IDs, and every number and proper
  noun in it must appear in the cited excerpts. Otherwise it is REJECTED ("No supporting source: “Dubai”
  does not appear in the cited evidence"). Rejected claims stay visible as rejected and never enter the
  brief.
- Accepted claims are PENDING_REVIEW. AI failure or invalid output → deterministic research only.

## 7. Versioning, reuse, freshness

- Every run creates a new version (`company_research` / `job_research`, one current per user + target).
  Old versions are kept with a change summary (claims added/removed, sources whose content changed).
- **Company reuse:** a job run reuses the current company research when all of these hold:
  - it is FRESH or AGING
  - it is not FAILED
  - it is at least as deep as requested
  - it used the same website
  - you did not ask to refresh the company

  Job research records the `company_research_version` it used.

- **Freshness** (per-user settings, default 14 / 45 days): FRESH ≤ fresh days, AGING ≤ stale days, STALE
  beyond. Research is also STALE when:
  - it was invalidated (a source you added, a website or careers change)
  - the job's content changed
  - the company research was refreshed since
  - the engine version changed

  The UI shows the reasons; research is refreshed only when you ask.

- **Source dedupe:** the same normalized URL (host lower-cased, `www.` dropped, tracking parameters
  removed) with the same content hash reuses its row. Changed content creates a new row, so older
  evidence stays intact.

## 8. Status and completeness (deterministic)

- **Status:**
  - FAILED: no source was retrieved.
  - PARTIAL: at least one attempted source failed.
  - NEEDS_REVIEW: conflicts or pending AI claims.
  - COMPLETED: otherwise.

  A job whose company research failed is PARTIAL (never FAILED while the job's own evidence is valid).

- **Completeness checklist:**
  - Official job: ≥ 200 characters.
  - Company website: identified and fetched.
  - Careers page.
  - Role context: purpose stated or ≥ 3 responsibilities.
  - Relevant public activity: checked / found.
  - Sources: ≥ 3 including ≥ 2 authoritative.
  - Claims validated: no pending review or conflicts.

  Each item is COMPLETE, PARTIAL or MISSING. There is no research score.

- **Counts:** sources found / authoritative / strong / secondary / discovery-only / failed, and claims
  verified / pending / rejected / unknown / conflicts.

## 9. Service & workflow contract

- `researchJob(actor, {jobId, options})`, `researchCompany(actor, {companyId, options})`,
  `refreshResearch(actor, {researchId})`, `startJobResearch` / `startCompanyResearch` (background).
- `runResearchNode(actor, {jobId | companyId, options: {depth, refreshCompany, reuseIfFresh}})` for the
  future [RESEARCH] node. It returns a serializable, versioned result:
  - `schemaVersion`, `engineVersion`, `status`, `freshness`
  - `jobResearch`, `companyResearch`
  - `forTailoring` (companyPositioning, rolePriorities, importantTerms, relevantCompanyContext,
    recentRelevantActivity, verifiedRoleRequirements, openQuestions)
  - `evidenceIds`, `unknowns`
- Export: `GET /api/v1/research/jobs/[id]/export?format=md|json`.
- Progress: `GET /api/v1/research/runs/[id]`.

Phase 4 context: job research stores a reference to the current match (id, status, time) and never
changes it.

## 10. Data & privacy

All research tables are user-scoped with owner-only RLS (child rows must reference parents owned by the
same user). Companies and jobs stay shared; the company's `official_website` is only written by the
system from a PUBLIC catalog job URL. Notes are private USER_NOTEs, never treated as public facts.

Audit actions:

- research_started / completed / failed / refreshed / invalidated
- source_added
- claim_created / claim_rejected / claim_conflict (counts)
- manual_note_added / manual_note_deleted
- research_settings_updated, company_target_updated

Logs contain metadata only (ids, counts, status, durations, provider), never page content.

## 11. UI

- `/jobs/[id]` Research card:
  - states: not run, researching (live steps), completed, stale with reasons, DB out of date
  - shows company, role, priorities, context, terms, unknowns, counts
  - actions: Refresh, View sources & evidence, Open company
- `/jobs/[id]/research`:
  - full brief with evidence drawers per claim
  - conflicts section; rejected AI claims (collapsed)
  - sources table (including failures and why)
  - completeness, history (`?version=`), manual sources, private notes, Markdown / JSON export
- `/companies`: companies of visible jobs with your research status.
- `/companies/[id]`:
  - website (with origin and confidence) and a form to confirm it or the careers page
  - summary, facts, conflicts, products, activity, signals, unknowns, sources
  - jobs from the company, history, manual sources, notes
  - "Current research available" + refresh
- `/research`: your researched jobs, recent runs (status, sources, requests, duration), research
  settings, depth tiers, search-provider state.

## Known limitations

- Pages that render content only with JavaScript expose little text to the extractor (no headless
  browser is used).
- Without a website from the job URL or a search provider, you must confirm the company website once.
- Rate limits are per process (in-memory), like the discovery limiter.
- Activity detection relies on dated items (`<time>`, JSON-LD) on newsroom/blog pages.
