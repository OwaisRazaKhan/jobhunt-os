# Frontend Architecture

Status: design. Phase 0 ships only design tokens (`src/app/globals.css`), the root layout and a placeholder page.

---

## 1. Principles

- **Server-first.** Pages are React Server Components that call services directly; client components are small interactive islands (tables with local sorting, forms, canvas).
- **No giant components.** A page composes feature components; a feature component composes primitives. Target < 200 lines per component; extract hooks for logic.
- **One validation source.** Forms use the same Zod schemas as the server.
- **Density with clarity.** Tables, keyboard shortcuts, command palette, side panels — a tool for daily use, not a marketing site.

---

## 2. Navigation & routes

App Router with a route group for the authenticated shell:

```
src/app/
├── (auth)/sign-in/page.tsx
├── (app)/layout.tsx                 # shell: sidebar + top bar + command palette
│   ├── dashboard/page.tsx
│   ├── jobs/page.tsx                # catalog + filters
│   ├── jobs/[jobId]/page.tsx        # job detail, match, eligibility
│   ├── applications/page.tsx        # board (kanban) / table toggle
│   ├── applications/[id]/page.tsx   # timeline, documents, approvals
│   ├── companies/page.tsx, companies/[id]/page.tsx
│   ├── contacts/page.tsx
│   ├── candidate/page.tsx           # profile overview + review queue
│   ├── candidate/[section]/page.tsx
│   ├── resume-studio/…              # master + job resumes, versions, diff
│   ├── email-studio/…               # letters, emails, answers
│   ├── workflows/page.tsx, workflows/[id]/page.tsx (canvas), workflows/[id]/executions/…
│   ├── analytics/page.tsx
│   └── settings/{profile,integrations,ai,privacy,system}/page.tsx
├── api/v1/…                          # route handlers
└── proxy.ts (at src/)                # auth gate, request id, security headers
```

Sidebar order: **Dashboard · Jobs · Applications · Companies · Contacts · Candidate · Resume Studio · Email Studio · Workflows · Analytics · Settings**.

Each route segment has `loading.tsx` (skeletons) and `error.tsx` (shows safe message + request id).

---

## 3. Code organisation

```
src/components/
├── ui/          # shadcn/ui primitives (button, input, dialog, dropdown, table, tabs, tooltip, badge…)
├── layout/      # AppShell, Sidebar, TopBar, PageHeader, SplitPane, CommandPalette
├── data/        # DataTable (TanStack Table), FilterBar, EmptyState, StatTile, Timeline, KeyValue
└── feedback/    # Toast, InlineError, ConfirmDialog, ProvenanceBadge, StatusBadge

src/modules/<domain>/ui/     # domain feature components (ApplicationBoard, FactCard, MatchBreakdown…)
```

Rules: `components/` has no domain knowledge; domain UI lives with its module; pages only compose.

### Shared domain display components (critical for trust)

- **`ProvenanceBadge`** — shows `VERIFIED / USER_PROVIDED / NEEDS_REVIEW / AI_INFERRED` consistently everywhere; AI-inferred content uses the `--ai` colour and an icon, never styled like verified data.
- **`MatchDimension`** — one row per dimension with status chip and expandable evidence (MATCHES / GAPS / UNKNOWN / REQUIRES VERIFICATION).
- **`SourceCitation`** — inline link to the fact, requirement or URL behind a claim.
- **`ApprovalPanel`** — shows exactly what will be sent, to whom, via which channel, with the content hash; the only place a send/submit button exists.

---

## 4. Data, state and API client

| Concern             | Approach                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server data (reads) | RSC fetches via services. Client islands needing live data use a typed fetch client over `/api/v1` + **TanStack Query** (added when the first such island appears). |
| Mutations           | Server Actions returning `ActionResult<T>`; `revalidatePath`/`revalidateTag` after success; optimistic UI via `useOptimistic` where useful.                         |
| URL state           | Filters, sorting, pagination, selected tab live in search params (shareable, back-button friendly).                                                                 |
| Local UI state      | React state; a small store (Zustand) only for the workflow canvas (Phase 9).                                                                                        |
| Forms               | React Hook Form + Zod resolver (added Phase 1), field components wrapping shadcn inputs.                                                                            |
| API client          | `src/lib/api-client.ts`: typed wrapper around `fetch`, parses the error envelope into `ApiError`, attaches `Idempotency-Key` on side-effecting calls.               |
| Long operations     | Poll the job/resource status (Phase 1–7); SSE for execution progress (Phase 9).                                                                                     |

Dependencies above are added in the phase that first needs them — none are installed in Phase 0.

---

## 5. Design system

### Character

Dark, minimal, precise, technical, dense. References: Linear (typography, restraint), n8n (node canvas), Raycast (command palette, keyboard-first). Own identity through the **signal accent** (`#c8f04b`) used sparingly, monospace for data/ids, and tight grids.

**Avoid:** gradient-heavy hero areas, glowing AI orbs, glassmorphism, oversized rounded cards, decorative illustrations, emoji-as-UI.

### Tokens (implemented in `src/app/globals.css`)

| Group    | Tokens                                                                       |
| -------- | ---------------------------------------------------------------------------- |
| Surfaces | `bg`, `surface-1/2/3` (elevation by lightness), `border`, `border-strong`    |
| Text     | `fg`, `fg-muted`, `fg-subtle`                                                |
| Accent   | `accent`, `accent-fg` — primary action, focus ring, active nav               |
| Status   | `success`, `warning`, `danger`, `info`                                       |
| AI       | `ai` — only for AI-generated / AI-inferred markers                           |
| Radius   | `sm 4px`, `md 6px`, `lg 8px` — nothing rounder than 8px except pills/avatars |

Typography: Geist Sans (UI) / Geist Mono (ids, numbers, code, timestamps). Base size 14px; scale 12 / 13 / 14 / 16 / 20 / 24. Tabular numerals in tables.

Spacing: 4px base grid. Row height 32–36px in tables. Sidebar 240px (collapsible to 56px).

Motion: 120–200ms ease-out for hover/press/panel transitions; no bouncing; respects `prefers-reduced-motion` (implemented globally).

Accessibility: WCAG 2.2 AA contrast, visible focus rings, full keyboard operability (command palette `⌘K`, `j/k` list navigation, `g` + key navigation), semantic HTML, Radix primitives for ARIA.

Status colour mapping (used across applications, matches, verification):

| Meaning                                | Token     |
| -------------------------------------- | --------- |
| Verified / match / offer               | `success` |
| Needs review / partial / follow-up due | `warning` |
| Gap / rejected / failed                | `danger`  |
| Informational / in progress            | `info`    |
| AI-inferred / AI-generated             | `ai`      |

---

## 6. Future dashboard (architecture only — not built)

**Data source:** analytics module read models (materialised views refreshed by the worker), never ad-hoc aggregates in the page.

| Widget             | Metric source                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Funnel             | counts by application status group: discovered → qualified → prepared → submitted → responses → interviews → offers |
| Conversion metrics | stage-to-stage conversion %, median days per stage                                                                  |
| Follow-ups         | due today / overdue (links to list)                                                                                 |
| Jobs discovered    | new jobs last 7/30 days by country and source                                                                       |
| Countries          | pipeline by country (table, optional map later)                                                                     |
| Sources            | per-source yield: jobs → qualified → responses                                                                      |
| Recent activity    | latest application events                                                                                           |
| System health      | failing sources, failed executions, AI budget used                                                                  |

Layout: 12-column grid of `StatTile`s (top row), funnel + follow-ups (middle), tables (bottom). Every tile links to the filtered list behind it. Time range and country filters in the URL.
