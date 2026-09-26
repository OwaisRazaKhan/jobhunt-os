# JOBHUNT OS — Technical Documentation

These documents are the **technical source of truth**. Code that contradicts them is a bug in either the code or the doc — fix one of them in the same change.

| Document                                                   | Covers                                                                                                                                                           |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)                       | Principles, stack, runtime architecture, module boundaries, directory structure, background jobs, observability, errors, environments, testing, CI, decision log |
| [database-schema.md](./database-schema.md)                 | Conventions, every planned table, keys, indexes, constraints, enums, deletion & retention                                                                        |
| [domain-architecture.md](./domain-architecture.md)         | Candidate knowledge & verification, international jobs, eligibility, matching, documents, application state machine, workflow definition & execution             |
| [ai-architecture.md](./ai-architecture.md)                 | AI service → router → provider adapters, grounding, prompt versioning, cost, the 11-agent catalog                                                                |
| [job-source-architecture.md](./job-source-architecture.md) | Compliance rules, adapter contract, ingestion pipeline, normalisation, deduplication, reliability                                                                |
| [job-discovery.md](./job-discovery.md)                     | Search Profiles, locations/categories config, discovery pipeline, ingestion and deduplication                                                                    |
| [job-search.md](./job-search.md)                           | Phase 3: catalog search, filters, saved searches, bookmarks / hidden jobs, indexes                                                                               |
| [matching.md](./matching.md)                               | Phase 4: requirement model, extraction, skill lexicon, matching engine (by checkpoint)                                                                           |
| [api-architecture.md](./api-architecture.md)               | Transports, conventions, error envelope, planned endpoints per domain                                                                                            |
| [frontend-architecture.md](./frontend-architecture.md)     | Routes, component organisation, state/data, design system, dashboard plan                                                                                        |
| [security.md](./security.md)                               | Threat model, auth, authz, OAuth, secrets, encryption, rate limits, uploads, audit, **privacy**                                                                  |
| [setup.md](./setup.md)                                     | Supabase, storage, secrets, Ollama, local sandbox, maintenance                                                                                                   |
| [candidate-intelligence.md](./candidate-intelligence.md)   | Phase 1 as built: facts, provenance, pipeline, review, scoring, duplicates                                                                                       |
| [roadmap.md](./roadmap.md)                                 | Phases 0–13 with objectives, dependencies, outputs, success criteria, exclusions                                                                                 |
| [risks.md](./risks.md)                                     | Technical risks and mitigations                                                                                                                                  |

## Changing the architecture

1. Update the relevant document(s) and add/adjust a row in the decision log (architecture.md §12).
2. Schema changes: update database-schema.md in the same PR as the Prisma migration.
3. New dependency: justify it in the PR description (what it replaces, why not built-in).
