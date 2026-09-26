-- Phase 4 / Checkpoint 1 — versioned job requirement sets.
-- Extends the Phase 4 foundation (20260928000000): requirements now belong to a numbered,
-- immutable set per job (extractor version + job content hash). A new extraction creates a
-- new set and supersedes the old one, which is kept so earlier matches stay traceable.
-- Category and level are split into (category, requirement_type).

CREATE TABLE "job_requirement_sets" (
  "id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "extractor_version" TEXT NOT NULL,
  "job_content_hash" CHAR(64) NOT NULL,
  "is_current" BOOLEAN NOT NULL DEFAULT true,
  "requirement_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_requirement_sets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "job_requirement_sets_ck" CHECK (
    "version" >= 1 AND "requirement_count" >= 0 AND char_length("extractor_version") BETWEEN 1 AND 20
  )
);
CREATE UNIQUE INDEX "job_requirement_sets_job_id_version_key" ON "job_requirement_sets" ("job_id", "version");
-- At most one current set per job.
CREATE UNIQUE INDEX "job_requirement_sets_one_current_uq" ON "job_requirement_sets" ("job_id") WHERE "is_current";
ALTER TABLE "job_requirement_sets" ADD CONSTRAINT "job_requirement_sets_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- --- job_requirements: set membership, separate type, new category set -------------------
ALTER TABLE "job_requirements" ADD COLUMN "set_id" UUID;
ALTER TABLE "job_requirements" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "job_requirements" RENAME COLUMN "required_level" TO "requirement_type";
ALTER TABLE "job_requirements" DROP CONSTRAINT "job_requirements_category_ck";
ALTER TABLE "job_requirements" DROP CONSTRAINT "job_requirements_level_ck";

UPDATE "job_requirements" SET "requirement_type" = 'UNKNOWN' WHERE "requirement_type" = 'UNSPECIFIED';
UPDATE "job_requirements" SET "category" = CASE "category"
  WHEN 'REQUIRED_SKILL' THEN 'SKILL' WHEN 'PREFERRED_SKILL' THEN 'SKILL'
  WHEN 'REQUIRED_EXPERIENCE' THEN 'EXPERIENCE' WHEN 'PREFERRED_EXPERIENCE' THEN 'EXPERIENCE'
  WHEN 'REQUIRED_EDUCATION' THEN 'EDUCATION' WHEN 'PREFERRED_EDUCATION' THEN 'EDUCATION'
  WHEN 'REQUIRED_LANGUAGE' THEN 'LANGUAGE' WHEN 'PREFERRED_LANGUAGE' THEN 'LANGUAGE'
  WHEN 'WORK_AUTHORIZATION' THEN 'AUTHORIZATION' WHEN 'EMPLOYMENT_TYPE' THEN 'EMPLOYMENT'
  ELSE "category" END;

-- Legacy rows (if any) become version 1 of their job's set.
INSERT INTO "job_requirement_sets" ("id", "job_id", "version", "extractor_version", "job_content_hash", "is_current", "requirement_count")
SELECT gen_random_uuid(), r."job_id", 1, 'legacy', j."content_hash", true, count(*)::int
FROM "job_requirements" r JOIN "jobs" j ON j."id" = r."job_id"
GROUP BY r."job_id", j."content_hash";
UPDATE "job_requirements" r SET "set_id" = s."id"
FROM "job_requirement_sets" s WHERE s."job_id" = r."job_id";

ALTER TABLE "job_requirements" ALTER COLUMN "set_id" SET NOT NULL;
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_set_id_fkey"
  FOREIGN KEY ("set_id") REFERENCES "job_requirement_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "job_requirements_set_id_position_idx" ON "job_requirements" ("set_id", "position");
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_category_ck" CHECK ("category" IN (
  'SKILL', 'EXPERIENCE', 'EDUCATION', 'LOCATION', 'WORK_MODE', 'EMPLOYMENT', 'SALARY',
  'AUTHORIZATION', 'LANGUAGE', 'CERTIFICATION', 'DOMAIN', 'PORTFOLIO', 'OTHER'
));
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_type_ck"
  CHECK ("requirement_type" IN ('REQUIRED', 'PREFERRED', 'INFORMATIONAL', 'UNKNOWN'));

-- --- Row Level Security -------------------------------------------------------------------
-- Sets follow their job (readable when the job is visible). Shared jobs' sets are written by the
-- system (owner connection); an owner may write sets for their own private jobs.
ALTER TABLE "job_requirement_sets" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "job_requirement_sets" TO jobhunt_app;
CREATE POLICY "job_requirement_sets_select" ON "job_requirement_sets" FOR SELECT TO jobhunt_app
  USING (EXISTS (
    SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"
      AND ((j."visibility" = 'PUBLIC' AND j."deleted_at" IS NULL) OR j."created_by_user_id" = (SELECT app_current_user_id()))
  ));
CREATE POLICY "job_requirement_sets_write_own" ON "job_requirement_sets" FOR ALL TO jobhunt_app
  USING (EXISTS (
    SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."visibility" = 'PRIVATE'
      AND j."deleted_at" IS NULL AND j."created_by_user_id" = (SELECT app_current_user_id())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "jobs" j WHERE j."id" = "job_id" AND j."visibility" = 'PRIVATE'
      AND j."deleted_at" IS NULL AND j."created_by_user_id" = (SELECT app_current_user_id())
  ));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "job_requirement_sets" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
