# Candidate Intelligence (Phase 1, as built)

This subsystem is the source of truth about the candidate for every later phase. Design rules come from [domain-architecture.md §1](./domain-architecture.md). This document describes what was implemented.

## Code map

| Path                                         | Responsibility                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/modules/candidate/schemas.ts`           | Zod input contracts for every section, the profile, preferences and onboarding. They are client-safe and shared by forms, fact approval and AI mapping. |
| `src/modules/candidate/facts.service.ts`     | Generic CRUD, verify, soft delete and restore for the 9 fact sections                                                                                   |
| `src/modules/candidate/sections.ts`          | Registry: section kind → table, audit actions, derived columns                                                                                          |
| `src/modules/candidate/provenance.ts`        | Verification rules (a fact is never _created_ as VERIFIED)                                                                                              |
| `src/modules/candidate/profile.service.ts`   | Profile (encrypted contact fields), onboarding state, preferences, target locations                                                                     |
| `src/modules/candidate/documents.service.ts` | Upload validation, storage, processing pipeline, staging of fact candidates                                                                             |
| `src/modules/candidate/extraction/`          | `extract-text` (PDF/DOCX/TXT), `parse-rules` (deterministic CV parser), `ai-extract` (optional Ollama)                                                  |
| `src/modules/candidate/review.service.ts`    | Fact Review Center: approve / edit / reject / safe bulk                                                                                                 |
| `src/modules/candidate/knowledge.service.ts` | Retrieval API plus the dashboard read model                                                                                                             |
| `src/modules/candidate/scoring.ts`           | Deterministic completeness, warnings and readiness                                                                                                      |
| `src/modules/candidate/duplicates.ts`        | Deterministic duplicate detection                                                                                                                       |
| `src/modules/candidate/account.service.ts`   | Export, delete candidate data, account file purge, activity, retention purge                                                                            |
| `src/server/db.ts`                           | `withUserContext()`: user-scoped transaction under the RLS role                                                                                         |
| `src/server/ai/*`                            | AI service → model router → Ollama adapter                                                                                                              |
| `src/server/storage.ts`                      | Supabase Storage (and local/memory implementations for dev and tests)                                                                                   |

## Fact model and provenance

Facts live in typed tables (`candidate_education`, `candidate_experiences`, `candidate_projects`, `candidate_achievements`, `candidate_skills`, `candidate_certifications`, `candidate_portfolio_items`, `candidate_languages`, `candidate_work_authorizations`). Each table carries the same provenance columns:

`verification_status` · `source_type` · `source_document_id` · `source_fact_candidate_id` · `source_excerpt` · `confidence` · `verified_at` · timestamps · `deleted_at`

- **Fact reference:** `"<kind>:<uuid>"`. `resolveFactRefs()` resolves references to facts the caller owns, which lets later AI generation be required to cite fact IDs.
- **Retrieval:** `getCandidateFacts`, `getVerifiedCandidateFacts` (VERIFIED only), `getUsableCandidateFacts` (VERIFIED + USER_PROVIDED), `getFactsByCategory`. Work authorization is flagged `sensitive` and can be excluded. `getFactsForJobContext` is intentionally deferred to the matching phase.
- **Dates** are partial (`YYYY` or `YYYY-MM`, enforced by a DB check), so a CV that says "2020" never becomes an invented "January 2020".

### Verification rules (enforced in code, and the first two in the DB)

| Rule                                                        | Where                                                                                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Facts cannot be created as VERIFIED                         | `assertCreatable()` plus the DB check `verification_status <> 'VERIFIED' OR verified_at IS NOT NULL` |
| Extracted candidates can only be NEEDS_REVIEW / AI_INFERRED | DB check on `candidate_fact_candidates.proposed_status`                                              |
| VERIFIED only via an explicit user action                   | `verifyFact()` (Verify button) or individual approval in the review center                           |
| Editing content resets the fact to USER_PROVIDED            | `updateFact()`, `updateProfile()`                                                                    |
| Bulk approval never verifies                                | `bulkApproveCandidates()` adds facts as USER_PROVIDED; the UI says so before confirming              |
| AI output never touches `verification_status`               | The AI schema has no such field; the mapped payload goes through section schemas                     |

## Document pipeline

```
upload (route handler) → size / type sniff / dedupe (sha256) → Supabase Storage (private) → candidate_documents (UPLOADED)
  → after(): PROCESSING → extract text (unpdf / mammoth / utf-8)
      ├─ failure → FAILED with a clear message (e.g. scanned PDF: "No readable text was found…"); nothing invented
      └─ success → deterministic parser  ─┐
                   optional Ollama (local) ┴→ merge → validate with section schemas → duplicate flags
                   → candidate_fact_candidates (PENDING, NEEDS_REVIEW) → PROCESSED
```

- **AI grounding:** each AI fact's excerpt must appear verbatim in the document, and dates must occur in the text; otherwise the fact is discarded. Confidence is capped at 0.8. Schema-invalid output is recorded as `SCHEMA_INVALID` with no output and never becomes a candidate.
- **Reprocessing** replaces pending candidates for that document. Approved facts are untouched.
- **Deleting a document** removes the file and its pending candidates. Approved facts keep their excerpt and source type; `source_document_id` becomes NULL.
- **Background work** uses Next.js `after()`, which is free and needs no worker. A document stuck in PROCESSING for more than 10 minutes can be reprocessed. Phase 2 introduces the real queue.

## Fact Review Center

- **Approve** creates the fact with document provenance, then marks it VERIFIED (the individual review counts as the user's verification).
- **Edit** approves the user's edited version, validated by the same schema as manual entry, and marks it VERIFIED.
- **Reject** saves nothing. For duplicates the button reads "Discard duplicate"; for profile fields that would replace an existing value it reads "Keep current value".
- **Bulk add** is only possible for candidates with no duplicate flag, confidence ≥ 0.6, and a category other than profile field. They are saved as USER_PROVIDED. Bulk reject is always allowed.

## Profile completeness (deterministic)

The weights sum to 100 and are defined in `COMPLETENESS_WEIGHTS`:

| Item               | Weight | Full credit when                                  |
| ------------------ | ------ | ------------------------------------------------- |
| Basic information  | 15     | name, headline, location, contact method (¼ each) |
| About              | 5      | summary present                                   |
| Education          | 10     | ≥ 1 record                                        |
| Experience         | 15     | ≥ 1 record                                        |
| Skills             | 10     | ≥ 5 skills (proportional below)                   |
| Projects           | 10     | ≥ 1 project                                       |
| Portfolio          | 5      | a portfolio item or portfolio/website/GitHub URL  |
| Languages          | 5      | ≥ 1                                               |
| Career goals       | 5      | career goal present                               |
| Target roles       | 5      | ≥ 1                                               |
| Target countries   | 5      | ≥ 1                                               |
| Work preferences   | 5      | work mode and employment type (½ each)            |
| Work authorization | 5      | ≥ 1 country record                                |

Certifications are optional, so they carry no weight; many strong candidates have none.

## Readiness (separate from completeness)

- **INCOMPLETE:** no name; no experience and no project; no skill; no target role; no target country; or completeness below 60%.
- **NEEDS_REVIEW:** pending extracted facts, saved facts in NEEDS_REVIEW/AI_INFERRED, or unresolved duplicate records.
- **READY:** otherwise. The dashboard also shows "_x_ of _y_ facts verified by you".

## Warnings

Warnings are deterministic and are defined in `computeWarnings()`:

- missing name, headline, education, experience, skills, projects, target roles, target countries or portfolio URL
- work authorization not specified, including per target country
- overlapping experience dates
- experience without a start date
- project without a description
- a manually added skill that no experience or project mentions
- possible duplicate records
- facts pending review

## Duplicate detection

Keys are normalized by removing case, spacing, punctuation and diacritics; organizations also have legal suffixes (Ltd, GmbH, …) stripped. So "LeadZing", "Lead Zing" and "Lead Zing Ltd" match, while "C#" and "C++" stay distinct. Matching uses a Sørensen–Dice bigram similarity of at least 0.85; when both records have a secondary key (title or degree), it must also agree. Nothing is merged automatically: matches become flags in review and warnings on the profile.

## Onboarding

There are 14 steps (basic → review). Each step can be saved as a draft, skipped, revisited, or left for later. State is stored in `candidate_profiles.onboarding_state`, and finishing the review step sets `profile_status = ACTIVE`.

## Audit events

`profile_created/updated/verified`, `onboarding_updated/completed`, `<section>_created/updated`, `fact_verified/deleted/restored`, `preference_updated`, `target_locations_updated`, `document_uploaded/processed/processing_failed/deleted/downloaded`, `fact_created/approved/edited/rejected`, `data_exported`.

Metadata holds field names, counts and statuses only, never values. The Activity page renders the audit log as a timeline.
