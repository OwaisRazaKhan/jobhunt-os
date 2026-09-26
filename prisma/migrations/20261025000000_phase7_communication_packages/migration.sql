
-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "recipient_context_id" UUID,
ADD COLUMN     "strategy" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "recipient_contexts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "company_id" UUID,
    "name" TEXT,
    "title" TEXT,
    "company" TEXT,
    "email" TEXT,
    "recipient_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL DEFAULT 'USER_PROVIDED',
    "source_url" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "notes" TEXT,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recipient_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "preferred_greeting" TEXT,
    "preferred_closing" TEXT,
    "default_tone" TEXT,
    "default_length" TEXT,
    "avoid_phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_packages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "company_id" UUID,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'PORTAL',
    "status" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "include_cover_letter" BOOLEAN NOT NULL DEFAULT false,
    "include_email" BOOLEAN NOT NULL DEFAULT false,
    "match_id" UUID,
    "requirement_set_id" UUID,
    "job_research_id" UUID,
    "job_content_hash" CHAR(64),
    "candidate_snapshot_hash" CHAR(64),
    "recipient_context_id" UUID,
    "recipient_snapshot" JSONB NOT NULL DEFAULT '{}',
    "strategy_snapshot" JSONB NOT NULL DEFAULT '{}',
    "integrity_hash" CHAR(64),
    "ready_at" TIMESTAMPTZ(3),
    "stale_at" TIMESTAMPTZ(3),
    "stale_reasons" JSONB NOT NULL DEFAULT '[]',
    "invalid_reason" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "previous_package_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_package_assets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "asset_type" TEXT NOT NULL,
    "resume_version_id" UUID,
    "communication_version_id" UUID,
    "content_hash" CHAR(64) NOT NULL,
    "approval_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_package_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_package_checks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "result" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "integrity_hash" CHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_package_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipient_contexts_user_id_updated_at_idx" ON "recipient_contexts"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "recipient_contexts_company_id_idx" ON "recipient_contexts"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_user_id_key" ON "communication_preferences"("user_id");

-- CreateIndex
CREATE INDEX "communication_packages_user_id_status_updated_at_idx" ON "communication_packages"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "communication_packages_job_id_idx" ON "communication_packages"("job_id");

-- CreateIndex
CREATE INDEX "communication_packages_company_id_idx" ON "communication_packages"("company_id");

-- CreateIndex
CREATE INDEX "communication_packages_match_id_idx" ON "communication_packages"("match_id");

-- CreateIndex
CREATE INDEX "communication_packages_requirement_set_id_idx" ON "communication_packages"("requirement_set_id");

-- CreateIndex
CREATE INDEX "communication_packages_job_research_id_idx" ON "communication_packages"("job_research_id");

-- CreateIndex
CREATE INDEX "communication_packages_recipient_context_id_idx" ON "communication_packages"("recipient_context_id");

-- CreateIndex
CREATE INDEX "communication_packages_previous_package_id_idx" ON "communication_packages"("previous_package_id");

-- CreateIndex
CREATE INDEX "communication_package_assets_user_id_idx" ON "communication_package_assets"("user_id");

-- CreateIndex
CREATE INDEX "communication_package_assets_resume_version_id_idx" ON "communication_package_assets"("resume_version_id");

-- CreateIndex
CREATE INDEX "communication_package_assets_communication_version_id_idx" ON "communication_package_assets"("communication_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_package_assets_package_id_asset_type_key" ON "communication_package_assets"("package_id", "asset_type");

-- CreateIndex
CREATE INDEX "communication_package_checks_package_id_created_at_idx" ON "communication_package_checks"("package_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_package_checks_user_id_idx" ON "communication_package_checks"("user_id");

-- CreateIndex
CREATE INDEX "communications_recipient_context_id_idx" ON "communications"("recipient_context_id");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_recipient_context_id_fkey" FOREIGN KEY ("recipient_context_id") REFERENCES "recipient_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_contexts" ADD CONSTRAINT "recipient_contexts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipient_contexts" ADD CONSTRAINT "recipient_contexts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "job_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_requirement_set_id_fkey" FOREIGN KEY ("requirement_set_id") REFERENCES "job_requirement_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_job_research_id_fkey" FOREIGN KEY ("job_research_id") REFERENCES "job_research"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_recipient_context_id_fkey" FOREIGN KEY ("recipient_context_id") REFERENCES "recipient_contexts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_previous_package_id_fkey" FOREIGN KEY ("previous_package_id") REFERENCES "communication_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_assets" ADD CONSTRAINT "communication_package_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_assets" ADD CONSTRAINT "communication_package_assets_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "communication_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_assets" ADD CONSTRAINT "communication_package_assets_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "resume_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_assets" ADD CONSTRAINT "communication_package_assets_communication_version_id_fkey" FOREIGN KEY ("communication_version_id") REFERENCES "communication_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_checks" ADD CONSTRAINT "communication_package_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_package_checks" ADD CONSTRAINT "communication_package_checks_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "communication_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: integrity constraints, package immutability, RLS, grants
-- ===========================================================================

ALTER TABLE "communications" ADD CONSTRAINT "communications_strategy_ck" CHECK (jsonb_typeof("strategy") = 'object');

ALTER TABLE "recipient_contexts" ADD CONSTRAINT "recipient_contexts_ck" CHECK (
  "recipient_type" IN ('RECRUITER', 'HIRING_MANAGER', 'HR', 'TEAM_MEMBER', 'GENERAL_COMPANY', 'UNKNOWN', 'CUSTOM')
  AND "source" IN ('JOB_POST', 'OFFICIAL_COMPANY_PAGE', 'USER_PROVIDED', 'PUBLIC_PROFESSIONAL_SOURCE', 'PHASE_8_DISCOVERY', 'UNKNOWN')
  AND "verification_status" IN ('SOURCE_VERIFIED', 'UNVERIFIED', 'INVALID', 'STALE')
  AND "confidence" IN ('HIGH', 'MEDIUM', 'LOW')
  -- "Source verified" needs a citable public source; user-provided / unknown details are never verified.
  AND ("verification_status" <> 'SOURCE_VERIFIED' OR ("source" IN ('JOB_POST', 'OFFICIAL_COMPANY_PAGE', 'PUBLIC_PROFESSIONAL_SOURCE') AND "source_url" IS NOT NULL AND "verified_at" IS NOT NULL))
  AND ("name" IS NOT NULL OR "email" IS NOT NULL OR "title" IS NOT NULL OR "company" IS NOT NULL)
  AND ("name" IS NULL OR char_length("name") <= 200)
  AND ("title" IS NULL OR char_length("title") <= 200)
  AND ("company" IS NULL OR char_length("company") <= 200)
  AND ("email" IS NULL OR ("email" ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' AND char_length("email") <= 254))
  AND ("source_url" IS NULL OR ("source_url" ~ '^https?://' AND char_length("source_url") <= 2048))
  AND ("notes" IS NULL OR char_length("notes") <= 2000)
);

ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_ck" CHECK (
  ("preferred_greeting" IS NULL OR char_length("preferred_greeting") BETWEEN 1 AND 40)
  AND ("preferred_closing" IS NULL OR char_length("preferred_closing") BETWEEN 1 AND 60)
  AND ("default_tone" IS NULL OR "default_tone" IN ('NATURAL', 'PROFESSIONAL', 'WARM', 'DIRECT', 'CONFIDENT', 'CONCISE', 'FORMAL'))
  AND ("default_length" IS NULL OR "default_length" IN ('SHORT', 'STANDARD', 'DETAILED'))
  AND cardinality("avoid_phrases") <= 30
);

ALTER TABLE "communication_packages" ADD CONSTRAINT "communication_packages_ck" CHECK (
  "channel" IN ('EMAIL', 'PORTAL')
  AND "status" IN ('INCOMPLETE', 'READY_FOR_REVIEW', 'READY_FOR_APPLICATION', 'STALE', 'INVALID', 'ARCHIVED')
  AND char_length("title") BETWEEN 1 AND 200
  AND ("channel" <> 'EMAIL' OR "include_email")
  AND ("job_content_hash" IS NULL OR "job_content_hash" ~ '^[0-9a-f]{64}$')
  AND ("candidate_snapshot_hash" IS NULL OR "candidate_snapshot_hash" ~ '^[0-9a-f]{64}$')
  AND ("integrity_hash" IS NULL OR "integrity_hash" ~ '^[0-9a-f]{64}$')
  -- A ready package always carries its integrity hash and readiness time.
  AND ("status" <> 'READY_FOR_APPLICATION' OR ("integrity_hash" IS NOT NULL AND "ready_at" IS NOT NULL))
  AND ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
  AND jsonb_typeof("recipient_snapshot") = 'object'
  AND jsonb_typeof("strategy_snapshot") = 'object'
  AND jsonb_typeof("stale_reasons") = 'array'
  AND ("invalid_reason" IS NULL OR char_length("invalid_reason") <= 1000)
  AND ("previous_package_id" IS NULL OR "previous_package_id" <> "id")
);

ALTER TABLE "communication_package_assets" ADD CONSTRAINT "communication_package_assets_ck" CHECK (
  "asset_type" IN ('RESUME', 'EMAIL', 'COVER_LETTER')
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND (("asset_type" = 'RESUME') = ("resume_version_id" IS NOT NULL))
  AND (("asset_type" <> 'RESUME') = ("communication_version_id" IS NOT NULL))
);

ALTER TABLE "communication_package_checks" ADD CONSTRAINT "communication_package_checks_ck" CHECK (
  "result" IN ('READY', 'NOT_READY')
  AND jsonb_typeof("items") = 'array'
  AND ("integrity_hash" IS NULL OR "integrity_hash" ~ '^[0-9a-f]{64}$')
);

-- --- Package immutability ------------------------------------------------------
-- Once READY_FOR_APPLICATION (and after STALE / INVALID / ARCHIVED) a package's references, snapshots and
-- integrity hash never change; only its lifecycle status moves forward. Updating means a NEW package.
CREATE OR REPLACE FUNCTION communication_packages_protect_frozen() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD."status" IN ('READY_FOR_APPLICATION', 'STALE', 'INVALID', 'ARCHIVED') THEN
    IF NEW."job_id" IS DISTINCT FROM OLD."job_id"
      OR NEW."channel" IS DISTINCT FROM OLD."channel"
      OR NEW."include_cover_letter" IS DISTINCT FROM OLD."include_cover_letter"
      OR NEW."include_email" IS DISTINCT FROM OLD."include_email"
      OR NEW."match_id" IS DISTINCT FROM OLD."match_id"
      OR NEW."requirement_set_id" IS DISTINCT FROM OLD."requirement_set_id"
      OR NEW."job_research_id" IS DISTINCT FROM OLD."job_research_id"
      OR NEW."job_content_hash" IS DISTINCT FROM OLD."job_content_hash"
      OR NEW."candidate_snapshot_hash" IS DISTINCT FROM OLD."candidate_snapshot_hash"
      OR NEW."recipient_context_id" IS DISTINCT FROM OLD."recipient_context_id"
      OR NEW."recipient_snapshot" IS DISTINCT FROM OLD."recipient_snapshot"
      OR NEW."strategy_snapshot" IS DISTINCT FROM OLD."strategy_snapshot"
      OR NEW."integrity_hash" IS DISTINCT FROM OLD."integrity_hash"
      OR NEW."ready_at" IS DISTINCT FROM OLD."ready_at"
    THEN
      RAISE EXCEPTION 'A package that was ready for application is immutable; create a new package instead'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Allowed forward moves only (never back to an editable state).
    IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
         (OLD."status" = 'READY_FOR_APPLICATION' AND NEW."status" IN ('STALE', 'INVALID', 'ARCHIVED'))
      OR (OLD."status" IN ('STALE', 'INVALID') AND NEW."status" = 'ARCHIVED')
    ) THEN
      RAISE EXCEPTION 'Invalid package status change % -> %', OLD."status", NEW."status"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "communication_packages_protect_frozen"
  BEFORE UPDATE ON "communication_packages"
  FOR EACH ROW EXECUTE FUNCTION communication_packages_protect_frozen();

-- Asset rows: frozen with their package; the stored hash must be the referenced version's hash.
CREATE OR REPLACE FUNCTION communication_package_assets_guard() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  pkg_status text;
  version_hash text;
BEGIN
  SELECT p."status" INTO pkg_status FROM public."communication_packages" p
    WHERE p."id" = COALESCE(NEW."package_id", OLD."package_id");
  IF pkg_status IN ('READY_FOR_APPLICATION', 'STALE', 'INVALID', 'ARCHIVED') THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Assets of a package that was ready for application are immutable' USING ERRCODE = 'check_violation';
    END IF;
    -- Recording the approval id at the moment of readiness is the only allowed change.
    IF TG_OP = 'INSERT' OR NEW."resume_version_id" IS DISTINCT FROM OLD."resume_version_id"
      OR NEW."communication_version_id" IS DISTINCT FROM OLD."communication_version_id"
      OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
      OR NEW."asset_type" IS DISTINCT FROM OLD."asset_type"
      OR (OLD."approval_id" IS NOT NULL AND NEW."approval_id" IS DISTINCT FROM OLD."approval_id") THEN
      RAISE EXCEPTION 'Assets of a package that was ready for application are immutable' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW."resume_version_id" IS NOT NULL THEN
    SELECT v."content_hash" INTO version_hash FROM public."resume_versions" v WHERE v."id" = NEW."resume_version_id";
  ELSE
    SELECT v."content_hash" INTO version_hash FROM public."communication_versions" v WHERE v."id" = NEW."communication_version_id";
  END IF;
  IF version_hash IS NULL OR version_hash <> NEW."content_hash" THEN
    RAISE EXCEPTION 'Package asset hash does not match the referenced version' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "communication_package_assets_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "communication_package_assets"
  FOR EACH ROW EXECUTE FUNCTION communication_package_assets_guard();

-- --- Row Level Security: owner only (one permissive policy per table) --------
ALTER TABLE "recipient_contexts"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_preferences"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_packages"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_package_assets"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_package_checks"  ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON "recipient_contexts", "communication_preferences" TO jobhunt_app;
-- Packages are archived, never deleted by the app; assets of editable packages can be replaced.
GRANT SELECT, INSERT, UPDATE ON "communication_packages" TO jobhunt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "communication_package_assets" TO jobhunt_app;
GRANT SELECT, INSERT ON "communication_package_checks" TO jobhunt_app;

CREATE POLICY "recipient_contexts_owner" ON "recipient_contexts" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

CREATE POLICY "communication_preferences_owner" ON "communication_preferences" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

CREATE POLICY "communication_packages_owner" ON "communication_packages" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id")
    AND ("match_id" IS NULL OR EXISTS (SELECT 1 FROM "job_matches" m WHERE m."id" = "match_id"))
    AND ("job_research_id" IS NULL OR EXISTS (SELECT 1 FROM "job_research" r WHERE r."id" = "job_research_id"))
    AND ("recipient_context_id" IS NULL OR EXISTS (SELECT 1 FROM "recipient_contexts" rc WHERE rc."id" = "recipient_context_id")));
-- previous_package_id: FK guarantees existence; the service only links the caller's own packages
-- (a self-referencing EXISTS here would recurse through this policy).

CREATE POLICY "communication_package_assets_owner" ON "communication_package_assets" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_packages" p WHERE p."id" = "package_id")
    AND ("resume_version_id" IS NULL OR EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "resume_version_id"))
    AND ("communication_version_id" IS NULL OR EXISTS (SELECT 1 FROM "communication_versions" v WHERE v."id" = "communication_version_id")));

CREATE POLICY "communication_package_checks_owner" ON "communication_package_checks" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_packages" p WHERE p."id" = "package_id"));

-- communications.recipient_context_id must point at the owner's recipient context.
DROP POLICY "communications_owner" ON "communications";
CREATE POLICY "communications_owner" ON "communications" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND ("job_id" IS NULL OR EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"))
    AND ("resume_version_id" IS NULL OR EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "resume_version_id"))
    AND ("signature_preset_id" IS NULL OR EXISTS (SELECT 1 FROM "signature_presets" p WHERE p."id" = "signature_preset_id"))
    AND ("recipient_context_id" IS NULL OR EXISTS (SELECT 1 FROM "recipient_contexts" rc WHERE rc."id" = "recipient_context_id")));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "recipient_contexts", "communication_preferences", "communication_packages", "communication_package_assets", "communication_package_checks" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
