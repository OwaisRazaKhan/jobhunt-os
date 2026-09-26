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
| 2                    | Deterministic matcher                                                                                                                                 | ⏳     |
| 3                    | Match persistence (history), explanations, Job Detail card, Match Detail page, staleness, recalculation                                               | ⏳     |
| 4                    | Optional Ollama semantic assistance                                                                                                                   | ⏳     |
| 5                    | Batch matching                                                                                                                                        | ⏳     |
| 6                    | Job database integration                                                                                                                              | ⏳     |
| 7                    | Final integration                                                                                                                                     | ⏳     |

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

### Extraction (`src/modules/matching/requirements/extract.ts`, `rules-2`)

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
