-- CreateTable
CREATE TABLE "communications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "communication_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "job_id" UUID,
    "company_id" UUID,
    "resume_version_id" UUID,
    "recipient_type" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "recipient_name" TEXT,
    "recipient_title" TEXT,
    "recipient_company" TEXT,
    "recipient_email" TEXT,
    "recipient_source" TEXT,
    "recipient_verification" TEXT NOT NULL DEFAULT 'USER_PROVIDED',
    "tone" TEXT NOT NULL DEFAULT 'NATURAL',
    "length" TEXT NOT NULL DEFAULT 'STANDARD',
    "template" TEXT NOT NULL DEFAULT 'CLASSIC',
    "page_format" TEXT NOT NULL DEFAULT 'A4',
    "signature_preset_id" UUID,
    "user_context" TEXT,
    "current_version_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_versions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "communication_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "parent_version_id" UUID,
    "version_type" TEXT NOT NULL,
    "content_source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "content" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "plain_text" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "resume_version_id" UUID,
    "requirement_set_id" UUID,
    "job_research_id" UUID,
    "match_id" UUID,
    "context_hash" CHAR(64),
    "generation" JSONB NOT NULL DEFAULT '{}',
    "change_summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "communication_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_claims" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "location" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "claim_kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_claim_sources" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "source_kind" TEXT NOT NULL,
    "fact_ref" TEXT,
    "research_claim_id" UUID,

    CONSTRAINT "communication_claim_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_checks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "checker_version" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_check_findings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recommendation" TEXT,
    "location" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "communication_check_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_approvals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "validation_state" JSONB NOT NULL DEFAULT '{}',
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,

    CONSTRAINT "communication_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_exports" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "template" TEXT NOT NULL,
    "page_format" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "matches_approval" BOOLEAN NOT NULL DEFAULT false,
    "storage_path" TEXT,
    "file_name" TEXT,
    "byte_size" INTEGER,
    "file_sha256" CHAR(64),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "communication_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signature_presets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '{}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "signature_presets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "communications_current_version_id_key" ON "communications"("current_version_id");

-- CreateIndex
CREATE INDEX "communications_user_id_status_updated_at_idx" ON "communications"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "communications_job_id_idx" ON "communications"("job_id");

-- CreateIndex
CREATE INDEX "communications_company_id_idx" ON "communications"("company_id");

-- CreateIndex
CREATE INDEX "communications_resume_version_id_idx" ON "communications"("resume_version_id");

-- CreateIndex
CREATE INDEX "communications_signature_preset_id_idx" ON "communications"("signature_preset_id");

-- CreateIndex
CREATE INDEX "communication_versions_user_id_created_at_idx" ON "communication_versions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_versions_parent_version_id_idx" ON "communication_versions"("parent_version_id");

-- CreateIndex
CREATE INDEX "communication_versions_resume_version_id_idx" ON "communication_versions"("resume_version_id");

-- CreateIndex
CREATE INDEX "communication_versions_requirement_set_id_idx" ON "communication_versions"("requirement_set_id");

-- CreateIndex
CREATE INDEX "communication_versions_job_research_id_idx" ON "communication_versions"("job_research_id");

-- CreateIndex
CREATE INDEX "communication_versions_match_id_idx" ON "communication_versions"("match_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_versions_communication_id_version_number_key" ON "communication_versions"("communication_id", "version_number");

-- CreateIndex
CREATE INDEX "communication_claims_version_id_idx" ON "communication_claims"("version_id");

-- CreateIndex
CREATE INDEX "communication_claims_user_id_idx" ON "communication_claims"("user_id");

-- CreateIndex
CREATE INDEX "communication_claim_sources_claim_id_idx" ON "communication_claim_sources"("claim_id");

-- CreateIndex
CREATE INDEX "communication_claim_sources_user_id_idx" ON "communication_claim_sources"("user_id");

-- CreateIndex
CREATE INDEX "communication_claim_sources_research_claim_id_idx" ON "communication_claim_sources"("research_claim_id");

-- CreateIndex
CREATE INDEX "communication_checks_version_id_created_at_idx" ON "communication_checks"("version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_checks_user_id_idx" ON "communication_checks"("user_id");

-- CreateIndex
CREATE INDEX "communication_check_findings_check_id_idx" ON "communication_check_findings"("check_id");

-- CreateIndex
CREATE INDEX "communication_check_findings_user_id_idx" ON "communication_check_findings"("user_id");

-- CreateIndex
CREATE INDEX "communication_approvals_version_id_idx" ON "communication_approvals"("version_id");

-- CreateIndex
CREATE INDEX "communication_approvals_user_id_idx" ON "communication_approvals"("user_id");

-- CreateIndex
CREATE INDEX "communication_exports_version_id_created_at_idx" ON "communication_exports"("version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "communication_exports_user_id_idx" ON "communication_exports"("user_id");

-- CreateIndex
CREATE INDEX "signature_presets_user_id_idx" ON "signature_presets"("user_id");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_signature_preset_id_fkey" FOREIGN KEY ("signature_preset_id") REFERENCES "signature_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "communication_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_communication_id_fkey" FOREIGN KEY ("communication_id") REFERENCES "communications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "communication_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_resume_version_id_fkey" FOREIGN KEY ("resume_version_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_requirement_set_id_fkey" FOREIGN KEY ("requirement_set_id") REFERENCES "job_requirement_sets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_job_research_id_fkey" FOREIGN KEY ("job_research_id") REFERENCES "job_research"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "job_matches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_claims" ADD CONSTRAINT "communication_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_claims" ADD CONSTRAINT "communication_claims_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_claim_sources" ADD CONSTRAINT "communication_claim_sources_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_claim_sources" ADD CONSTRAINT "communication_claim_sources_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "communication_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_claim_sources" ADD CONSTRAINT "communication_claim_sources_research_claim_id_fkey" FOREIGN KEY ("research_claim_id") REFERENCES "research_claims"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_checks" ADD CONSTRAINT "communication_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_checks" ADD CONSTRAINT "communication_checks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_check_findings" ADD CONSTRAINT "communication_check_findings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_check_findings" ADD CONSTRAINT "communication_check_findings_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "communication_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_approvals" ADD CONSTRAINT "communication_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_approvals" ADD CONSTRAINT "communication_approvals_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_exports" ADD CONSTRAINT "communication_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_exports" ADD CONSTRAINT "communication_exports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "communication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_presets" ADD CONSTRAINT "signature_presets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written section (not generated by Prisma)
-- ===========================================================================

-- --- Integrity constraints ---------------------------------------------------
ALTER TABLE "communications" ADD CONSTRAINT "communications_ck" CHECK (
  "kind" IN ('EMAIL', 'COVER_LETTER')
  AND "communication_type" IN ('APPLICATION_EMAIL', 'RECRUITER_OUTREACH', 'HIRING_MANAGER_OUTREACH', 'GENERAL_HR_OUTREACH', 'NETWORKING_INTRODUCTION', 'PORTFOLIO_INTRODUCTION', 'CUSTOM_EMAIL', 'COVER_LETTER')
  AND (("kind" = 'COVER_LETTER') = ("communication_type" = 'COVER_LETTER'))
  AND "status" IN ('ACTIVE', 'ARCHIVED')
  AND ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
  AND "recipient_type" IN ('RECRUITER', 'HIRING_MANAGER', 'HR', 'TEAM_MEMBER', 'GENERAL_COMPANY', 'UNKNOWN', 'CUSTOM')
  AND "recipient_verification" IN ('USER_PROVIDED', 'UNVERIFIED')
  AND "tone" IN ('NATURAL', 'PROFESSIONAL', 'WARM', 'DIRECT', 'CONFIDENT', 'CONCISE', 'FORMAL')
  AND "length" IN ('SHORT', 'STANDARD', 'DETAILED')
  AND "page_format" IN ('A4', 'LETTER')
  AND char_length("title") BETWEEN 1 AND 200
  AND ("recipient_name" IS NULL OR char_length("recipient_name") <= 200)
  AND ("recipient_title" IS NULL OR char_length("recipient_title") <= 200)
  AND ("recipient_company" IS NULL OR char_length("recipient_company") <= 200)
  AND ("recipient_email" IS NULL OR ("recipient_email" ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' AND char_length("recipient_email") <= 254))
  AND ("recipient_source" IS NULL OR char_length("recipient_source") <= 500)
  AND ("user_context" IS NULL OR char_length("user_context") <= 2000)
);

ALTER TABLE "communication_versions" ADD CONSTRAINT "communication_versions_ck" CHECK (
  "version_type" IN ('GENERATED', 'AI_ASSISTED', 'MANUAL_EDIT', 'RESTORED', 'DUPLICATED', 'IMPORTED')
  AND "content_source" IN ('AI_GENERATED', 'AI_ASSISTED', 'USER_AUTHORED', 'IMPORTED', 'RESTORED')
  AND "status" IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')
  AND "version_number" >= 1
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND ("context_hash" IS NULL OR "context_hash" ~ '^[0-9a-f]{64}$')
  AND jsonb_typeof("content") = 'object'
  AND "schema_version" >= 1
  AND char_length("plain_text") <= 60000
  AND ("parent_version_id" IS NULL OR "parent_version_id" <> "id")
);

ALTER TABLE "communication_claims" ADD CONSTRAINT "communication_claims_ck" CHECK (
  "claim_kind" IN ('CANDIDATE', 'COMPANY', 'USER_CONTEXT')
  AND "status" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'UNKNOWN')
  AND char_length("text") BETWEEN 1 AND 2000
  AND char_length("location") BETWEEN 1 AND 40
);
ALTER TABLE "communication_claim_sources" ADD CONSTRAINT "communication_claim_sources_ck" CHECK (
  ("source_kind" = 'CANDIDATE_FACT' AND "fact_ref" ~ '^[a-z]+:[0-9a-f-]{36}$')
  OR ("source_kind" = 'RESEARCH_CLAIM')
  OR ("source_kind" = 'USER_CONTEXT' AND "fact_ref" IS NULL AND "research_claim_id" IS NULL)
);

ALTER TABLE "communication_checks" ADD CONSTRAINT "communication_checks_ck" CHECK ("content_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "communication_check_findings" ADD CONSTRAINT "communication_check_findings_ck" CHECK (
  "category" IN ('ACCURACY', 'RELEVANCE', 'WRITING', 'COMPLETENESS', 'LENGTH', 'CONSISTENCY', 'PERSONALIZATION')
  AND "severity" IN ('PASS', 'INFO', 'WARNING', 'CRITICAL')
  AND char_length("message") BETWEEN 1 AND 1000
  AND ("recommendation" IS NULL OR char_length("recommendation") <= 1000)
);

ALTER TABLE "communication_approvals" ADD CONSTRAINT "communication_approvals_ck" CHECK (
  "content_hash" ~ '^[0-9a-f]{64}$' AND ("revoked_at" IS NULL OR "revoke_reason" IS NOT NULL)
);
-- At most one active approval per version (double-clicking Approve is idempotent).
CREATE UNIQUE INDEX "communication_approvals_one_active_uq" ON "communication_approvals" ("version_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "communication_exports" ADD CONSTRAINT "communication_exports_ck" CHECK (
  "format" IN ('PDF', 'DOCX', 'TXT')
  AND "status" IN ('PENDING', 'SUCCEEDED', 'FAILED')
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND ("status" <> 'SUCCEEDED' OR ("storage_path" IS NOT NULL AND "file_name" IS NOT NULL AND "byte_size" > 0 AND "file_sha256" IS NOT NULL))
  AND ("storage_path" IS NULL OR "storage_path" LIKE "user_id"::text || '/communications/%')
  AND ("error" IS NULL OR char_length("error") <= 1000)
);

ALTER TABLE "signature_presets" ADD CONSTRAINT "signature_presets_ck" CHECK (char_length("name") BETWEEN 1 AND 80 AND jsonb_typeof("fields") = 'object');
-- One default signature per user.
CREATE UNIQUE INDEX "signature_presets_one_default_uq" ON "signature_presets" ("user_id") WHERE "is_default";

-- --- Approved content is immutable (defence in depth below the service layer) ---
CREATE OR REPLACE FUNCTION communication_versions_protect_approved() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD."status" = 'APPROVED' AND (
       NEW."content" IS DISTINCT FROM OLD."content"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."plain_text" IS DISTINCT FROM OLD."plain_text"
    OR NEW."communication_id" IS DISTINCT FROM OLD."communication_id"
    OR NEW."resume_version_id" IS DISTINCT FROM OLD."resume_version_id"
    OR NEW."requirement_set_id" IS DISTINCT FROM OLD."requirement_set_id"
    OR NEW."job_research_id" IS DISTINCT FROM OLD."job_research_id"
    OR NEW."match_id" IS DISTINCT FROM OLD."match_id"
  ) THEN
    RAISE EXCEPTION 'Approved communication versions are immutable; create a new version instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "communication_versions_protect_approved"
  BEFORE UPDATE ON "communication_versions"
  FOR EACH ROW EXECUTE FUNCTION communication_versions_protect_approved();

-- --- Row Level Security: owner only (one permissive policy per table) --------
ALTER TABLE "communications"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_versions"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_claims"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_claim_sources"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_checks"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_check_findings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_approvals"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "communication_exports"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signature_presets"            ENABLE ROW LEVEL SECURITY;

-- History is archived, never deleted by the app (account deletion cascades via the owner).
GRANT SELECT, INSERT, UPDATE ON "communications", "communication_versions", "communication_checks", "communication_approvals", "communication_exports" TO jobhunt_app;
-- Claims/sources/findings are replaced when a draft is re-validated.
GRANT SELECT, INSERT, DELETE ON "communication_claims", "communication_claim_sources", "communication_check_findings" TO jobhunt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "signature_presets" TO jobhunt_app;

CREATE POLICY "communications_owner" ON "communications" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND ("job_id" IS NULL OR EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id"))
    AND ("resume_version_id" IS NULL OR EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "resume_version_id"))
    AND ("signature_preset_id" IS NULL OR EXISTS (SELECT 1 FROM "signature_presets" p WHERE p."id" = "signature_preset_id")));

CREATE POLICY "communication_versions_owner" ON "communication_versions" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communications" c WHERE c."id" = "communication_id")
    AND ("resume_version_id" IS NULL OR EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "resume_version_id"))
    AND ("job_research_id" IS NULL OR EXISTS (SELECT 1 FROM "job_research" r WHERE r."id" = "job_research_id"))
    AND ("match_id" IS NULL OR EXISTS (SELECT 1 FROM "job_matches" m WHERE m."id" = "match_id"))
    AND ("requirement_set_id" IS NULL OR EXISTS (SELECT 1 FROM "job_requirement_sets" s WHERE s."id" = "requirement_set_id")));

CREATE POLICY "communication_claims_owner" ON "communication_claims" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "communication_claim_sources_owner" ON "communication_claim_sources" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_claims" c WHERE c."id" = "claim_id")
    AND ("research_claim_id" IS NULL OR EXISTS (SELECT 1 FROM "research_claims" r WHERE r."id" = "research_claim_id")));

CREATE POLICY "communication_checks_owner" ON "communication_checks" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "communication_check_findings_owner" ON "communication_check_findings" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_checks" c WHERE c."id" = "check_id"));

CREATE POLICY "communication_approvals_owner" ON "communication_approvals" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "communication_exports_owner" ON "communication_exports" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "communication_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "signature_presets_owner" ON "signature_presets" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "communications", "communication_versions", "communication_claims", "communication_claim_sources", "communication_checks", "communication_check_findings", "communication_approvals", "communication_exports", "signature_presets" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
