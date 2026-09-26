# Matching Engine (Phase 4)

Question answered: **based on the candidate's stored evidence and the job's stated requirements,
how well do they align?** It is a requirements-alignment engine — never a prediction of hiring,
interview or offer chances, and never a judgement of the person.

Search Profile (what I want to find) ≠ Candidate Profile (who I am) ≠ Match (alignment).

## Status by checkpoint

| CP                   | Scope                                                                                                                                                 | Status |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Foundation (earlier) | `job_requirements`, `job_matches`, `job_match_dimensions`, RLS, Zod result contract, evidence validation (`saveMatchResult`), freshness hashes        | ✅     |
| 1                    | Requirement model: deterministic extraction, required / preferred / informational / unknown, categories, versioned sets, persistence, Job Detail card | ✅     |
| 2                    | Deterministic matcher (per-requirement evaluators, aggregation, cases A–H)                                                                            | ✅     |
| 3                    | Match persistence (history), explanations, Job Detail card, Match Detail page, staleness, recalculation                                               | ✅     |
| 4                    | Optional Ollama semantic assistance                                                                                                                   | ✅     |
| 5                    | Batch matching                                                                                                                                        | ✅     |
| 6                    | Job database integration                                                                                                                              | ✅     |
| 7                    | Final integration                                                                                                                                     | ✅     |

## 1. Requirement model (CP1)

Migration `20260930000000_phase4_requirement_sets`.

- **`job_requirement_sets`** — one immutable, numbered extraction per job: `version`,
  `extractor_version`, `job_content_hash`, `is_current` (partial unique index: one current set per
  job), `requirement_count`. A new extraction supersedes the old set; old sets and their rows are kept
  so earlier matches stay traceable.
- **`job_requirements`** — now `set_id`, `position`, `category` ∈ SKILL, EXPERIENCE, EDUCATION,
  LOCATION, WORK_MODE, EMPLOYMENT, SALARY, AUTHORIZATION, LANGUAGE, CERTIFICATION, DOMAIN,
  PORTFOLIO, OTHER and `requirement_type` ∈ REQUIRED, PREFERRED, INFORMATIONAL, UNKNOWN (split from
  the foundation's combined categories; legacy rows are migrated into a `legacy` set v1).
- Every requirement keeps `text`, `normalized_value` (structured, per category), `source_text`
  (verbatim job wording), `source_reference` (`job.<field>` or `description:L<line>`), `confidence`,
  `extraction_method` (RULE / AI / USER), `extractor_version`.
- RLS: requirements and sets are readable when the job is visible. Sets of shared jobs are written by
  the system; owners may write sets for their own private jobs (method USER). Users can never write
  sets for shared jobs (tested).

### Extraction (`src/modules/matching/requirements/extract.ts`, `rules-3`)

Deterministic, no AI. Job text is untrusted and only pattern-matched.

1. **Structured job fields** → WORK_MODE, LOCATION (required for on-site/hybrid, informational for
   remote), EMPLOYMENT, SALARY (informational), seniority wording from the title (informational),
   visa text (AUTHORIZATION).
2. **Description sections** — headings are detected (never bullet lines): Requirements /
   Qualifications / What you'll bring → REQUIRED; Nice to have / Preferred / Bonus → PREFERRED;
   Responsibilities, Benefits and About us produce nothing unless a line explicitly states a
   requirement. Without headings, only explicit cues count ("must", "a plus", "experience with").
3. **Per line**: years of experience (ranges, "professional", domain, skills named in it), degree
   level + field (+ "or related field" / "or equivalent experience"), languages + level, work
   authorization / sponsorship (available / unavailable / citizenship) + region, certifications,
   portfolio, relocation, travel %, driving licence, clearance, shifts, availability, domain (B2B,
   SaaS …), and skills from the lexicon. "X or Y" skills are stored as alternatives (`anyOf`).
4. The same requirement stated twice keeps the strongest type.

### Skill lexicon (`src/modules/matching/skills.ts`, `skills-1`)

Aliases are true equivalents (GA4 = Google Analytics 4, JS = JavaScript, Postgres = PostgreSQL, SEO =
Search Engine Optimization). `related` links are explicit (GA4 ↔ Google Analytics) and are never
exact matches. Broad equivalences (React/Angular, Photoshop/Figma, Digital/Performance Marketing) are
not encoded. Ambiguous spellings (Excel, Node, REST, Go, Make, PR) are only recognised as a complete
skill name, never in free text.

### When extraction runs

- On Job Detail, when the job has no current set, its content hash changed, or the extractor version
  changed (`ensureJobRequirements`; concurrent requests are serialised with a row lock).
- After discovery ingestion for every touched job (`refreshRequirementsForJobs`, unchanged jobs are
  skipped, failures never break ingestion).
- User-maintained sets of private jobs (`extractor_version = user`) are never overwritten.

## 2. Deterministic matcher (CP2) — `src/modules/matching/engine/`

Pure functions: `computeMatch({requirements, candidate, settings, now, jobCountryCode})` →
per-requirement results + counts + dimension summaries + overall status + grounded summary.
Same input → same output (tested). Engine version: `MATCHING_VERSION` in `types.ts` (`engine-2.0`).

**Evidence rules.** Only `VERIFIED` / `USER_PROVIDED` facts can satisfy a requirement. A requirement
supported only by `NEEDS_REVIEW` / `AI_INFERRED` facts is **UNVERIFIED** (never MATCHED). Evidence is
ranked verified > user-provided > needs review > AI-inferred; each result cites up to 3–5 facts
(`<kind>:<uuid>` refs + label + excerpt + provenance).

**Result statuses:** MATCHED · RELATED (related, not exact) · PARTIAL · GAP · UNKNOWN · UNVERIFIED ·
CONFLICT (your records disagree) · BLOCKED (hard block) · NOT_APPLICABLE (not assessed).
**Gap kinds:** REQUIRED (stated required) · PREFERRED (preferred or importance unclear) ·
PREFERENCE (the job differs from _your_ preferences — not a qualification gap).

| Category                                   | Rule                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SKILL                                      | Candidate skills + experience `skillsUsed`/text + project skills/technologies/text (text only via the curated lexicon). Same canonical key → MATCHED/EXACT (GA4 = Google Analytics 4). Explicit lexicon relation → RELATED. "X or Y" groups assessed once. Else GAP.   |
| EXPERIENCE                                 | Months from structured dates only; overlapping roles merged (never double counted). Relevance by domain terms / domain skills. "Professional" excludes volunteer work; projects never count as experience. ≥ min → MATCHED; ≥ 50 % → PARTIAL; else GAP. Never a block. |
| EDUCATION                                  | Level order diploma < associate/any degree < bachelor < master < doctorate. In-progress ≠ completed (PARTIAL). Level ok + field differs → PARTIAL. Undatable/unknown level → UNKNOWN.                                                                                  |
| LANGUAGE                                   | CEFR A1…C2, native; fluent ≈ C1, professional ≈ B2. Never inferred from country or education. Conflicting records → CONFLICT.                                                                                                                                          |
| CERTIFICATION                              | Name / skill overlap; expired → PARTIAL.                                                                                                                                                                                                                               |
| PORTFOLIO                                  | Portfolio items or profile portfolio URL. GitHub / LinkedIn are **not** a portfolio.                                                                                                                                                                                   |
| AUTHORIZATION                              | Missing → UNKNOWN. Explicit _sponsorship not available_ + recorded _sponsorship required / not authorized_ (or preference “needs sponsorship = yes”) → **BLOCKED**. Requires authorization + recorded _not authorized_ → **BLOCKED**. Citizenship → UNKNOWN.           |
| WORK_MODE / EMPLOYMENT / LOCATION / SALARY | Compared with your preferences. Mismatch → PREFERENCE gap, or **BLOCKED** only if you marked that preference mandatory in Matching settings. Salary: different currencies are never converted; hourly is never compared with yearly/monthly.                           |
| DOMAIN / OTHER                             | Domain: word search in experience/projects. Travel, licence, clearance… → UNKNOWN (“not recorded in your profile”).                                                                                                                                                    |

**Overall status** (`aggregate.ts`), never a numeric score (`summary_score` stays NULL):

- any hard block → **BLOCKED** (reason = the blocking requirement(s) with evidence);
- fewer than 2 substantive requirements (skills, experience, education, language, certification, portfolio, domain, authorization) → **INSUFFICIENT_DATA** ("This job does not contain enough structured requirements for a reliable match.");
- < 50 % of substantive (or required) requirements assessable → **INSUFFICIENT_DATA** (profile too thin);
- otherwise weighted ratio (required = 2, other = 1; matched 1, related/partial 0.5, gap 0):
  **STRONG_MATCH** ≥ 0.85 with 0 required gaps and ≤ 1 preference conflict · **GOOD_MATCH** ≥ 0.65 with ≤ 1 required gap ·
  **PARTIAL_MATCH** ≥ 0.4 · else **LOW_MATCH**.

"Requirements alignment" per dimension shows matched vs assessed counts only.

## 3. Persistence, history, staleness (CP3) — `match.service.ts`

`matchCandidateToJob(actor, candidateId | null, jobId, options)` is the single reusable entry point:
ensure requirement set → load the caller's evidence + matching settings under RLS → compute →
optional AI assist → store. Every calculation is a **new version** (`job_matches.is_current`, one
current per user+job); older versions are kept and viewable (`/jobs/[id]/match?version=`).
Per-requirement results live in `job_match_requirement_results`.

- **Idempotent:** unchanged inputs (same engine version, candidate hash, job hash) return the current
  match. A per-user+job advisory lock prevents duplicate versions from double clicks.
- **Staleness:** candidate hash = content of all facts + provenance + preferences + matching settings;
  job hash = content hash + requirement-set id/version. Changed → `STALE`; engine version changed →
  `REQUIRES_RECALCULATION`. Computed on read, shown on card, detail page, lists.
- **Errors:** job not visible / invalid id → NOT_FOUND; no candidate profile → "Complete your candidate
  profile before running a match."; AI failure → deterministic result; DB failure → nothing stored.
- **Audit:** `match_completed` / `match_recalculated` / `match_batch_*` / `matching_preferences_updated` (metadata only).
- **Logging:** status, counts, duration — never profile or job text.

## 4. Optional semantic assistance (CP4) — `semantic.ts`

Off by default (Matching settings → "Local AI skill assistance"). Task `matching.semantic_skills`,
`personalData: true` → local providers (Ollama) only. The AI may only propose that a **SKILL GAP** is
**RELATED** to one of your usable skills. It never produces MATCHED, never creates/removes hard blocks,
never touches other categories. Output is Zod-validated; every `requirementId` and `factRef` must be one
we sent — any unknown reference rejects the whole output (`REJECTED`). Job text is sent inside
`<untrusted_job_requirements>` and the system prompt says it is untrusted data. AI results are stored
with `method = AI_ASSISTED` (DB check allows it only for RELATED) and labelled "AI-assisted" in the UI.
`semantic_assist` on the match records NOT_USED / NOT_NEEDED / UNAVAILABLE / APPLIED / REJECTED.

## 5. Batch matching (CP5) — `batch.service.ts`

Explicit only ("Match these jobs" on /jobs, "Recalculate N stale" on /matches). 1–200 jobs, one
active batch per user (partial unique index), runs after the response (`after()`) in chunks of 10
with real progress (`done/failed/skipped/counts`), heartbeat, and cooperative cancel. A batch without a
heartbeat for 10 minutes is marked FAILED when the next one starts. Progress: `GET /api/v1/matching/batches/[id]`.

## 6. Job database integration (CP6)

- Job list rows show the stored match badge (+ stale). Listing jobs never computes matches.
- Job search filter `match=` (Strong/Good/Partial/Low/Blocked/Insufficient data/Not matched yet), reflected in chips and saved searches.
- Job Detail: Match card (states: no profile, not matched, calculating, completed, stale, requires recalculation, DB out of date / error).
- `/jobs/[id]/match`: filters All / Matched / Gaps / Unknown / Required / Preferred / Hard blocks, expandable job wording + your evidence, alignment, calculation metadata, history.
- `/matches`: current matches with status filter, batch progress/cancel, matching settings.

## 7. Workflow node contract (future canvas) — `workflow.ts`

`runMatchingNode(actor, {candidateId, jobIds?, threshold?, options?})` →
`{matchedJobs, partialJobs, blockedJobs, unknownJobs}`. Without `jobIds` it uses the user's bookmarked
jobs. It only computes and stores matches — no outbound action.

## Known limitations

- Rule-based extraction and a curated skill lexicon: unusual wording can be missed (shown as fewer requirements, never invented).
- Related skills come only from explicit lexicon relations (or validated local AI suggestions).
- Work authorization regions: country codes plus EU; other regional groupings stay UNKNOWN.
- Batches run in-process after the response; a server restart mid-batch leaves it to be marked FAILED on the next start.
