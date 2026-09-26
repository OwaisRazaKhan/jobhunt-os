# Setup Guide (Phase 1)

Everything below is free: Supabase Free tier, a local Ollama, and your machine.

## 1. Prerequisites

- Node.js ≥ 22, npm
- Access to the existing Supabase project **JOBHUNTOS** (do not create another database)
- Optional: [Ollama](https://ollama.com) for AI-assisted CV extraction

```bash
npm install
cp .env.example .env
```

## 2. Supabase: database

1. Supabase dashboard → project **JOBHUNTOS** → **Connect** → **ORMs → Prisma**.
2. Copy the connection strings into `.env`:
   - `DATABASE_URL`: the pooler URL the app uses at runtime. The Session pooler (port 5432) is the simplest choice.
   - `DIRECT_URL`: the session/direct URL used for migrations.
3. Apply the Phase 1 migration:

```bash
npm run db:migrate:deploy
```

```bash
npm run db:migrate:status
```

The migration creates 21 tables, constraints, partial unique indexes, the ISO country list and the Row Level Security policies. It also creates the NOLOGIN role `jobhunt_app` and grants it to the migrating user (see [security.md](./security.md#row-level-security-phase-1)).

### Verify schema, indexes, constraints and RLS (Supabase SQL editor)

```sql
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by 1;       -- rowsecurity = true everywhere
select tablename, policyname, roles from pg_policies where schemaname = 'public' order by 1; -- 19 policies, role jobhunt_app
select conname, conrelid::regclass from pg_constraint where contype = 'c' and connamespace = 'public'::regnamespace;
select indexname, tablename from pg_indexes where schemaname = 'public' order by 2;
select count(*) from countries;                                                                -- 249
select has_table_privilege('anon', 'candidate_profiles', 'select');                           -- false
```

## 3. Supabase: storage

Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (dashboard → Project Settings → API keys) to `.env`, then run:

```bash
npm run storage:setup
```

This creates or hardens the **private** bucket `candidate-documents`: 10 MB limit, PDF/DOCX/TXT only. No storage policies are created, so only the server (service role) can read or write. Objects are stored as `<userId>/<candidateId>/<documentId>/original`, and downloads go through an ownership-checked route that issues 60-second signed URLs.

## 4. Auth and encryption secrets

Generate two separate values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Put one in `BETTER_AUTH_SECRET` and the other in `ENCRYPTION_KEY`. Keep `ENCRYPTION_KEY` safe: phone and professional email are encrypted with it.

## 5. Local AI with Ollama (optional)

1. Install Ollama from https://ollama.com. On Windows, run the installer and it starts in the background.
2. Pull a model that supports structured output well:

```bash
ollama pull llama3.1:8b
```

Lighter alternatives: `qwen2.5:3b` or `llama3.2:3b` (faster, less accurate). Heavier: `qwen2.5:14b`. 3. Set `OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`) and `OLLAMA_MODEL` in `.env`. 4. Test the connection. The check sends a synthetic prompt only, never your data:

```bash
npm run ai:check
```

If Ollama is offline, everything still works. Uploads fall back to rule-based extraction and the UI shows "AI extraction is currently unavailable". Set `AI_ENABLED=false` to turn AI off entirely. Candidate documents are only ever sent to this local model.

## 6. Run

After every `git pull` that adds a migration, apply it first: `npm run db:migrate:deploy`.
`npm run dev` regenerates the Prisma client automatically (`predev`), so the app never runs with a
client that is older than `prisma/schema.prisma`.

```bash
npm run dev
```

Open http://localhost:3000, create an account, and choose **Import CV** or **Build manually**.

## Optional: run without Supabase (local sandbox)

For demos or offline work, `npm run db:local` starts a local Postgres (PGlite) on port 54329 and applies the same migrations, RLS included. Set `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/postgres` and `DATABASE_POOL_MAX=1`, and leave the Supabase variables empty. Files then go to `.data/storage`, which only works when `APP_ENV=development`. This mode is not for production.

## Scheduled discovery (optional)

Set `CRON_SECRET` in `.env` (32+ random bytes, same generator as above), restart the app, then run
`npm run scheduler` in a second terminal. Search Profiles with an automatic-run interval are
discovered when due. Details and the optional Supabase pg_cron setup:
[job-discovery.md §8](./job-discovery.md#8-scheduling-cp14-free).

## Maintenance

- `npm run maintenance:purge`: hard-deletes facts that were soft-deleted more than 30 days ago. Schedule it with any free cron, for example GitHub Actions.
- `npm run check`: runs typecheck, lint, formatting and tests.
