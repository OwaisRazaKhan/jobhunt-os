-- Phase 4 — Matching engine (checkpoints 2–7).
-- Extends the matching foundation: match history (one CURRENT result per user + job, older
-- versions kept), per-requirement results with evidence, batch runs, and the user's
-- matching preferences (which preference mismatches are hard blocks).

-- --- Match history --------------------------------------------------------------------
DROP INDEX "job_matches_user_id_job_id_key";
ALTER TABLE "job_matches" ADD COLUMN "is_current" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "job_matches" ADD COLUMN "requirement_set_id" UUID;
ALTER TABLE "job_matches" ADD COLUMN "counts" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "job_matches" ADD COLUMN "summary" TEXT;
ALTER TABLE "job_matches" ADD COLUMN "semantic_assist" TEXT NOT NULL DEFAULT 'NOT_USED';
ALTER TABLE "job_matches" ADD COLUMN "ai_generation_id" UUID;
ALTER TABLE "job_matches" ADD COLUMN "duration_ms" INTEGER;
CREATE UNIQUE INDEX "job_matches_one_current_uq" ON "job_matches" ("user_id", "job_id") WHERE "is_current";
CREATE INDEX "job_matches_user_id_job_id_computed_at_idx" ON "job_matches" ("user_id", "job_id", "computed_at" DESC);
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_requirement_set_id_fkey"
  FOREIGN KEY ("requirement_set_id") REFERENCES "job_requirement_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_ai_generation_id_fkey"
  FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_matches" DROP CONSTRAINT "job_matches_overall_ck";
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_overall_ck" CHECK ("overall_status" IN (
  'STRONG_MATCH', 'GOOD_MATCH', 'PARTIAL_MATCH', 'LOW_MATCH', 'INSUFFICIENT_DATA', 'REVIEW', 'BLOCKED'
));
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_engine_ck" CHECK (
  jsonb_typeof("counts") = 'object'
  AND "semantic_assist" IN ('NOT_USED', 'NOT_NEEDED', 'UNAVAILABLE', 'APPLIED', 'REJECTED')
  AND ("summary" IS NULL OR char_length("summary") <= 2000)
  AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
);

-- --- Requirement-level results ----------------------------------------------------------
CREATE TABLE "job_match_requirement_results" (
  "id" UUID NOT NULL,
  "match_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "requirement_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "relationship" TEXT,
  "gap_kind" TEXT,
  "is_hard_block" BOOLEAN NOT NULL DEFAULT false,
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "explanation" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'RULE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_match_requirement_results_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_match_requirement_results_ck" CHECK (
    "status" IN ('MATCHED', 'RELATED', 'PARTIAL', 'GAP', 'UNKNOWN', 'UNVERIFIED', 'CONFLICT', 'BLOCKED', 'NOT_APPLICABLE')
    AND ("relationship" IS NULL OR "relationship" IN ('EXACT', 'RELATED', 'NONE'))
    AND ("gap_kind" IS NULL OR "gap_kind" IN ('REQUIRED', 'PREFERRED', 'PREFERENCE'))
    AND "method" IN ('RULE', 'AI_ASSISTED')
    AND jsonb_typeof("evidence") = 'array'
    AND char_length("explanation") BETWEEN 1 AND 1000
    -- A hard block is always a BLOCKED result, and BLOCKED is always a hard block.
    AND ("is_hard_block" = ("status" = 'BLOCKED'))
    -- AI may only ever propose a RELATED relationship, never an exact match or a block.
    AND ("method" = 'RULE' OR ("status" = 'RELATED' AND "relationship" = 'RELATED'))
  )
);
CREATE UNIQUE INDEX "job_match_requirement_results_match_id_requirement_id_key" ON "job_match_requirement_results" ("match_id", "requirement_id");
CREATE INDEX "job_match_requirement_results_user_id_idx" ON "job_match_requirement_results" ("user_id");
CREATE INDEX "job_match_requirement_results_requirement_id_idx" ON "job_match_requirement_results" ("requirement_id");
ALTER TABLE "job_match_requirement_results" ADD CONSTRAINT "job_match_requirement_results_match_id_fkey"
  FOREIGN KEY ("match_id") REFERENCES "job_matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_match_requirement_results" ADD CONSTRAINT "job_match_requirement_results_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_match_requirement_results" ADD CONSTRAINT "job_match_requirement_results_requirement_id_fkey"
  FOREIGN KEY ("requirement_id") REFERENCES "job_requirements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Batch runs -------------------------------------------------------------------------
CREATE TABLE "match_batches" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "job_ids" UUID[] NOT NULL,
  "total" INTEGER NOT NULL,
  "done" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "counts" JSONB NOT NULL DEFAULT '{}',
  "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
  "message" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "heartbeat_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "match_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "match_batches_ck" CHECK (
    "status" IN ('QUEUED', 'RUNNING', 'COMPLETED', 'CANCELLED', 'FAILED')
    AND "total" BETWEEN 1 AND 200 AND cardinality("job_ids") = "total"
    AND "done" >= 0 AND "failed" >= 0 AND "skipped" >= 0 AND "done" + "failed" + "skipped" <= "total"
    AND jsonb_typeof("counts") = 'object'
  )
);
CREATE INDEX "match_batches_user_id_created_at_idx" ON "match_batches" ("user_id", "created_at" DESC);
-- One active batch per user.
CREATE UNIQUE INDEX "match_batches_one_active_uq" ON "match_batches" ("user_id") WHERE "status" IN ('QUEUED', 'RUNNING');
ALTER TABLE "match_batches" ADD CONSTRAINT "match_batches_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Matching preferences (separate from candidate facts) ------------------------------------
CREATE TABLE "matching_preferences" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "work_mode_hard" BOOLEAN NOT NULL DEFAULT false,
  "employment_type_hard" BOOLEAN NOT NULL DEFAULT false,
  "location_hard" BOOLEAN NOT NULL DEFAULT false,
  "salary_min_hard" BOOLEAN NOT NULL DEFAULT false,
  "semantic_assist" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "matching_preferences_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "matching_preferences_user_id_key" ON "matching_preferences" ("user_id");
ALTER TABLE "matching_preferences" ADD CONSTRAINT "matching_preferences_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Row Level Security: all owner-only -----------------------------------------------------
ALTER TABLE "job_match_requirement_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "match_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "matching_preferences" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON "job_match_requirement_results", "match_batches", "matching_preferences" TO jobhunt_app;
CREATE POLICY "job_match_requirement_results_owner" ON "job_match_requirement_results" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK (
    "user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "job_matches" m WHERE m."id" = "match_id" AND m."user_id" = (SELECT app_current_user_id()))
    AND EXISTS (SELECT 1 FROM "job_requirements" r WHERE r."id" = "requirement_id")
  );
CREATE POLICY "match_batches_owner" ON "match_batches" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()));
CREATE POLICY "matching_preferences_owner" ON "matching_preferences" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id())) WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "job_match_requirement_results", "match_batches", "matching_preferences" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
