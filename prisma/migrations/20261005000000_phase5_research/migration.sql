-- Phase 5: Company & Job Research Engine.
-- Research is triggered by a user, uses that user's options, manual sources and notes, so every
-- research table is USER-SCOPED (owner-only RLS). The company and job entities stay shared.
-- Company research is reused across all of a user's jobs at that company (no per-job duplicate).

-- --- Company identity: official website (system-derived only; user overrides are per user) ---
ALTER TABLE "companies"
  ADD COLUMN "official_website" TEXT,
  ADD COLUMN "website_confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "website_source" TEXT;
ALTER TABLE "companies" ADD CONSTRAINT "companies_website_ck" CHECK (
  "website_confidence" IN ('UNKNOWN', 'CONFIRMED', 'LIKELY', 'UNCERTAIN')
  AND ("official_website" IS NULL OR char_length("official_website") <= 2048)
  AND ("website_source" IS NULL OR "website_source" IN ('JOB_URL', 'APPLICATION_URL', 'SEARCH'))
  AND (("official_website" IS NULL) = ("website_confidence" = 'UNKNOWN'))
);

-- Per-user company research targets (website the user confirmed, careers page).
CREATE TABLE "company_research_targets" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "website_url" TEXT,
  "careers_url" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "company_research_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_research_targets_ck" CHECK (
    ("website_url" IS NULL OR char_length("website_url") <= 2048)
    AND ("careers_url" IS NULL OR char_length("careers_url") <= 2048)
  )
);
CREATE UNIQUE INDEX "company_research_targets_user_company_key" ON "company_research_targets" ("user_id", "company_id");
CREATE INDEX "company_research_targets_company_id_idx" ON "company_research_targets" ("company_id");

-- --- Research settings (freshness policy, default depth, optional AI synthesis) -------------
CREATE TABLE "research_settings" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "default_depth" TEXT NOT NULL DEFAULT 'STANDARD',
  "fresh_days" INTEGER NOT NULL DEFAULT 14,
  "stale_days" INTEGER NOT NULL DEFAULT 45,
  "ai_synthesis" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "research_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_settings_ck" CHECK (
    "default_depth" IN ('QUICK', 'STANDARD', 'DEEP')
    AND "fresh_days" BETWEEN 1 AND 365 AND "stale_days" BETWEEN 2 AND 730 AND "stale_days" > "fresh_days"
  )
);
CREATE UNIQUE INDEX "research_settings_user_id_key" ON "research_settings" ("user_id");

-- --- Research runs (one operation = one run; progress steps reflect real work) --------------
CREATE TABLE "research_runs" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "kind" TEXT NOT NULL,
  "company_id" UUID NOT NULL,
  "job_id" UUID,
  "depth" TEXT NOT NULL,
  "trigger" TEXT NOT NULL DEFAULT 'MANUAL',
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "steps" JSONB NOT NULL DEFAULT '[]',
  "sources_attempted" INTEGER NOT NULL DEFAULT 0,
  "sources_successful" INTEGER NOT NULL DEFAULT 0,
  "sources_failed" INTEGER NOT NULL DEFAULT 0,
  "requests_made" INTEGER NOT NULL DEFAULT 0,
  "claims_created" INTEGER NOT NULL DEFAULT 0,
  "claims_rejected" INTEGER NOT NULL DEFAULT 0,
  "ai_used" BOOLEAN NOT NULL DEFAULT false,
  "ai_provider" TEXT,
  "ai_model" TEXT,
  "ai_generation_id" UUID,
  "errors" JSONB NOT NULL DEFAULT '[]',
  "engine_version" TEXT NOT NULL,
  "refresh_company" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "research_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_runs_ck" CHECK (
    "kind" IN ('JOB', 'COMPANY')
    AND ("kind" = 'COMPANY') = ("job_id" IS NULL)
    AND "depth" IN ('QUICK', 'STANDARD', 'DEEP')
    AND "trigger" IN ('MANUAL', 'REFRESH', 'WORKFLOW')
    AND "status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'NEEDS_REVIEW', 'FAILED')
    AND jsonb_typeof("steps") = 'array' AND jsonb_typeof("errors") = 'array'
    AND "sources_attempted" >= 0 AND "sources_successful" >= 0 AND "sources_failed" >= 0
    AND "requests_made" >= 0 AND "claims_created" >= 0 AND "claims_rejected" >= 0
    AND char_length("engine_version") BETWEEN 1 AND 20
  )
);
CREATE INDEX "research_runs_user_created_idx" ON "research_runs" ("user_id", "created_at" DESC);
CREATE INDEX "research_runs_job_idx" ON "research_runs" ("user_id", "job_id", "created_at" DESC);
CREATE INDEX "research_runs_company_idx" ON "research_runs" ("user_id", "company_id", "created_at" DESC);
-- Bounded concurrency: one active research run per user.
CREATE UNIQUE INDEX "research_runs_one_active_uq" ON "research_runs" ("user_id") WHERE "status" IN ('QUEUED', 'RUNNING');

-- --- Sources (metadata + bounded extracted text; deduplicated per user by URL + content hash) ---
CREATE TABLE "research_sources" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_id" UUID,
  "job_id" UUID,
  "url" TEXT NOT NULL,
  "normalized_url" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "reliability" TEXT NOT NULL,
  "relevance" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "origin" TEXT NOT NULL,
  "fetch_status" TEXT NOT NULL,
  "http_status" INTEGER,
  "error" TEXT,
  "title" TEXT,
  "published_at" TIMESTAMPTZ(3),
  "source_updated_at" TIMESTAMPTZ(3),
  "retrieved_at" TIMESTAMPTZ(3),
  "content_hash" CHAR(64),
  "content_text" TEXT,
  "added_by_user" BOOLEAN NOT NULL DEFAULT false,
  "added_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "research_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_sources_ck" CHECK (
    char_length("url") BETWEEN 1 AND 2048 AND char_length("normalized_url") BETWEEN 1 AND 2048
    AND "source_type" IN ('OFFICIAL_JOB', 'OFFICIAL_COMPANY', 'OFFICIAL_CAREERS', 'OFFICIAL_PRODUCT',
      'OFFICIAL_NEWS', 'OFFICIAL_BLOG', 'OFFICIAL_DOCUMENTATION', 'PUBLIC_NEWS', 'PUBLIC_DATABASE',
      'SEARCH_RESULT', 'MANUAL', 'OTHER')
    AND "reliability" IN ('AUTHORITATIVE', 'STRONG', 'SECONDARY', 'DISCOVERY_ONLY')
    AND "relevance" IN ('HIGH', 'MEDIUM', 'LOW', 'IRRELEVANT', 'UNKNOWN')
    AND "origin" IN ('JOB_RECORD', 'OFFICIAL_SITE', 'SEARCH', 'MANUAL')
    AND "fetch_status" IN ('OK', 'FAILED', 'BLOCKED', 'ROBOTS_DISALLOWED', 'UNSAFE_URL', 'NOT_FETCHED')
    AND ("content_text" IS NULL OR char_length("content_text") <= 20000)
    AND ("title" IS NULL OR char_length("title") <= 500)
    AND ("error" IS NULL OR char_length("error") <= 500)
    AND ("added_by_user" = ("added_at" IS NOT NULL))
  )
);
CREATE INDEX "research_sources_user_url_idx" ON "research_sources" ("user_id", "normalized_url", "created_at" DESC);
CREATE INDEX "research_sources_company_idx" ON "research_sources" ("user_id", "company_id");
CREATE INDEX "research_sources_job_idx" ON "research_sources" ("user_id", "job_id");

-- --- Company research (versioned; one current per user + company) ---------------------------
CREATE TABLE "company_research" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "run_id" UUID,
  "version" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL,
  "depth" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "website_url" TEXT,
  "website_confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "summary" TEXT,
  "brief" JSONB NOT NULL DEFAULT '{}',
  "completeness" JSONB NOT NULL DEFAULT '{}',
  "stats" JSONB NOT NULL DEFAULT '{}',
  "changes" JSONB NOT NULL DEFAULT '{}',
  "researched_at" TIMESTAMPTZ(3) NOT NULL,
  "last_verified_at" TIMESTAMPTZ(3) NOT NULL,
  "invalidated_at" TIMESTAMPTZ(3),
  "invalidation_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "company_research_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_research_ck" CHECK (
    "version" >= 1
    AND "status" IN ('COMPLETED', 'PARTIAL', 'NEEDS_REVIEW', 'FAILED')
    AND "depth" IN ('QUICK', 'STANDARD', 'DEEP')
    AND "website_confidence" IN ('UNKNOWN', 'CONFIRMED', 'LIKELY', 'UNCERTAIN')
    AND ("summary" IS NULL OR char_length("summary") <= 4000)
    AND jsonb_typeof("brief") = 'object' AND jsonb_typeof("completeness") = 'object'
    AND jsonb_typeof("stats") = 'object' AND jsonb_typeof("changes") = 'object'
    AND ("invalidation_reason" IS NULL OR char_length("invalidation_reason") <= 200)
  )
);
CREATE UNIQUE INDEX "company_research_version_key" ON "company_research" ("user_id", "company_id", "version");
CREATE UNIQUE INDEX "company_research_one_current_uq" ON "company_research" ("user_id", "company_id") WHERE "is_current";

-- --- Job research (versioned; references the company research version it used) -------------
CREATE TABLE "job_research" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "run_id" UUID,
  "version" INTEGER NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL,
  "depth" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "company_research_id" UUID,
  "company_research_version" INTEGER,
  "requirement_set_id" UUID,
  "job_content_hash" CHAR(64) NOT NULL,
  "job_summary" TEXT,
  "brief" JSONB NOT NULL DEFAULT '{}',
  "completeness" JSONB NOT NULL DEFAULT '{}',
  "stats" JSONB NOT NULL DEFAULT '{}',
  "changes" JSONB NOT NULL DEFAULT '{}',
  "researched_at" TIMESTAMPTZ(3) NOT NULL,
  "last_verified_at" TIMESTAMPTZ(3) NOT NULL,
  "invalidated_at" TIMESTAMPTZ(3),
  "invalidation_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "job_research_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_research_ck" CHECK (
    "version" >= 1
    AND "status" IN ('COMPLETED', 'PARTIAL', 'NEEDS_REVIEW', 'FAILED')
    AND "depth" IN ('QUICK', 'STANDARD', 'DEEP')
    AND ("job_summary" IS NULL OR char_length("job_summary") <= 4000)
    AND jsonb_typeof("brief") = 'object' AND jsonb_typeof("completeness") = 'object'
    AND jsonb_typeof("stats") = 'object' AND jsonb_typeof("changes") = 'object'
    AND ("invalidation_reason" IS NULL OR char_length("invalidation_reason") <= 200)
  )
);
CREATE UNIQUE INDEX "job_research_version_key" ON "job_research" ("user_id", "job_id", "version");
CREATE UNIQUE INDEX "job_research_one_current_uq" ON "job_research" ("user_id", "job_id") WHERE "is_current";
CREATE INDEX "job_research_company_idx" ON "job_research" ("user_id", "company_id");

-- --- Claims + the evidence that supports them -----------------------------------------------
CREATE TABLE "research_claims" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_research_id" UUID,
  "job_research_id" UUID,
  "position" INTEGER NOT NULL DEFAULT 0,
  "section" TEXT NOT NULL,
  "claim" TEXT NOT NULL,
  "claim_type" TEXT NOT NULL,
  "verification" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'RULE',
  "value_key" TEXT,
  "value" TEXT,
  "temporal" TEXT NOT NULL DEFAULT 'UNDATED',
  "rejection_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_claims_ck" CHECK (
    (("company_research_id" IS NULL) <> ("job_research_id" IS NULL))
    AND char_length("section") BETWEEN 1 AND 40
    AND char_length("claim") BETWEEN 1 AND 1000
    AND "claim_type" IN ('FACT', 'INTERPRETATION', 'INFERENCE', 'UNKNOWN', 'CONFLICTING')
    AND "verification" IN ('VERIFIED_FROM_SOURCE', 'PENDING_REVIEW', 'REJECTED', 'CONFLICTING')
    AND "method" IN ('RULE', 'AI', 'USER')
    AND "temporal" IN ('CURRENT', 'HISTORICAL', 'UNDATED')
    -- AI output is never verified just because it was generated.
    AND ("method" <> 'AI' OR "verification" <> 'VERIFIED_FROM_SOURCE')
    AND (("verification" = 'REJECTED') = ("rejection_reason" IS NOT NULL))
    AND ("value_key" IS NULL OR char_length("value_key") <= 60)
    AND ("value" IS NULL OR char_length("value") <= 300)
  )
);
CREATE INDEX "research_claims_company_research_idx" ON "research_claims" ("company_research_id", "position");
CREATE INDEX "research_claims_job_research_idx" ON "research_claims" ("job_research_id", "position");
CREATE INDEX "research_claims_user_idx" ON "research_claims" ("user_id");

CREATE TABLE "research_claim_evidence" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "claim_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "excerpt" TEXT NOT NULL,
  "source_reference" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_claim_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_claim_evidence_ck" CHECK (
    char_length("excerpt") BETWEEN 1 AND 1000
    AND ("source_reference" IS NULL OR char_length("source_reference") <= 200)
  )
);
CREATE UNIQUE INDEX "research_claim_evidence_claim_source_key" ON "research_claim_evidence" ("claim_id", "source_id");
CREATE INDEX "research_claim_evidence_source_idx" ON "research_claim_evidence" ("source_id");
CREATE INDEX "research_claim_evidence_user_idx" ON "research_claim_evidence" ("user_id");

-- Which sources a run attempted and what happened (failures included).
CREATE TABLE "research_run_sources" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "run_id" UUID NOT NULL,
  "source_id" UUID NOT NULL,
  "outcome" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_run_sources_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_run_sources_ck" CHECK (
    "outcome" IN ('USED', 'UNCHANGED', 'FAILED', 'SKIPPED_IRRELEVANT', 'SKIPPED_LIMIT')
    AND ("note" IS NULL OR char_length("note") <= 300)
  )
);
CREATE UNIQUE INDEX "research_run_sources_run_source_key" ON "research_run_sources" ("run_id", "source_id");
CREATE INDEX "research_run_sources_source_idx" ON "research_run_sources" ("source_id");
CREATE INDEX "research_run_sources_user_idx" ON "research_run_sources" ("user_id");

-- --- Private research notes (USER_NOTE — never treated as verified public facts) ------------
CREATE TABLE "research_notes" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "company_id" UUID,
  "job_id" UUID,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "deleted_at" TIMESTAMPTZ(3),
  CONSTRAINT "research_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "research_notes_ck" CHECK (
    (("company_id" IS NULL) <> ("job_id" IS NULL)) AND char_length("body") BETWEEN 1 AND 4000
  )
);
CREATE INDEX "research_notes_user_company_idx" ON "research_notes" ("user_id", "company_id");
CREATE INDEX "research_notes_user_job_idx" ON "research_notes" ("user_id", "job_id");

-- --- Foreign keys ---------------------------------------------------------------------------
ALTER TABLE "company_research_targets"
  ADD CONSTRAINT "company_research_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "company_research_targets_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_settings"
  ADD CONSTRAINT "research_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_runs"
  ADD CONSTRAINT "research_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_runs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_runs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_runs_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_sources"
  ADD CONSTRAINT "research_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_sources_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_sources_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "company_research"
  ADD CONSTRAINT "company_research_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "company_research_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "company_research_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_research"
  ADD CONSTRAINT "job_research_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_research_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_research_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_research_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "job_research_company_research_id_fkey" FOREIGN KEY ("company_research_id") REFERENCES "company_research"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "job_research_requirement_set_id_fkey" FOREIGN KEY ("requirement_set_id") REFERENCES "job_requirement_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "research_claims"
  ADD CONSTRAINT "research_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_claims_company_research_id_fkey" FOREIGN KEY ("company_research_id") REFERENCES "company_research"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_claims_job_research_id_fkey" FOREIGN KEY ("job_research_id") REFERENCES "job_research"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_claim_evidence"
  ADD CONSTRAINT "research_claim_evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_claim_evidence_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "research_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_claim_evidence_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_run_sources"
  ADD CONSTRAINT "research_run_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_run_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_run_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "research_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "research_notes"
  ADD CONSTRAINT "research_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "research_notes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row Level Security: every research table is owner-only ---------------------------------
ALTER TABLE "company_research_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_research" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_research" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_claim_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_run_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "research_notes" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "company_research_targets", "research_settings", "research_runs",
  "research_sources", "company_research", "job_research", "research_claims", "research_claim_evidence",
  "research_run_sources", "research_notes" TO jobhunt_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_research_targets', 'research_settings', 'research_runs', 'research_sources',
    'company_research', 'job_research', 'research_notes']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO jobhunt_app USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()))',
      t || '_owner', t);
  END LOOP;
END
$$;
-- Child rows must also point at parents owned by the same user.
CREATE POLICY "research_claims_owner" ON "research_claims" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK (
    "user_id" = (SELECT app_current_user_id())
    AND ("company_research_id" IS NULL OR EXISTS (SELECT 1 FROM "company_research" c WHERE c."id" = "company_research_id" AND c."user_id" = (SELECT app_current_user_id())))
    AND ("job_research_id" IS NULL OR EXISTS (SELECT 1 FROM "job_research" j WHERE j."id" = "job_research_id" AND j."user_id" = (SELECT app_current_user_id())))
  );
CREATE POLICY "research_claim_evidence_owner" ON "research_claim_evidence" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK (
    "user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "research_claims" c WHERE c."id" = "claim_id" AND c."user_id" = (SELECT app_current_user_id()))
    AND EXISTS (SELECT 1 FROM "research_sources" s WHERE s."id" = "source_id" AND s."user_id" = (SELECT app_current_user_id()))
  );
CREATE POLICY "research_run_sources_owner" ON "research_run_sources" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK (
    "user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "research_runs" r WHERE r."id" = "run_id" AND r."user_id" = (SELECT app_current_user_id()))
    AND EXISTS (SELECT 1 FROM "research_sources" s WHERE s."id" = "source_id" AND s."user_id" = (SELECT app_current_user_id()))
  );

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "company_research_targets", "research_settings", "research_runs", "research_sources", "company_research", "job_research", "research_claims", "research_claim_evidence", "research_run_sources", "research_notes" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
