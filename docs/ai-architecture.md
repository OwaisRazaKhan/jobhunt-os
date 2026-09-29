# AI Architecture

---

> **Implemented (AI orchestration, migration `20261012000000_ai_orchestration`):** see §0 below. Sections 1–7
> are the original long-term design; where they differ from §0 (e.g. the Anthropic/OpenAI tiers, monthly
> budgets, embeddings), §0 is what the code does today.

## 0. Implemented AI layer

### 0.1 Files

| File                                | Role                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/server/ai/types.ts`            | Provider contract (`AiProvider`), requests/responses, `AiErrorKind`, `AiTask`                          |
| `src/server/ai/registry.ts`         | Task registry: sensitivity, allowed/default providers, fallback, retries, output limits, planned tasks |
| `src/server/ai/router.ts`           | Configured providers + privacy/preference routing → ordered permitted providers                        |
| `src/server/ai/privacy.ts`          | Identifier redaction for cloud requests; untrusted-content rule                                        |
| `src/server/ai/preferences.ts`      | Per-user preferences (`ai_preferences`, RLS) with explicit, timestamped private-cloud consent          |
| `src/server/ai/orchestrator.ts`     | `runAiTask` (the only entry point), provider test, recent activity, health                             |
| `src/server/ai/errors.ts`           | Classified errors, plain-language messages, retryable/unavailable sets, secret redaction               |
| `src/server/ai/providers/ollama.ts` | Local provider (`/api/chat` + JSON-schema `format`; `think:false` for thinking models)                 |
| `src/server/ai/providers/gemini.ts` | Optional cloud provider (official `@google/genai` SDK)                                                 |
| `src/app/(app)/settings/ai/`        | `/settings/ai`: status, tests, routing table, preferences, recent activity                             |

Call sites (all through `runAiTask`): CV extraction (`candidate/extraction/ai-extract.ts`), match assist
(`matching/semantic.ts`), research synthesis (`research/synthesis.ts`), resume tailoring
(`resumes/tailor.service.ts`), email and cover-letter drafting (`communications/generation.service.ts`).
No business module imports a provider.

### 0.2 Task registry

| Task                       | Phase | Sensitivity       | Default              | Allowed        | Fallback      | Retries | Max output |
| -------------------------- | ----- | ----------------- | -------------------- | -------------- | ------------- | ------- | ---------- |
| `candidate.extract_facts`  | 1     | PRIVATE_CANDIDATE | ollama               | ollama, gemini | rules         | 1       | 6000       |
| `matching.semantic_skills` | 4     | PRIVATE_CANDIDATE | ollama               | ollama, gemini | deterministic | 1       | 2000       |
| `research.synthesize`      | 5     | PUBLIC            | `AI_PUBLIC_PROVIDER` | gemini, ollama | evidence only | 1       | 8000       |
| `resume.tailor`            | 6     | PRIVATE_CANDIDATE | ollama               | ollama, gemini | deterministic | 1       | 4000       |
| `email.generate`           | 7     | PRIVATE_CANDIDATE | ollama               | ollama, gemini | manual        | 1       | 3000       |
| `cover_letter.generate`    | 7     | PRIVATE_CANDIDATE | ollama               | ollama, gemini | manual        | 1       | 5000       |
| `application.answers`      | 8     | HIGH_SENSITIVITY  | ollama               | ollama         | deterministic | 1       | 2500       |
| `application.map_fields`   | 8     | INTERNAL          | ollama               | ollama, gemini | deterministic | 1       | 1500       |

Planned (declared, not routable until built): job requirement extraction, resume quality analysis.
`application.answers` never leaves the machine (HIGH_SENSITIVITY); `application.map_fields` sends only
public form labels and fixed key names — never candidate values (see `docs/application-engine.md` §8–9).

### 0.3 Privacy routing (applied before preferences; cannot be overridden by the client)

| Sensitivity       | Ollama | Gemini                                                                                                                                             |
| ----------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUBLIC            | yes    | yes, unless the user turned off "Gemini for public tasks"                                                                                          |
| INTERNAL          | yes    | yes                                                                                                                                                |
| PRIVATE_CANDIDATE | yes    | only if `AI_ALLOW_PRIVATE_GEMINI=true` **and** the user opted in on `/settings/ai` (consent timestamped, audited; DB check requires the timestamp) |
| HIGH_SENSITIVITY  | yes    | never                                                                                                                                              |

Every request to a cloud provider passes the privacy filter first: the user's name, email and phone, and any
email address or 9+-digit phone-like number, are replaced (`[CANDIDATE]`, `[EMAIL]`, `[PHONE]`). Local
requests are not rewritten. Tasks with third-party content get the untrusted-content rule in the system prompt.

### 0.4 Orchestration

`runAiTask`: registry policy → preferences → route → (cloud: redact) → provider → JSON → Zod → record in
`ai_generations` (provider, model, prompt key/version, input hash, output hash, validated output, status,
error kind, tokens, latency, sensitivity, attempt, route reason — **never prompts**) → caller-side
validation (fact references, evidence citations, claim checks).

- **Retries:** bounded by the task (`maxRetries`, 1), only for TIMEOUT, NETWORK_ERROR, GENERATION_FAILED,
  MODEL_LOADING. Quota, invalid key, missing model, rate limiting ("busy, try again") and policy denials are
  never retried. INVALID_OUTPUT is never retried or re-routed: the caller's deterministic path runs.
- **Fallback:** only to another _permitted_ provider, only when the user enabled "automatic fallback", only
  for "unavailable" kinds. Otherwise the task's non-AI fallback runs (rules / deterministic / evidence only).
- **Cache:** PUBLIC + cacheable tasks only, per user, same task + prompt version + input hash, 7 days.
- **Gemini:** the SDK is created with `retryOptions.attempts = 1` (it would otherwise retry 429 up to 5
  times). Gemini 3.x thinking tokens count toward `maxOutputTokens`, so `GEMINI_THINKING_HEADROOM` (2048)
  is added to each task limit; an empty answer with `finishReason=MAX_TOKENS` is INVALID_OUTPUT. 503 "high
  demand" is classified RATE_LIMITED. Health = model metadata call (no tokens).
- **Ollama:** health = `/api/tags`, version and loaded models; thinking models called with `think:false`;
  models are never pulled automatically.

### 0.5 Error kinds

NOT_CONFIGURED · OFFLINE · MODEL_MISSING · MODEL_LOADING · INVALID_API_KEY · QUOTA_EXCEEDED · RATE_LIMITED ·
MODEL_UNAVAILABLE · NETWORK_ERROR · TIMEOUT · GENERATION_FAILED · INVALID_OUTPUT · POLICY_DENIED — each with a
plain-language message (`AI_ERROR_MESSAGES`). Keys are redacted from any error text before logs or UI.

### 0.6 Environment (`src/config/env.ts`)

| Variable                                                 | Default                                           | Meaning                                                                 |
| -------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| `AI_ENABLED`                                             | `true`                                            | Master switch                                                           |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` / `OLLAMA_TIMEOUT_MS` | `http://127.0.0.1:11434` / `llama3.1:8b` / 120000 | Local provider (in use: `qwen3.5:9b`)                                   |
| `AI_DEFAULT_PROVIDER`                                    | `ollama`                                          | Default for non-public tasks with `default` routing                     |
| `AI_PUBLIC_PROVIDER`                                     | `gemini`                                          | Default for PUBLIC tasks                                                |
| `AI_ALLOW_PRIVATE_GEMINI`                                | `false`                                           | Operator switch; required (with user opt-in) for private data on Gemini |
| `GEMINI_API_KEY` / `GEMINI_MODEL` / `GEMINI_TIMEOUT_MS`  | unset / `gemini-3.8-flash` / 60000                | Optional cloud provider; server-only, never `NEXT_PUBLIC_`              |

### 0.7 Data

Migration `20261012000000_ai_orchestration`: `ai_generations` + `attempt`, `output_hash`, `prompt_key`,
`route_reason`, `sensitivity` (CHECK constraint, cache index); new `ai_preferences` (primary provider,
Gemini for public, private-cloud opt-in + consent time, auto-fallback; owner-only RLS). Audit:
`ai_preferences_updated`, `private_cloud_ai_enabled/disabled`, `ai_provider_tested`.

### 0.8 Testing

- `npm test`: unit tests for both adapters (classification, headroom, no SDK retries, redaction), router
  privacy matrix, orchestrator retries/fallback/cache, and each call site with fake providers.
- `REAL_AI=1 npx vitest run tests/real`: real providers from `.env` against an isolated test DB with
  SYNTHETIC facts — Ollama resume tailoring (injected "Python"/"300% growth" blocked), Gemini research
  synthesis (injected claim ignored), Gemini private-data test with explicit opt-in. Skipped (not failed)
  when `REAL_AI` is unset or no `.env` exists.
- `/settings/ai` "Test" buttons send a tiny non-personal request and record it as `system.provider_test`.

## 1. Goals

1. **Provider independence** — swapping or adding a model provider touches one adapter, not call sites.
2. **Grounded output** — agents write only what the candidate knowledge base, job data or cited research supports.
3. **Structured, validated output** — every agent returns JSON validated by a Zod schema; free text is a field inside it.
4. **Traceability** — every generation is stored with model, prompt version, inputs (redacted), outputs, sources, cost.
5. **Bounded cost and blast radius** — budgets, rate limits, least-privilege data access, no autonomous outbound actions.

---

## 2. Layers

```
Module service (e.g. documents.generateJobResume)
        │  calls a typed agent, never a provider
        ▼
┌──────────────────────────────────────────────────────────┐
│ AGENT  (src/modules/<domain>/agents/<name>.ts)            │
│  - declares: task key, input schema, output schema,       │
│    prompt template id+version, data permissions           │
│  - builds context from ALLOWED data only (context builder)│
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ AI SERVICE  (src/server/ai/service.ts)                    │
│  - budget check (per user / month)  - rate limit          │
│  - PII redaction policy per task    - cache by input_hash │
│  - calls router, validates output with Zod, 1 repair retry│
│  - persists ai_generations + ai_generation_sources        │
│  - emits `ai` logs with trace id                          │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ MODEL ROUTER  (src/server/ai/router.ts)                   │
│  task → capability tier → ordered model candidates        │
│  skips providers without keys / user opt-outs / outages   │
│  fallback on retryable errors; circuit breaker per model  │
└───────────────┬──────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────┐
│ PROVIDER ADAPTERS (src/server/ai/providers/*)             │
│  implement AiProvider; map errors → AppError(AI_ERROR)    │
│  ├── Provider A: Anthropic (default)                      │
│  ├── Provider B: OpenAI                                   │
│  └── Provider C: any other (e.g. Google, local/OSS model) │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Provider interface (contract, TypeScript)

```ts
interface AiProvider {
  id: string; // "anthropic" | "openai" | …
  generateStructured<T>(req: {
    model: string;
    system: string;
    messages: AiMessage[];
    schema: z.ZodType<T>; // converted to JSON Schema / tool definition by the adapter
    maxOutputTokens: number;
    temperature?: number;
    signal?: AbortSignal;
  }): Promise<{ output: T; usage: TokenUsage; raw: unknown; model: string }>;
  generateText(req: …): Promise<{ text: string; usage: TokenUsage }>;
  embed?(req: { model: string; input: string[] }): Promise<{ vectors: number[][]; usage: TokenUsage }>;
}
```

### 2.2 Router configuration

Routing is configuration, not code: a map of `task → tier`, and `tier → [model candidates]`, overridable per environment. Model IDs live in config so they can be updated without code changes.

| Tier      | Use                                                              | Default candidates (Sep 2026)                                                               |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `extract` | CV parsing, job requirement extraction, classification           | `claude-haiku-4-5`, then OpenAI small model                                                 |
| `reason`  | matching explanations, eligibility ambiguity, research synthesis | `claude-sonnet-5`, then OpenAI flagship                                                     |
| `write`   | resumes, cover letters, emails, answers                          | `claude-sonnet-5` (Opus 5.5 optional per user)                                              |
| `review`  | Quality Control Agent                                            | a **different** model/provider than the writer where available, to reduce correlated errors |
| `embed`   | skills/jobs embeddings                                           | one embedding model, fixed per index (changing it requires re-indexing)                     |

### 2.3 Prompts

- Prompt templates are versioned files (`src/server/ai/prompts/<agent>/v<N>.ts`) exporting system prompt, instructions and output schema reference.
- A prompt change = new version; generations record `prompt_template_id` + `prompt_version`; eval suite runs on version changes.
- Untrusted content (job descriptions, web pages, emails) is placed in clearly delimited data blocks and the system prompt states it must never be followed as instructions (**prompt-injection defence**). Agents with access to untrusted text have no tools that cause side effects.

### 2.4 Grounding protocol

- Context builders pass facts with IDs, e.g. `[fact:exp_01H…] Senior Engineer at Acme, 2021–2024`.
- Output schemas require `source_ids` on every claim-bearing item (resume bullets, cover-letter claims, answers).
- The AI service rejects outputs that cite IDs not present in the context (hallucinated sources) and triggers one repair attempt; then fails with `AI_ERROR` (`SCHEMA_INVALID` / `UNGROUNDED`).
- The Quality Control Agent and deterministic checks (numbers in output must appear in cited facts; company names must match job data) run before a document can be reviewed.
- Only `VERIFIED` and `USER_PROVIDED` facts are passed to writer agents. `AI_INFERRED` / `NEEDS_REVIEW` facts are excluded from writer context entirely.

### 2.5 Privacy in AI calls

- Per-task **data allow-list** (see permissions below). Contact details, work-authorization details, and salary are excluded unless the task needs them.
- Providers are configured with zero-data-retention / no-training options where the provider offers them.
- `ai_generations.input_redacted` stores inputs with sensitive fields removed; full prompts are not logged.
- Users can disable a provider in AI preferences; the router honours it.

### 2.6 Cost control

- Pre-call token estimate + per-user monthly budget (`AI_MONTHLY_BUDGET_USD`); hard stop with a clear error when exceeded.
- Result caching by `input_hash` for deterministic tasks (job analysis is computed once per job content hash and shared across users because job data is public).
- Batch/async processing for bulk extraction via the worker; prompt caching for large stable system prompts.

---

## 3. Agent catalog

Common rules for all agents: output validated by Zod; persisted as an `ai_generation`; no agent sends messages, submits applications, changes verification status, or deletes data. "Approval" below means a recorded human decision in the product.

### 3.1 Candidate Agent (Phase 1)

|                |                                                                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Extract structured candidate facts from uploaded CVs/text; suggest missing facts; detect conflicts/duplicates.                                      |
| Inputs         | CV text (from `files`), existing profile facts (for dedupe).                                                                                        |
| Outputs        | Candidate facts (experience, education, skills, …) each with `excerpt` + `confidence`; suggestions; conflicts.                                      |
| Permissions    | Read: own candidate profile, uploaded file text. Write: **proposed** facts only (via candidate service) with status `NEEDS_REVIEW` / `AI_INFERRED`. |
| Data required  | CV text; skill taxonomy.                                                                                                                            |
| Failure modes  | OCR/text-extraction garbage; mis-attributed dates; merged roles; invented facts; non-English CVs.                                                   |
| Human approval | Every extracted fact must be confirmed/edited by the user before it becomes usable by writers.                                                      |

### 3.2 Job Analysis Agent (Phase 3)

|                |                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Purpose        | Turn a canonical job's description into structured requirements, skills, seniority, language needs, salary, remote/relocation, sponsorship text. |
| Inputs         | Job description text, title, location; skill taxonomy.                                                                                           |
| Outputs        | `job_requirements`, `job_skills`, structured fields, each requirement with verbatim source text.                                                 |
| Permissions    | Read: job catalog. Write: job analysis fields (via jobs service). No candidate data.                                                             |
| Data required  | Job text only (public).                                                                                                                          |
| Failure modes  | Treating "nice to have" as required; missing requirements hidden in benefits text; wrong language level; prompt injection in posting.            |
| Human approval | None (public data enrichment); user can flag corrections, which override AI fields for their view.                                               |

### 3.3 Matching Agent (Phase 4)

|                |                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Resolve ambiguous skill/experience equivalences and write the short grounded match explanation. Deterministic rules do the bulk of matching.       |
| Inputs         | Job requirements; candidate facts (VERIFIED/USER_PROVIDED + flagged AI_INFERRED ids); rule-based dimension results.                                |
| Outputs        | Dimension adjustments for ambiguous items with evidence ids; explanation text with citations.                                                      |
| Permissions    | Read: candidate facts (no contact data, no salary unless SALARY dimension), job data. Write: `job_match_dimensions` evidence via matching service. |
| Failure modes  | Over-generous equivalence ("Vue ≈ React"); ignoring hard gates; unsupported claims in explanation.                                                 |
| Human approval | None to compute; results are advisory.                                                                                                             |

### 3.4 Company Research Agent (Phase 5)

|                |                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Summarise a company (product, size, culture signals, recent news, tech stack, hiring signals) from permitted sources, with citations.    |
| Inputs         | Company record, job, fetched pages from permitted sources (company site, official press, public APIs).                                   |
| Outputs        | `company_research.findings[]` each with `source_url`, `retrieved_at`, confidence; summary.                                               |
| Permissions    | Read: company/job catalog; fetch via the research fetcher (robots.txt respected, allow-listed domains, rate limited). No candidate data. |
| Failure modes  | Outdated or wrong-company information (name collisions); unsourced claims; injection from web content; paywalled content.                |
| Human approval | Research is labelled "AI research, verify before relying"; findings used in documents must be approved as part of document review.       |

### 3.5 Eligibility Agent (Phase 4)

|                |                                                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Classify ambiguous sponsorship / work-authorization language in postings; map job facts to the relevant eligibility rules. It does **not** decide eligibility and never gives immigration advice. |
| Inputs         | Job text snippets about authorization/sponsorship; list of applicable rule keys.                                                                                                                  |
| Outputs        | `sponsorship_signal` + cited sentence + confidence; rule applicability suggestions.                                                                                                               |
| Permissions    | Read: job text, rule catalog. No candidate data (rule evaluation against the candidate is deterministic code).                                                                                    |
| Failure modes  | Misreading negations ("no sponsorship available"); outdated rules; overconfidence. Low confidence → `NEEDS_VERIFICATION`.                                                                         |
| Human approval | Results always displayed as signals with sources and "verify with official sources" notice.                                                                                                       |

### 3.6 Resume Agent (Phase 6)

|                |                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Produce a job-specific resume version from the master resume and candidate facts, emphasising relevant evidence.                                      |
| Inputs         | Master resume content, VERIFIED/USER_PROVIDED facts, job requirements, match evidence, user style preferences, target language.                       |
| Outputs        | Structured resume content: sections → items, each item with `source_fact_ids`; change rationale.                                                      |
| Permissions    | Read: candidate facts (no work-auth unless user opts to include), job data. Write: new `document_version` in `DRAFT` via documents service.           |
| Failure modes  | Inflating titles/metrics, inventing skills, keyword stuffing, wrong language/format conventions for country (photo/DOB norms), exceeding page limits. |
| Human approval | Required: QC pass + user moves the version to APPROVED.                                                                                               |

### 3.7 Cover Letter Agent (Phase 7)

|                |                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Purpose        | Write a job-specific cover letter grounded in candidate facts and approved company research.         |
| Inputs         | Candidate facts, job, match evidence, reviewed company research findings, tone/language preferences. |
| Outputs        | Structured letter (paragraphs with `source_ids` covering facts and research findings).               |
| Permissions    | Read: as Resume Agent + reviewed research. Write: DRAFT document version.                            |
| Failure modes  | Generic filler, invented motivations or company facts, wrong hiring manager name, wrong company.     |
| Human approval | Required (QC + user approval).                                                                       |

### 3.8 Email Agent (Phase 7)

|                |                                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Draft recruiter / hiring-manager outreach and application emails.                                                      |
| Inputs         | Contact (name, title only), job, candidate highlights, research, prior thread (if any).                                |
| Outputs        | Subject + body with `source_ids`; suggested send time.                                                                 |
| Permissions    | Read: contact name/title, candidate facts, job, thread. Write: `messages` in `DRAFT`. **No send capability.**          |
| Failure modes  | Wrong recipient/company, overly long or spammy tone, fabricated shared connections, injection via prior inbound email. |
| Human approval | Required for every send; approval binds to the exact subject/body hash.                                                |

### 3.9 Application Answer Agent (Phase 8 — built)

|                |                                                                                                                                                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Draft answers to application-form questions (motivation, experience, salary expectations, availability, authorization).                                                                                                            |
| Inputs         | Questions (user-pasted or from permitted ATS APIs), candidate facts, preferences, job.                                                                                                                                             |
| Outputs        | `APPLICATION_ANSWERS` document content: `[{question, answer, source_ids, sensitivity}]`. Legal/compliance questions (authorization, criminal record, disability, demographics) are **never auto-answered** — flagged for the user. |
| Permissions    | Read: candidate facts incl. preferences; work authorization only for authorization questions. Write: DRAFT version.                                                                                                                |
| Failure modes  | Answering legal/EEO questions, misrepresenting authorization status, inconsistent salary figures across applications.                                                                                                              |
| Human approval | Required.                                                                                                                                                                                                                          |

As built (Phase 8, `answer.service.ts`): task `application.answers`, local model only. Legal, salary,
availability, preference, self-rating and demographic questions are classified as not generatable and never
sent to the model. The question text is wrapped in `<application_question>` and treated as untrusted. Every
sentence of a draft is re-audited with the communication claim auditor; unsupported sentences are removed,
the result is cut to the character limit only at sentence boundaries, and an empty result becomes
`NEEDS_USER_INPUT`. Answers are versioned; approval is per version and immutable.

### 3.10 Follow-up Agent (Phase 11)

|                |                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Propose follow-up timing and draft follow-up messages based on application state, thread history and cadence rules. |
| Inputs         | Application timeline, messages, cadence settings, country/culture norms.                                            |
| Outputs        | Proposed `followups` + draft `messages`.                                                                            |
| Permissions    | Read: application, messages, contact name. Write: follow-up proposals and draft messages. No send.                  |
| Failure modes  | Following up after a rejection, too frequent contact, misreading a reply.                                           |
| Human approval | Required for each send (bulk approval UI may batch, but each message is still individually approved content).       |

### 3.11 Quality Control Agent (Phase 6)

|                |                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Purpose        | Independently review any generated document before human review.                                                                 |
| Inputs         | Document version content with cited sources, source facts, job, document type rules.                                             |
| Outputs        | `qc_report`: pass/fail, issues `[{severity, location, type: UNGROUNDED                                                           | FACT_MISMATCH | TONE | FORMAT | LANGUAGE | SENSITIVE, suggestion}]`. |
| Permissions    | Read-only on the document and its sources. Write: `qc_report` only.                                                              |
| Failure modes  | Missing subtle fabrications (mitigated by deterministic checks and using a different model), false positives.                    |
| Human approval | QC never approves; it only gates entry to review. The user can override a failing QC with an explicit acknowledgement (audited). |

---

## 4. Implementation order

| Phase | AI deliverable                                                                      |
| ----- | ----------------------------------------------------------------------------------- |
| 1     | AI service, router, Anthropic adapter, generation logging, budgets, Candidate Agent |
| 3     | Job Analysis Agent, result caching per job content hash                             |
| 4     | Embeddings, Matching Agent, Eligibility Agent                                       |
| 5     | Company Research Agent + permitted fetcher                                          |
| 6     | Resume Agent, Quality Control Agent, offline eval suite                             |
| 7     | Cover Letter, Email, Application Answer agents                                      |
| 11    | Follow-up Agent                                                                     |
