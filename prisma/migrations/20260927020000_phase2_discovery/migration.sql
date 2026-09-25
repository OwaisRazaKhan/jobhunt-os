-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "dedupe_fingerprint" CHAR(64),
ADD COLUMN     "department" TEXT,
ADD COLUMN     "experience_level" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "experience_level_raw" TEXT,
ADD COLUMN     "last_content_change_at" TIMESTAMPTZ(3),
ADD COLUMN     "source_updated_at" TIMESTAMPTZ(3),
ADD COLUMN     "team" TEXT;

-- CreateTable
CREATE TABLE "market_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "country_code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "market_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_categories" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_category_terms" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "user_id" UUID,
    "term" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_category_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "country_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "search_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "work_modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employment_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "experience_levels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_currency" CHAR(3),
    "salary_period" TEXT,
    "visa_preference" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "schedule_interval_hours" INTEGER,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_profile_locations" (
    "profile_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "search_profile_locations_pkey" PRIMARY KEY ("profile_id","location_id")
);

-- CreateTable
CREATE TABLE "search_profile_categories" (
    "profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "search_profile_categories_pkey" PRIMARY KEY ("profile_id","category_id")
);

-- CreateTable
CREATE TABLE "job_source_postings" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "source_key" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "external_job_id" TEXT NOT NULL,
    "job_url" TEXT NOT NULL,
    "application_url" TEXT,
    "source_url" TEXT,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "content_hash" CHAR(64) NOT NULL,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),
    "source_updated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_source_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_duplicate_candidates" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "duplicate_of_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_duplicate_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_category_assignments" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "user_id" UUID,
    "method" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matched_terms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "classifier_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_category_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_search_profile_hits" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "discovery_run_id" UUID,
    "reasons" JSONB NOT NULL DEFAULT '{}',
    "first_matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_matched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_search_profile_hits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "profile_id" UUID,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "sources_total" INTEGER NOT NULL DEFAULT 0,
    "sources_done" INTEGER NOT NULL DEFAULT 0,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "valid" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "heartbeat_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_sync_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "discovery_run_id" UUID,
    "source_id" UUID,
    "source_key" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SYNC',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "requests" INTEGER NOT NULL DEFAULT 0,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "valid" INTEGER NOT NULL DEFAULT 0,
    "invalid" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "error_kind" TEXT,
    "error_message" TEXT,
    "invalid_reasons" JSONB NOT NULL DEFAULT '{}',
    "duration_ms" INTEGER,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "source_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "market_locations_country_code_sort_order_idx" ON "market_locations"("country_code", "sort_order");

-- CreateIndex
CREATE INDEX "market_locations_user_id_idx" ON "market_locations"("user_id");

-- CreateIndex
CREATE INDEX "job_categories_user_id_idx" ON "job_categories"("user_id");

-- CreateIndex
CREATE INDEX "job_category_terms_category_id_idx" ON "job_category_terms"("category_id");

-- CreateIndex
CREATE INDEX "job_category_terms_user_id_idx" ON "job_category_terms"("user_id");

-- CreateIndex
CREATE INDEX "search_profiles_enabled_next_run_at_idx" ON "search_profiles"("enabled", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "search_profiles_user_id_name_key" ON "search_profiles"("user_id", "name");

-- CreateIndex
CREATE INDEX "search_profile_locations_location_id_idx" ON "search_profile_locations"("location_id");

-- CreateIndex
CREATE INDEX "search_profile_locations_user_id_idx" ON "search_profile_locations"("user_id");

-- CreateIndex
CREATE INDEX "search_profile_categories_category_id_idx" ON "search_profile_categories"("category_id");

-- CreateIndex
CREATE INDEX "search_profile_categories_user_id_idx" ON "search_profile_categories"("user_id");

-- CreateIndex
CREATE INDEX "job_source_postings_job_id_idx" ON "job_source_postings"("job_id");

-- CreateIndex
CREATE INDEX "job_source_postings_source_key_board_removed_at_idx" ON "job_source_postings"("source_key", "board", "removed_at");

-- CreateIndex
CREATE UNIQUE INDEX "job_source_postings_source_key_board_external_job_id_key" ON "job_source_postings"("source_key", "board", "external_job_id");

-- CreateIndex
CREATE INDEX "job_duplicate_candidates_duplicate_of_id_idx" ON "job_duplicate_candidates"("duplicate_of_id");

-- CreateIndex
CREATE INDEX "job_duplicate_candidates_status_idx" ON "job_duplicate_candidates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_duplicate_candidates_job_id_duplicate_of_id_key" ON "job_duplicate_candidates"("job_id", "duplicate_of_id");

-- CreateIndex
CREATE INDEX "job_category_assignments_job_id_idx" ON "job_category_assignments"("job_id");

-- CreateIndex
CREATE INDEX "job_category_assignments_category_id_job_id_idx" ON "job_category_assignments"("category_id", "job_id");

-- CreateIndex
CREATE INDEX "job_category_assignments_user_id_idx" ON "job_category_assignments"("user_id");

-- CreateIndex
CREATE INDEX "job_search_profile_hits_user_id_job_id_idx" ON "job_search_profile_hits"("user_id", "job_id");

-- CreateIndex
CREATE INDEX "job_search_profile_hits_job_id_idx" ON "job_search_profile_hits"("job_id");

-- CreateIndex
CREATE INDEX "job_search_profile_hits_discovery_run_id_idx" ON "job_search_profile_hits"("discovery_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_search_profile_hits_profile_id_job_id_key" ON "job_search_profile_hits"("profile_id", "job_id");

-- CreateIndex
CREATE INDEX "discovery_runs_user_id_created_at_idx" ON "discovery_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "discovery_runs_profile_id_idx" ON "discovery_runs"("profile_id");

-- CreateIndex
CREATE INDEX "discovery_runs_status_idx" ON "discovery_runs"("status");

-- CreateIndex
CREATE INDEX "source_sync_runs_user_id_started_at_idx" ON "source_sync_runs"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "source_sync_runs_discovery_run_id_idx" ON "source_sync_runs"("discovery_run_id");

-- CreateIndex
CREATE INDEX "source_sync_runs_source_id_started_at_idx" ON "source_sync_runs"("source_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "jobs_dedupe_fingerprint_idx" ON "jobs"("dedupe_fingerprint");

-- AddForeignKey
ALTER TABLE "market_locations" ADD CONSTRAINT "market_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_locations" ADD CONSTRAINT "market_locations_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_categories" ADD CONSTRAINT "job_categories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category_terms" ADD CONSTRAINT "job_category_terms_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category_terms" ADD CONSTRAINT "job_category_terms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profile_locations" ADD CONSTRAINT "search_profile_locations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profile_locations" ADD CONSTRAINT "search_profile_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "market_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profile_categories" ADD CONSTRAINT "search_profile_categories_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profile_categories" ADD CONSTRAINT "search_profile_categories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_source_postings" ADD CONSTRAINT "job_source_postings_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_duplicate_candidates" ADD CONSTRAINT "job_duplicate_candidates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_duplicate_candidates" ADD CONSTRAINT "job_duplicate_candidates_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category_assignments" ADD CONSTRAINT "job_category_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category_assignments" ADD CONSTRAINT "job_category_assignments_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "job_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category_assignments" ADD CONSTRAINT "job_category_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_profile_hits" ADD CONSTRAINT "job_search_profile_hits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_profile_hits" ADD CONSTRAINT "job_search_profile_hits_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_profile_hits" ADD CONSTRAINT "job_search_profile_hits_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_search_profile_hits" ADD CONSTRAINT "job_search_profile_hits_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sync_runs" ADD CONSTRAINT "source_sync_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sync_runs" ADD CONSTRAINT "source_sync_runs_discovery_run_id_fkey" FOREIGN KEY ("discovery_run_id") REFERENCES "discovery_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_sync_runs" ADD CONSTRAINT "source_sync_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "job_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written section (not generated by Prisma)
-- ===========================================================================

-- --- Reference data: India is a first-class target market ---------------------
UPDATE "countries" SET "is_target_market" = true, "is_enabled" = true WHERE "code" = 'IN';

-- --- Integrity constraints ---------------------------------------------------
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_experience_ck" CHECK ("experience_level" IN ('INTERNSHIP', 'ENTRY_LEVEL', 'GRADUATE', 'JUNIOR', 'MID_LEVEL', 'SENIOR', 'LEAD', 'UNKNOWN'));
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_discovery_lengths_ck" CHECK (
  ("department" IS NULL OR char_length("department") <= 200)
  AND ("team" IS NULL OR char_length("team") <= 200)
  AND ("experience_level_raw" IS NULL OR char_length("experience_level_raw") <= 100)
);

ALTER TABLE "market_locations" ADD CONSTRAINT "market_locations_kind_ck" CHECK ("kind" IN ('CITY', 'REGION', 'METRO', 'REMOTE_COUNTRY'));
ALTER TABLE "market_locations" ADD CONSTRAINT "market_locations_name_ck" CHECK (char_length("name") BETWEEN 1 AND 100 AND cardinality("aliases") <= 20);
CREATE UNIQUE INDEX "market_locations_name_uq" ON "market_locations" ("country_code", lower("name"), COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE "job_categories" ADD CONSTRAINT "job_categories_text_ck" CHECK ("key" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("key") <= 60 AND char_length("name") BETWEEN 1 AND 80 AND ("description" IS NULL OR char_length("description") <= 500));
CREATE UNIQUE INDEX "job_categories_key_uq" ON "job_categories" (COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid), "key");

ALTER TABLE "job_category_terms" ADD CONSTRAINT "job_category_terms_term_ck" CHECK (char_length("term") BETWEEN 1 AND 80);
CREATE UNIQUE INDEX "job_category_terms_uq" ON "job_category_terms" ("category_id", lower("term"), COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_name_ck" CHECK (char_length("name") BETWEEN 1 AND 100);
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_sets_ck" CHECK (
  "work_modes" <@ ARRAY['REMOTE', 'HYBRID', 'ONSITE', 'UNKNOWN']::text[]
  AND "employment_types" <@ ARRAY['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT', 'TEMPORARY', 'APPRENTICESHIP', 'FREELANCE', 'UNKNOWN']::text[]
  AND "experience_levels" <@ ARRAY['INTERNSHIP', 'ENTRY_LEVEL', 'GRADUATE', 'JUNIOR', 'MID_LEVEL', 'SENIOR', 'LEAD', 'UNKNOWN']::text[]
  AND "source_keys" <@ ARRAY['ASHBY', 'LEVER', 'GREENHOUSE']::text[]
  AND cardinality("country_codes") <= 60
  AND cardinality("search_terms") <= 50
);
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_visa_ck" CHECK ("visa_preference" IN ('SPONSORSHIP_REQUIRED', 'SPONSORSHIP_PREFERRED', 'SPONSORSHIP_NOT_REQUIRED', 'UNKNOWN'));
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_salary_ck" CHECK (
  ("salary_min" IS NULL OR "salary_min" >= 0) AND ("salary_max" IS NULL OR "salary_max" >= 0)
  AND ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max")
  AND ("salary_currency" IS NULL OR "salary_currency" ~ '^[A-Z]{3}$')
  AND ("salary_period" IS NULL OR "salary_period" IN ('YEAR', 'MONTH', 'WEEK', 'HOUR'))
  -- An amount without a currency cannot be compared with anything.
  AND (("salary_min" IS NULL AND "salary_max" IS NULL) OR "salary_currency" IS NOT NULL)
);
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_schedule_ck" CHECK ("schedule_interval_hours" IS NULL OR "schedule_interval_hours" BETWEEN 6 AND 720);

ALTER TABLE "job_source_postings" ADD CONSTRAINT "job_source_postings_ck" CHECK (
  "source_key" IN ('ASHBY', 'LEVER', 'GREENHOUSE')
  AND char_length("board") BETWEEN 1 AND 100 AND char_length("external_job_id") BETWEEN 1 AND 200
  AND "job_url" ~ '^https?://' AND ("application_url" IS NULL OR "application_url" ~ '^https?://') AND ("source_url" IS NULL OR "source_url" ~ '^https?://')
);

ALTER TABLE "job_duplicate_candidates" ADD CONSTRAINT "job_duplicate_candidates_ck" CHECK (
  "job_id" <> "duplicate_of_id"
  AND "reason" IN ('SAME_CONTENT', 'SIMILAR_TITLE_LOCATION')
  AND "status" IN ('PENDING', 'CONFIRMED', 'DISMISSED')
  AND "similarity" BETWEEN 0 AND 1
);

ALTER TABLE "job_category_assignments" ADD CONSTRAINT "job_category_assignments_ck" CHECK (
  "method" IN ('RULE', 'AI', 'USER')
  AND "confidence" BETWEEN 0 AND 1
  AND ("method" <> 'AI' OR "model" IS NOT NULL)
  AND cardinality("matched_terms") <= 20
);
CREATE UNIQUE INDEX "job_category_assignments_uq" ON "job_category_assignments" ("job_id", "category_id", "method", COALESCE("user_id", '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_ck" CHECK (
  "trigger" IN ('MANUAL', 'SCHEDULED')
  AND "status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED')
  AND "stage" IN ('QUEUED', 'FETCHING', 'NORMALIZING', 'DEDUPLICATING', 'SAVING', 'MATCHING_PROFILE', 'DONE')
  AND LEAST("sources_total", "sources_done", "fetched", "valid", "invalid", "created", "updated", "unchanged", "duplicates", "flagged", "closed", "matched", "error_count") >= 0
  AND ("message" IS NULL OR char_length("message") <= 2000)
);
-- At most one active run per user (prevents double-clicks and overlapping schedules).
CREATE UNIQUE INDEX "discovery_runs_one_active_uq" ON "discovery_runs" ("user_id") WHERE "status" IN ('QUEUED', 'RUNNING');

ALTER TABLE "source_sync_runs" ADD CONSTRAINT "source_sync_runs_ck" CHECK (
  "source_key" IN ('ASHBY', 'LEVER', 'GREENHOUSE')
  AND "kind" IN ('TEST', 'SYNC')
  AND "status" IN ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED')
  AND LEAST("requests", "fetched", "valid", "invalid", "created", "updated", "unchanged", "duplicates", "flagged", "closed") >= 0
  AND ("error_message" IS NULL OR char_length("error_message") <= 2000)
);

-- --- Seed configuration (system defaults, user_id NULL; users add their own) ---
INSERT INTO "market_locations" ("id", "country_code", "name", "kind", "aliases", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'IN', 'Remote / Anywhere in India', 'REMOTE_COUNTRY', ARRAY['remote india', 'anywhere in india', 'india remote'], 0, now()),
  (gen_random_uuid(), 'IN', 'Kolkata', 'CITY', ARRAY['calcutta'], 10, now()),
  (gen_random_uuid(), 'IN', 'Bengaluru', 'CITY', ARRAY['bangalore', 'bengaluru urban'], 20, now()),
  (gen_random_uuid(), 'IN', 'Hyderabad', 'CITY', ARRAY['secunderabad'], 30, now()),
  (gen_random_uuid(), 'IN', 'Mumbai', 'CITY', ARRAY['bombay', 'navi mumbai', 'thane'], 40, now()),
  (gen_random_uuid(), 'IN', 'Delhi NCR', 'METRO', ARRAY['delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida', 'greater noida', 'ghaziabad', 'faridabad'], 50, now()),
  (gen_random_uuid(), 'IN', 'Gurugram', 'CITY', ARRAY['gurgaon'], 60, now()),
  (gen_random_uuid(), 'IN', 'Noida', 'CITY', ARRAY['greater noida'], 70, now()),
  (gen_random_uuid(), 'IN', 'Pune', 'CITY', ARRAY[]::text[], 80, now()),
  (gen_random_uuid(), 'IN', 'Chennai', 'CITY', ARRAY['madras'], 90, now()),
  (gen_random_uuid(), 'IN', 'Ahmedabad', 'CITY', ARRAY[]::text[], 100, now()),
  (gen_random_uuid(), 'AE', 'Dubai', 'CITY', ARRAY[]::text[], 10, now()),
  (gen_random_uuid(), 'AE', 'Abu Dhabi', 'CITY', ARRAY[]::text[], 20, now()),
  (gen_random_uuid(), 'AE', 'Sharjah', 'CITY', ARRAY[]::text[], 30, now()),
  (gen_random_uuid(), 'QA', 'Doha', 'CITY', ARRAY[]::text[], 10, now()),
  (gen_random_uuid(), 'SA', 'Riyadh', 'CITY', ARRAY[]::text[], 10, now()),
  (gen_random_uuid(), 'SA', 'Jeddah', 'CITY', ARRAY['jiddah'], 20, now());

INSERT INTO "job_categories" ("id", "key", "name", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'ai-automation', 'AI & Automation', 10, now()),
  (gen_random_uuid(), 'ai-operations', 'AI Operations', 20, now()),
  (gen_random_uuid(), 'digital-marketing', 'Digital Marketing', 30, now()),
  (gen_random_uuid(), 'marketing-operations', 'Marketing Operations', 40, now()),
  (gen_random_uuid(), 'growth-marketing', 'Growth Marketing', 50, now()),
  (gen_random_uuid(), 'social-media', 'Social Media', 60, now()),
  (gen_random_uuid(), 'content-creative', 'Content & Creative', 70, now()),
  (gen_random_uuid(), 'business-development', 'Business Development', 80, now()),
  (gen_random_uuid(), 'sales-sdr', 'Sales / SDR', 90, now()),
  (gen_random_uuid(), 'web-development', 'Web Development', 100, now()),
  (gen_random_uuid(), 'product-marketing', 'Product / Product Marketing', 110, now()),
  (gen_random_uuid(), 'startup-operations', 'Startup / Operations', 120, now()),
  (gen_random_uuid(), 'ecommerce', 'E-commerce', 130, now()),
  (gen_random_uuid(), 'data-analytics', 'Data / Analytics', 140, now()),
  (gen_random_uuid(), 'general-business', 'General Business', 150, now()),
  (gen_random_uuid(), 'custom', 'Custom', 160, now());

-- Search terms match job titles/departments. They are NOT candidate skills.
INSERT INTO "job_category_terms" ("id", "category_id", "term")
SELECT gen_random_uuid(), c."id", t.term
FROM (VALUES
  ('ai-automation', 'AI Automation'), ('ai-automation', 'AI Operations'), ('ai-automation', 'Automation Specialist'),
  ('ai-automation', 'AI Workflow'), ('ai-automation', 'LLM Operations'), ('ai-automation', 'No-code Automation'),
  ('ai-automation', 'n8n'), ('ai-automation', 'Make.com'), ('ai-automation', 'Zapier'), ('ai-automation', 'Workflow Automation'),
  ('ai-automation', 'AI Agent'), ('ai-automation', 'Prompt Engineer'), ('ai-automation', 'AI Engineer'), ('ai-automation', 'Automation Engineer'),
  ('ai-operations', 'AI Operations'), ('ai-operations', 'AI Ops'), ('ai-operations', 'AI Trainer'), ('ai-operations', 'AI Data Specialist'),
  ('ai-operations', 'AI Implementation'), ('ai-operations', 'AI Quality'), ('ai-operations', 'Data Annotation'), ('ai-operations', 'Model Operations'),
  ('digital-marketing', 'Digital Marketing'), ('digital-marketing', 'Performance Marketing'), ('digital-marketing', 'SEO'),
  ('digital-marketing', 'SEM'), ('digital-marketing', 'PPC'), ('digital-marketing', 'Paid Media'), ('digital-marketing', 'Online Marketing'),
  ('digital-marketing', 'Marketing Executive'), ('digital-marketing', 'Marketing Associate'), ('digital-marketing', 'Marketing Intern'),
  ('digital-marketing', 'Marketing Specialist'), ('digital-marketing', 'Marketing Manager'),
  ('marketing-operations', 'Marketing Operations'), ('marketing-operations', 'Marketing Ops'), ('marketing-operations', 'Marketing Automation'),
  ('marketing-operations', 'CRM'), ('marketing-operations', 'HubSpot'), ('marketing-operations', 'Campaign Operations'), ('marketing-operations', 'Lifecycle Marketing'),
  ('growth-marketing', 'Growth Marketing'), ('growth-marketing', 'Growth Hacker'), ('growth-marketing', 'Growth Manager'),
  ('growth-marketing', 'User Acquisition'), ('growth-marketing', 'Demand Generation'), ('growth-marketing', 'Acquisition Marketing'),
  ('social-media', 'Social Media'), ('social-media', 'Community Manager'), ('social-media', 'Influencer Marketing'), ('social-media', 'Community Management'),
  ('content-creative', 'Content Writer'), ('content-creative', 'Content Marketing'), ('content-creative', 'Copywriter'),
  ('content-creative', 'Content Creator'), ('content-creative', 'Content Strategist'), ('content-creative', 'Graphic Designer'),
  ('content-creative', 'Video Editor'), ('content-creative', 'Creative Designer'),
  ('business-development', 'Business Development'), ('business-development', 'Business Development Executive'),
  ('business-development', 'Business Development Associate'), ('business-development', 'Partnerships'), ('business-development', 'Strategic Partnerships'),
  ('sales-sdr', 'Sales Development'), ('sales-sdr', 'SDR'), ('sales-sdr', 'BDR'), ('sales-sdr', 'Sales Executive'),
  ('sales-sdr', 'Inside Sales'), ('sales-sdr', 'Account Executive'), ('sales-sdr', 'Sales Associate'), ('sales-sdr', 'Lead Generation'),
  ('web-development', 'Web Developer'), ('web-development', 'Frontend'), ('web-development', 'Front-end'), ('web-development', 'Full Stack'),
  ('web-development', 'Fullstack'), ('web-development', 'React'), ('web-development', 'Next.js'), ('web-development', 'WordPress'),
  ('web-development', 'JavaScript'), ('web-development', 'Web Designer'),
  ('product-marketing', 'Product Manager'), ('product-marketing', 'Product Marketing'), ('product-marketing', 'Associate Product Manager'),
  ('product-marketing', 'Product Owner'), ('product-marketing', 'Product Analyst'),
  ('startup-operations', 'Operations Associate'), ('startup-operations', 'Business Operations'), ('startup-operations', 'Founder''s Office'),
  ('startup-operations', 'Chief of Staff'), ('startup-operations', 'Strategy & Operations'), ('startup-operations', 'Operations Manager'),
  ('startup-operations', 'Operations Executive'), ('startup-operations', 'Program Coordinator'),
  ('ecommerce', 'E-commerce'), ('ecommerce', 'Ecommerce'), ('ecommerce', 'Shopify'), ('ecommerce', 'Marketplace'),
  ('ecommerce', 'D2C'), ('ecommerce', 'Amazon Seller'),
  ('data-analytics', 'Data Analyst'), ('data-analytics', 'Business Analyst'), ('data-analytics', 'Analytics'),
  ('data-analytics', 'Business Intelligence'), ('data-analytics', 'Data Scientist'), ('data-analytics', 'Marketing Analyst'), ('data-analytics', 'SQL'),
  ('general-business', 'Management Trainee'), ('general-business', 'Graduate Trainee'), ('general-business', 'Business Associate'),
  ('general-business', 'Business Executive'), ('general-business', 'Administrative Assistant')
) AS t(key, term)
JOIN "job_categories" c ON c."key" = t.key AND c."user_id" IS NULL;

-- --- Row Level Security -------------------------------------------------------
ALTER TABLE "market_locations"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_categories"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_category_terms"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_profiles"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_profile_locations"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_profile_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_source_postings"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_duplicate_candidates"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_category_assignments"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_search_profile_hits"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discovery_runs"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "source_sync_runs"          ENABLE ROW LEVEL SECURITY;

-- Configuration: everyone reads system defaults + their own rows; writes only own rows.
GRANT SELECT, INSERT, UPDATE, DELETE ON "market_locations", "job_categories", "job_category_terms" TO jobhunt_app;
CREATE POLICY "market_locations_read" ON "market_locations" FOR SELECT TO jobhunt_app
  USING ("user_id" IS NULL OR "user_id" = (SELECT app_current_user_id()));
CREATE POLICY "market_locations_own" ON "market_locations" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()));
CREATE POLICY "job_categories_read" ON "job_categories" FOR SELECT TO jobhunt_app
  USING ("user_id" IS NULL OR "user_id" = (SELECT app_current_user_id()));
CREATE POLICY "job_categories_own" ON "job_categories" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()));
CREATE POLICY "job_category_terms_read" ON "job_category_terms" FOR SELECT TO jobhunt_app
  USING ("user_id" IS NULL OR "user_id" = (SELECT app_current_user_id()));
-- A user may add terms to any category they can see (system or own).
CREATE POLICY "job_category_terms_own" ON "job_category_terms" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "job_categories" c WHERE c."id" = "category_id"));

-- Search profiles and their links: strictly owner-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "search_profiles", "search_profile_locations", "search_profile_categories" TO jobhunt_app;
CREATE POLICY "search_profiles_owner" ON "search_profiles" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()));
CREATE POLICY "search_profile_locations_owner" ON "search_profile_locations" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "search_profiles" p WHERE p."id" = "profile_id")
    AND EXISTS (SELECT 1 FROM "market_locations" l WHERE l."id" = "location_id"));
CREATE POLICY "search_profile_categories_owner" ON "search_profile_categories" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "search_profiles" p WHERE p."id" = "profile_id")
    AND EXISTS (SELECT 1 FROM "job_categories" c WHERE c."id" = "category_id"));

-- Catalog side tables: readable when the job is visible (jobs RLS applies inside EXISTS); written by the system.
GRANT SELECT ON "job_source_postings", "job_duplicate_candidates" TO jobhunt_app;
CREATE POLICY "job_source_postings_read" ON "job_source_postings" FOR SELECT TO jobhunt_app
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"));
CREATE POLICY "job_duplicate_candidates_read" ON "job_duplicate_candidates" FOR SELECT TO jobhunt_app
  USING (EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id") AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "duplicate_of_id"));

-- Category assignments: system rows + own rows are readable; users write only their own rows for visible jobs.
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_category_assignments" TO jobhunt_app;
CREATE POLICY "job_category_assignments_read" ON "job_category_assignments" FOR SELECT TO jobhunt_app
  USING (("user_id" IS NULL OR "user_id" = (SELECT app_current_user_id())) AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"));
CREATE POLICY "job_category_assignments_own" ON "job_category_assignments" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id")
    AND EXISTS (SELECT 1 FROM "job_categories" c WHERE c."id" = "category_id"));

-- Profile hits and run history: owner-only.
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_search_profile_hits" TO jobhunt_app;
CREATE POLICY "job_search_profile_hits_owner" ON "job_search_profile_hits" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "search_profiles" p WHERE p."id" = "profile_id")
    AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"));
GRANT SELECT, INSERT, UPDATE ON "discovery_runs", "source_sync_runs" TO jobhunt_app;
CREATE POLICY "discovery_runs_owner" ON "discovery_runs" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND ("profile_id" IS NULL OR EXISTS (SELECT 1 FROM "search_profiles" p WHERE p."id" = "profile_id")));
CREATE POLICY "source_sync_runs_owner" ON "source_sync_runs" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "market_locations", "job_categories", "job_category_terms", "search_profiles", "search_profile_locations", "search_profile_categories", "job_source_postings", "job_duplicate_candidates", "job_category_assignments", "job_search_profile_hits", "discovery_runs", "source_sync_runs" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
