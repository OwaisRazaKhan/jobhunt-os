# JOBHUNT OS

An AI-assisted international job-search operating system: candidate knowledge base → job discovery → explainable matching → grounded, job-specific documents → human-approved applications → tracking and follow-ups → visual workflow automation.

**Current status: Phase 1 — Candidate Intelligence (awaiting approval).** See [docs/candidate-intelligence.md](docs/candidate-intelligence.md) and [docs/roadmap.md](docs/roadmap.md).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Supabase (PostgreSQL + Storage) · Prisma 7 · Better Auth · Zod 4 · Ollama (optional, local) · Vitest

## Getting started

Requirements: Node.js ≥ 22, npm.

```bash
npm install
cp .env.example .env     # see docs/setup.md (Supabase, secrets, Ollama)
npm run db:migrate:deploy
npm run storage:setup
npm run dev              # http://localhost:3000 — health check at /api/health
```

## Scripts

| Script                | Purpose                                                           |
| --------------------- | ----------------------------------------------------------------- |
| `npm run dev`         | Development server                                                |
| `npm run build`       | Production build                                                  |
| `npm run check`       | typecheck + lint + format check + tests (run before every commit) |
| `npm run typecheck`   | Generate Next.js route types, then `tsc --noEmit`                 |
| `npm run lint`        | ESLint                                                            |
| `npm run format`      | Prettier write                                                    |
| `npm test`            | Vitest                                                            |
| `npm run db:validate` | Validate the Prisma schema                                        |
| `npm run db:generate` | Generate the Prisma client                                        |

## Documentation

Start at [docs/README.md](docs/README.md).
