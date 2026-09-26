-- CreateTable
CREATE TABLE "resumes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "template" TEXT NOT NULL DEFAULT 'CLASSIC',
    "page_format" TEXT NOT NULL DEFAULT 'A4',
    "source_resume_id" UUID,
    "target_job_id" UUID,
    "current_version_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resumes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_versions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resume_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "parent_version_id" UUID,
    "version_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "target_job_id" UUID,
    "content" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "content_hash" CHAR(64) NOT NULL,
    "change_summary" JSONB NOT NULL DEFAULT '{}',
    "change_set" JSONB,
    "ai_assisted" BOOLEAN NOT NULL DEFAULT false,
    "generation" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resume_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_fact_references" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "item_id" TEXT NOT NULL,
    "fact_ref" TEXT NOT NULL,
    "fact_kind" TEXT NOT NULL,
    "fact_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_fact_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_checks" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "job_id" UUID,
    "checker_version" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_check_findings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "check_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "recommendation" TEXT,
    "item_id" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "resume_check_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_approvals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,

    CONSTRAINT "resume_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_exports" (
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

    CONSTRAINT "resume_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resumes_current_version_id_key" ON "resumes"("current_version_id");

-- CreateIndex
CREATE INDEX "resumes_user_id_status_updated_at_idx" ON "resumes"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "resumes_source_resume_id_idx" ON "resumes"("source_resume_id");

-- CreateIndex
CREATE INDEX "resumes_target_job_id_idx" ON "resumes"("target_job_id");

-- CreateIndex
CREATE INDEX "resume_versions_user_id_created_at_idx" ON "resume_versions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resume_versions_parent_version_id_idx" ON "resume_versions"("parent_version_id");

-- CreateIndex
CREATE INDEX "resume_versions_target_job_id_idx" ON "resume_versions"("target_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_versions_resume_id_version_number_key" ON "resume_versions"("resume_id", "version_number");

-- CreateIndex
CREATE INDEX "resume_fact_references_user_id_fact_id_idx" ON "resume_fact_references"("user_id", "fact_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_fact_references_version_id_item_id_fact_ref_key" ON "resume_fact_references"("version_id", "item_id", "fact_ref");

-- CreateIndex
CREATE INDEX "resume_checks_version_id_created_at_idx" ON "resume_checks"("version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resume_checks_user_id_idx" ON "resume_checks"("user_id");

-- CreateIndex
CREATE INDEX "resume_checks_job_id_idx" ON "resume_checks"("job_id");

-- CreateIndex
CREATE INDEX "resume_check_findings_check_id_idx" ON "resume_check_findings"("check_id");

-- CreateIndex
CREATE INDEX "resume_check_findings_user_id_idx" ON "resume_check_findings"("user_id");

-- CreateIndex
CREATE INDEX "resume_approvals_version_id_idx" ON "resume_approvals"("version_id");

-- CreateIndex
CREATE INDEX "resume_approvals_user_id_idx" ON "resume_approvals"("user_id");

-- CreateIndex
CREATE INDEX "resume_exports_version_id_created_at_idx" ON "resume_exports"("version_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resume_exports_user_id_idx" ON "resume_exports"("user_id");

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_source_resume_id_fkey" FOREIGN KEY ("source_resume_id") REFERENCES "resumes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_target_job_id_fkey" FOREIGN KEY ("target_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resumes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "resume_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_target_job_id_fkey" FOREIGN KEY ("target_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_fact_references" ADD CONSTRAINT "resume_fact_references_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_fact_references" ADD CONSTRAINT "resume_fact_references_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "resume_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_checks" ADD CONSTRAINT "resume_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_checks" ADD CONSTRAINT "resume_checks_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "resume_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_checks" ADD CONSTRAINT "resume_checks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_check_findings" ADD CONSTRAINT "resume_check_findings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_check_findings" ADD CONSTRAINT "resume_check_findings_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "resume_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_approvals" ADD CONSTRAINT "resume_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_approvals" ADD CONSTRAINT "resume_approvals_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "resume_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_exports" ADD CONSTRAINT "resume_exports_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_exports" ADD CONSTRAINT "resume_exports_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "resume_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written section (not generated by Prisma)
-- ===========================================================================

-- --- Integrity constraints ---------------------------------------------------
ALTER TABLE "resumes" ADD CONSTRAINT "resumes_ck" CHECK (
  "kind" IN ('MASTER', 'TAILORED', 'GENERAL')
  AND "status" IN ('ACTIVE', 'ARCHIVED')
  AND "template" IN ('CLASSIC', 'MODERN', 'TECHNICAL', 'EDITORIAL')
  AND "page_format" IN ('A4', 'LETTER')
  AND char_length("name") BETWEEN 1 AND 120
  AND ("description" IS NULL OR char_length("description") <= 1000)
  AND ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
);
-- One active master resume per user.
CREATE UNIQUE INDEX "resumes_one_master_uq" ON "resumes" ("user_id") WHERE "kind" = 'MASTER' AND "status" = 'ACTIVE';

ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_ck" CHECK (
  "version_type" IN ('MASTER', 'TAILORED', 'MANUAL_EDIT', 'RESTORED', 'DUPLICATE')
  AND "status" IN ('DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED')
  AND "version_number" >= 1
  AND char_length("title") BETWEEN 1 AND 200
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof("content") = 'object'
  AND "schema_version" >= 1
  AND ("parent_version_id" IS NULL OR "parent_version_id" <> "id")
);

ALTER TABLE "resume_fact_references" ADD CONSTRAINT "resume_fact_references_ck" CHECK (
  "fact_ref" = "fact_kind" || ':' || "fact_id"::text
  AND char_length("item_id") BETWEEN 1 AND 64
);

ALTER TABLE "resume_check_findings" ADD CONSTRAINT "resume_check_findings_ck" CHECK (
  "category" IN ('STRUCTURE', 'CONTENT', 'ALIGNMENT', 'READABILITY', 'FORMATTING', 'PROVENANCE')
  AND "severity" IN ('PASS', 'INFO', 'OPPORTUNITY', 'WARNING', 'ISSUE')
  AND char_length("message") BETWEEN 1 AND 1000
  AND ("recommendation" IS NULL OR char_length("recommendation") <= 1000)
);
ALTER TABLE "resume_checks" ADD CONSTRAINT "resume_checks_ck" CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "resume_approvals" ADD CONSTRAINT "resume_approvals_ck" CHECK (
  "content_hash" ~ '^[0-9a-f]{64}$'
  AND ("revoked_at" IS NULL OR "revoke_reason" IS NOT NULL)
);
-- At most one active approval per version (double-clicking Approve is idempotent).
CREATE UNIQUE INDEX "resume_approvals_one_active_uq" ON "resume_approvals" ("version_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "resume_exports" ADD CONSTRAINT "resume_exports_ck" CHECK (
  "format" IN ('PDF', 'DOCX')
  AND "status" IN ('PENDING', 'SUCCEEDED', 'FAILED')
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND ("status" <> 'SUCCEEDED' OR ("storage_path" IS NOT NULL AND "file_name" IS NOT NULL AND "byte_size" > 0 AND "file_sha256" IS NOT NULL))
  AND ("storage_path" IS NULL OR "storage_path" LIKE "user_id"::text || '/resumes/%')
  AND ("error" IS NULL OR char_length("error") <= 1000)
);

-- --- Approved content is immutable (defence in depth below the service layer) ---
CREATE OR REPLACE FUNCTION resume_versions_protect_approved() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'APPROVED' AND (
       NEW."content" IS DISTINCT FROM OLD."content"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."target_job_id" IS DISTINCT FROM OLD."target_job_id"
    OR NEW."resume_id" IS DISTINCT FROM OLD."resume_id"
  ) THEN
    RAISE EXCEPTION 'Approved resume versions are immutable; create a new version instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "resume_versions_protect_approved"
  BEFORE UPDATE ON "resume_versions"
  FOR EACH ROW EXECUTE FUNCTION resume_versions_protect_approved();

-- --- Row Level Security -------------------------------------------------------
ALTER TABLE "resumes"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_versions"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_fact_references" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_checks"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_check_findings"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_approvals"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resume_exports"         ENABLE ROW LEVEL SECURITY;

-- History is never deleted by the app: archive instead (account deletion cascades via the owner).
GRANT SELECT, INSERT, UPDATE ON "resumes", "resume_versions", "resume_checks", "resume_approvals", "resume_exports" TO jobhunt_app;
GRANT SELECT, INSERT, DELETE ON "resume_fact_references", "resume_check_findings" TO jobhunt_app;

CREATE POLICY "resumes_owner" ON "resumes" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND ("target_job_id" IS NULL OR EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "target_job_id")));
-- source_resume_id: the FK guarantees existence; the service only copies from the caller's own
-- resumes (a self-referencing policy subquery would recurse).

CREATE POLICY "resume_versions_owner" ON "resume_versions" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resumes" r WHERE r."id" = "resume_id")
    AND ("target_job_id" IS NULL OR EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "target_job_id")));

CREATE POLICY "resume_fact_references_owner" ON "resume_fact_references" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "resume_checks_owner" ON "resume_checks" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "version_id")
    AND ("job_id" IS NULL OR EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id")));

CREATE POLICY "resume_check_findings_owner" ON "resume_check_findings" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resume_checks" c WHERE c."id" = "check_id"));

CREATE POLICY "resume_approvals_owner" ON "resume_approvals" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "version_id"));

CREATE POLICY "resume_exports_owner" ON "resume_exports" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "resume_versions" v WHERE v."id" = "version_id"));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "resumes", "resume_versions", "resume_fact_references", "resume_checks", "resume_check_findings", "resume_approvals", "resume_exports" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
