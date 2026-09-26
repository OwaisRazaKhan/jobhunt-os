-- Phase 3 — Job database, search, filtering & saved searches.
-- Adds: full-text search vector on jobs, filter/sort indexes, per-user job state
-- (bookmark / hide), saved searches. No existing table is duplicated.

-- --- Full-text search ------------------------------------------------------------
-- 'simple' configuration: no language stemming (multilingual catalog incl. India / DE / FR),
-- prefix matching is done in the query. Company names live in "companies" and are
-- searched separately. The description contributes at most its first 20k characters.
ALTER TABLE "jobs" ADD COLUMN "search_vector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('simple'::regconfig, coalesce("title", '') || ' ' || coalesce("normalized_title", '')), 'A') ||
  setweight(to_tsvector('simple'::regconfig,
    coalesce("location_raw", '') || ' ' || coalesce("city", '') || ' ' || coalesce("region", '') || ' ' ||
    coalesce("department", '') || ' ' || coalesce("team", '')), 'B') ||
  setweight(to_tsvector('simple'::regconfig, left(coalesce("description", ''), 20000)), 'C')
) STORED;
CREATE INDEX "jobs_search_vector_idx" ON "jobs" USING GIN ("search_vector");

-- --- Filter / sort indexes (visible-catalog scans are filtered by these columns) ---------
CREATE INDEX "jobs_country_code_remote_status_idx" ON "jobs" ("country_code", "remote_status");
-- The composite index covers country-only lookups (leading column); the old one is redundant.
DROP INDEX "jobs_country_code_idx";
CREATE INDEX "jobs_posted_at_idx" ON "jobs" ("posted_at" DESC NULLS LAST);
CREATE INDEX "jobs_discovered_at_idx" ON "jobs" ("discovered_at" DESC);
CREATE INDEX "jobs_last_seen_at_idx" ON "jobs" ("last_seen_at" DESC);
CREATE INDEX "jobs_source_key_idx" ON "jobs" ("source_key");
CREATE INDEX "job_source_postings_source_key_job_id_idx" ON "job_source_postings" ("source_key", "job_id");

-- --- Per-user job state: bookmark / hide (never touches the shared job) -----------------
CREATE TABLE "user_job_states" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "bookmarked_at" TIMESTAMPTZ(3),
  "hidden_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "user_job_states_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "user_job_states_user_id_job_id_key" ON "user_job_states" ("user_id", "job_id");
CREATE INDEX "user_job_states_user_id_bookmarked_at_idx" ON "user_job_states" ("user_id", "bookmarked_at" DESC) WHERE "bookmarked_at" IS NOT NULL;
CREATE INDEX "user_job_states_user_id_hidden_at_idx" ON "user_job_states" ("user_id", "hidden_at" DESC) WHERE "hidden_at" IS NOT NULL;
CREATE INDEX "user_job_states_job_id_idx" ON "user_job_states" ("job_id");
ALTER TABLE "user_job_states" ADD CONSTRAINT "user_job_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_job_states" ADD CONSTRAINT "user_job_states_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Saved searches: a reproducible /jobs query + filter state ---------------------------
CREATE TABLE "saved_searches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "params" JSONB NOT NULL DEFAULT '{}',
  "last_run_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "saved_searches_ck" CHECK (
    char_length("name") BETWEEN 1 AND 100 AND jsonb_typeof("params") = 'object'
    AND pg_column_size("params") <= 8192
  )
);
CREATE UNIQUE INDEX "saved_searches_user_id_name_key" ON "saved_searches" ("user_id", "name");
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row Level Security: both tables are strictly owner-only ---------------------------
ALTER TABLE "user_job_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "saved_searches" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "user_job_states", "saved_searches" TO jobhunt_app;
CREATE POLICY "user_job_states_owner" ON "user_job_states" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"));
CREATE POLICY "saved_searches_owner" ON "saved_searches" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "user_job_states", "saved_searches" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
