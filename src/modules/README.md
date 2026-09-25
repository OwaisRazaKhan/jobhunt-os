# Domain modules

Each product system lives in its own module. A module is created **when its phase begins** — not before —
so this directory is intentionally empty in Phase 0.

## Planned modules

| Module          | System(s)                        | Phase |
| --------------- | -------------------------------- | ----- |
| `identity`      | Users, sessions, settings        | 1     |
| `candidate`     | Candidate knowledge              | 1     |
| `audit`         | Audit log                        | 1     |
| `jobs`          | Job discovery, sources, database | 2–3   |
| `companies`     | Companies, contacts, research    | 3, 5  |
| `eligibility`   | Work authorization signals       | 4     |
| `matching`      | Explainable matching             | 4     |
| `documents`     | Resumes, letters, answers        | 6–7   |
| `applications`  | Lifecycle state machine          | 8     |
| `messaging`     | Email drafts / sending           | 7, 10 |
| `workflows`     | Definitions + execution          | 9     |
| `integrations`  | OAuth connections, providers     | 10    |
| `followups`     | Follow-up engine                 | 11    |
| `notifications` | In-app / email notices           | 8+    |
| `analytics`     | Read models, metrics             | 12    |

## Module layout

```
src/modules/<name>/
  index.ts          # public API — the ONLY file other modules may import
  service.ts        # use cases; authorization + invariants + audit live here
  repository.ts     # Prisma access; always scoped by userId
  schemas.ts        # Zod schemas (input DTOs, AI output contracts)
  types.ts          # domain types
  *.test.ts         # colocated unit tests
```

Split files into folders only when they grow; do not pre-create them.

## Rules

1. Cross-module calls go through `index.ts`. Never import another module's repository.
2. Transports (Route Handlers, Server Actions, worker jobs) call **services**, never repositories.
3. Every repository query is filtered by `userId` (tenant boundary).
4. Side effects that leave the system (email, submission) require an approval record — enforced in the service.
