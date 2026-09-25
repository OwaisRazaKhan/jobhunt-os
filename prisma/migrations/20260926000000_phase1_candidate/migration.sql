
-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('VERIFIED', 'USER_PROVIDED', 'NEEDS_REVIEW', 'AI_INFERRED');

-- CreateEnum
CREATE TYPE "fact_source_type" AS ENUM ('MANUAL_ENTRY', 'CV_IMPORT', 'DOCUMENT_IMPORT', 'PORTFOLIO_IMPORT', 'USER_APPROVED_AI_EXTRACTION', 'SYSTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "document_status" AS ENUM ('UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "fact_candidate_status" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "extraction_method" AS ENUM ('RULE', 'AI');

-- CreateEnum
CREATE TYPE "work_authorization_status" AS ENUM ('AUTHORIZED', 'NOT_AUTHORIZED', 'SPONSORSHIP_REQUIRED', 'UNKNOWN', 'NEEDS_REVIEW');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "countries" (
    "code" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "is_target_market" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "candidate_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "full_name" TEXT,
    "headline" TEXT,
    "current_city" TEXT,
    "current_country_code" CHAR(2),
    "phone_enc" TEXT,
    "professional_email_enc" TEXT,
    "website_url" TEXT,
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "portfolio_url" TEXT,
    "summary" TEXT,
    "career_goal" TEXT,
    "availability" TEXT,
    "available_from" DATE,
    "notice_period_weeks" INTEGER,
    "years_of_experience" DOUBLE PRECISION,
    "profile_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "onboarding_state" JSONB NOT NULL DEFAULT '{}',
    "onboarding_completed_at" TIMESTAMPTZ(3),
    "source_type" "fact_source_type" NOT NULL DEFAULT 'MANUAL_ENTRY',
    "verification_status" "verification_status" NOT NULL DEFAULT 'USER_PROVIDED',
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_education" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "institution" TEXT NOT NULL,
    "degree" TEXT,
    "field_of_study" TEXT,
    "location" TEXT,
    "start_date" VARCHAR(7),
    "end_date" VARCHAR(7),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_education_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_experiences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "employment_type" TEXT,
    "location" TEXT,
    "start_date" VARCHAR(7),
    "end_date" VARCHAR(7),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills_used" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_projects" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "role" TEXT,
    "project_type" TEXT,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outcomes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "portfolio_url" TEXT,
    "repository_url" TEXT,
    "live_url" TEXT,
    "image_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "start_date" VARCHAR(7),
    "end_date" VARCHAR(7),
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "team_size" INTEGER,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_achievements" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "experience_id" UUID,
    "project_id" UUID,
    "statement" TEXT NOT NULL,
    "metric" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_skills" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_normalized" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "proficiency" INTEGER,
    "years_used" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_certifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "issuer" TEXT,
    "issue_date" VARCHAR(7),
    "expiry_date" VARCHAR(7),
    "credential_id" TEXT,
    "credential_url" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_certifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_portfolio_items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT,
    "description" TEXT,
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "project_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_portfolio_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_languages" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "language" TEXT NOT NULL,
    "language_normalized" TEXT NOT NULL,
    "proficiency" TEXT,
    "reading" TEXT,
    "writing" TEXT,
    "speaking" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_languages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_work_authorizations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "status" "work_authorization_status" NOT NULL,
    "permit_type" TEXT,
    "valid_until" DATE,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verification_status" "verification_status" NOT NULL,
    "source_type" "fact_source_type" NOT NULL,
    "source_document_id" UUID,
    "source_fact_candidate_id" UUID,
    "source_excerpt" TEXT,
    "confidence" DOUBLE PRECISION,
    "verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "candidate_work_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_preferences" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_roles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_industries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "employment_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seniority_levels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "work_modes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company_sizes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relocation" TEXT,
    "needs_sponsorship" TEXT,
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_currency" CHAR(3),
    "salary_period" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_target_locations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "city" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_target_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_documents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_path" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "status" "document_status" NOT NULL DEFAULT 'UPLOADED',
    "extracted_text" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "ai_status" TEXT,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_started_at" TIMESTAMPTZ(3),
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_fact_candidates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "excerpt" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "method" "extraction_method" NOT NULL,
    "proposed_status" "verification_status" NOT NULL,
    "status" "fact_candidate_status" NOT NULL DEFAULT 'PENDING',
    "duplicate_of" JSONB,
    "result_kind" TEXT,
    "result_id" UUID,
    "ai_generation_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "candidate_fact_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "agent" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "input_hash" CHAR(64) NOT NULL,
    "output" JSONB,
    "status" TEXT NOT NULL,
    "error_code" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_profiles_user_id_key" ON "candidate_profiles"("user_id");

-- CreateIndex
CREATE INDEX "candidate_education_user_id_deleted_at_idx" ON "candidate_education"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_experiences_user_id_deleted_at_idx" ON "candidate_experiences"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_projects_user_id_deleted_at_idx" ON "candidate_projects"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_achievements_user_id_deleted_at_idx" ON "candidate_achievements"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_skills_user_id_deleted_at_idx" ON "candidate_skills"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_certifications_user_id_deleted_at_idx" ON "candidate_certifications"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_portfolio_items_user_id_deleted_at_idx" ON "candidate_portfolio_items"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_languages_user_id_deleted_at_idx" ON "candidate_languages"("user_id", "deleted_at");

-- CreateIndex
CREATE INDEX "candidate_work_authorizations_user_id_deleted_at_idx" ON "candidate_work_authorizations"("user_id", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_preferences_user_id_key" ON "candidate_preferences"("user_id");

-- CreateIndex
CREATE INDEX "candidate_target_locations_user_id_idx" ON "candidate_target_locations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidate_documents_storage_path_key" ON "candidate_documents"("storage_path");

-- CreateIndex
CREATE INDEX "candidate_documents_user_id_uploaded_at_idx" ON "candidate_documents"("user_id", "uploaded_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_documents_user_id_sha256_idx" ON "candidate_documents"("user_id", "sha256");

-- CreateIndex
CREATE INDEX "candidate_fact_candidates_user_id_status_idx" ON "candidate_fact_candidates"("user_id", "status");

-- CreateIndex
CREATE INDEX "candidate_fact_candidates_document_id_idx" ON "candidate_fact_candidates"("document_id");

-- CreateIndex
CREATE INDEX "ai_generations_user_id_created_at_idx" ON "ai_generations"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_current_country_code_fkey" FOREIGN KEY ("current_country_code") REFERENCES "countries"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_education" ADD CONSTRAINT "candidate_education_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_experiences" ADD CONSTRAINT "candidate_experiences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_experiences" ADD CONSTRAINT "candidate_experiences_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_projects" ADD CONSTRAINT "candidate_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_projects" ADD CONSTRAINT "candidate_projects_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_achievements" ADD CONSTRAINT "candidate_achievements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_achievements" ADD CONSTRAINT "candidate_achievements_experience_id_fkey" FOREIGN KEY ("experience_id") REFERENCES "candidate_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_achievements" ADD CONSTRAINT "candidate_achievements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "candidate_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_achievements" ADD CONSTRAINT "candidate_achievements_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_skills" ADD CONSTRAINT "candidate_skills_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_portfolio_items" ADD CONSTRAINT "candidate_portfolio_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_portfolio_items" ADD CONSTRAINT "candidate_portfolio_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "candidate_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_portfolio_items" ADD CONSTRAINT "candidate_portfolio_items_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_languages" ADD CONSTRAINT "candidate_languages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_languages" ADD CONSTRAINT "candidate_languages_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_work_authorizations" ADD CONSTRAINT "candidate_work_authorizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_work_authorizations" ADD CONSTRAINT "candidate_work_authorizations_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_work_authorizations" ADD CONSTRAINT "candidate_work_authorizations_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "candidate_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_preferences" ADD CONSTRAINT "candidate_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_target_locations" ADD CONSTRAINT "candidate_target_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_target_locations" ADD CONSTRAINT "candidate_target_locations_country_code_fkey" FOREIGN KEY ("country_code") REFERENCES "countries"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_documents" ADD CONSTRAINT "candidate_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_fact_candidates" ADD CONSTRAINT "candidate_fact_candidates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_fact_candidates" ADD CONSTRAINT "candidate_fact_candidates_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "candidate_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_fact_candidates" ADD CONSTRAINT "candidate_fact_candidates_ai_generation_id_fkey" FOREIGN KEY ("ai_generation_id") REFERENCES "ai_generations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written section (not generated by Prisma)
-- ===========================================================================

-- --- Integrity constraints ---------------------------------------------------

-- A fact can only be VERIFIED if a user verification timestamp exists.
ALTER TABLE "candidate_profiles"            ADD CONSTRAINT "candidate_profiles_verified_ck"            CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_education"           ADD CONSTRAINT "candidate_education_verified_ck"           CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_experiences"         ADD CONSTRAINT "candidate_experiences_verified_ck"         CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_projects"            ADD CONSTRAINT "candidate_projects_verified_ck"            CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_achievements"        ADD CONSTRAINT "candidate_achievements_verified_ck"        CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_skills"              ADD CONSTRAINT "candidate_skills_verified_ck"              CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_certifications"      ADD CONSTRAINT "candidate_certifications_verified_ck"      CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_portfolio_items"     ADD CONSTRAINT "candidate_portfolio_items_verified_ck"     CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_languages"           ADD CONSTRAINT "candidate_languages_verified_ck"           CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);
ALTER TABLE "candidate_work_authorizations" ADD CONSTRAINT "candidate_work_authorizations_verified_ck" CHECK ("verification_status" <> 'VERIFIED' OR "verified_at" IS NOT NULL);

-- Extracted candidates can never be proposed as VERIFIED.
ALTER TABLE "candidate_fact_candidates" ADD CONSTRAINT "candidate_fact_candidates_proposed_ck"
  CHECK ("proposed_status" IN ('NEEDS_REVIEW', 'AI_INFERRED'));
ALTER TABLE "candidate_fact_candidates" ADD CONSTRAINT "candidate_fact_candidates_confidence_ck"
  CHECK ("confidence" >= 0 AND "confidence" <= 1);

-- Date sanity (nulls allowed: dates are never fabricated).
ALTER TABLE "candidate_education"      ADD CONSTRAINT "candidate_education_dates_ck"      CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "candidate_experiences"    ADD CONSTRAINT "candidate_experiences_dates_ck"    CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "candidate_projects"       ADD CONSTRAINT "candidate_projects_dates_ck"       CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date");
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_dates_ck" CHECK ("issue_date" IS NULL OR "expiry_date" IS NULL OR "expiry_date" >= "issue_date");

ALTER TABLE "candidate_skills"       ADD CONSTRAINT "candidate_skills_proficiency_ck"  CHECK ("proficiency" IS NULL OR "proficiency" BETWEEN 1 AND 5);
ALTER TABLE "candidate_achievements" ADD CONSTRAINT "candidate_achievements_parent_ck" CHECK ("experience_id" IS NULL OR "project_id" IS NULL);
ALTER TABLE "candidate_preferences"  ADD CONSTRAINT "candidate_preferences_salary_ck"  CHECK ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_max" >= "salary_min");
ALTER TABLE "candidate_projects"     ADD CONSTRAINT "candidate_projects_team_ck"       CHECK ("team_size" IS NULL OR "team_size" > 0);

-- Uniqueness among live (not soft-deleted) rows.
CREATE UNIQUE INDEX "candidate_skills_user_name_live_uq"       ON "candidate_skills" ("user_id", "name_normalized") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "candidate_languages_user_lang_live_uq"    ON "candidate_languages" ("user_id", "language_normalized") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "candidate_work_auth_user_country_live_uq" ON "candidate_work_authorizations" ("user_id", "country_code") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "candidate_target_locations_uq"            ON "candidate_target_locations" ("user_id", "country_code", COALESCE("city", ''));



-- Partial dates: "YYYY" or "YYYY-MM" (month optional so CV years are never turned into invented months).
ALTER TABLE "candidate_education"      ADD CONSTRAINT "candidate_education_start_fmt_ck"      CHECK ("start_date" IS NULL OR "start_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_education"      ADD CONSTRAINT "candidate_education_end_fmt_ck"        CHECK ("end_date" IS NULL OR "end_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_experiences"    ADD CONSTRAINT "candidate_experiences_start_fmt_ck"    CHECK ("start_date" IS NULL OR "start_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_experiences"    ADD CONSTRAINT "candidate_experiences_end_fmt_ck"      CHECK ("end_date" IS NULL OR "end_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_projects"       ADD CONSTRAINT "candidate_projects_start_fmt_ck"       CHECK ("start_date" IS NULL OR "start_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_projects"       ADD CONSTRAINT "candidate_projects_end_fmt_ck"         CHECK ("end_date" IS NULL OR "end_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_issue_fmt_ck" CHECK ("issue_date" IS NULL OR "issue_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');
ALTER TABLE "candidate_certifications" ADD CONSTRAINT "candidate_certifications_expiry_fmt_ck" CHECK ("expiry_date" IS NULL OR "expiry_date" ~ '^[0-9]{4}(-(0[1-9]|1[0-2]))?$');


-- Reference data: ISO 3166-1 countries. Initial target markets are flagged; more can be enabled as data.
INSERT INTO "countries" ("code", "name", "is_target_market") VALUES
  ('AD', 'Andorra', false),
  ('AE', 'United Arab Emirates', true),
  ('AF', 'Afghanistan', false),
  ('AG', 'Antigua & Barbuda', false),
  ('AI', 'Anguilla', false),
  ('AL', 'Albania', false),
  ('AM', 'Armenia', false),
  ('AO', 'Angola', false),
  ('AQ', 'Antarctica', false),
  ('AR', 'Argentina', false),
  ('AS', 'American Samoa', false),
  ('AT', 'Austria', true),
  ('AU', 'Australia', false),
  ('AW', 'Aruba', false),
  ('AX', 'Åland Islands', false),
  ('AZ', 'Azerbaijan', false),
  ('BA', 'Bosnia & Herzegovina', false),
  ('BB', 'Barbados', false),
  ('BD', 'Bangladesh', false),
  ('BE', 'Belgium', true),
  ('BF', 'Burkina Faso', false),
  ('BG', 'Bulgaria', false),
  ('BH', 'Bahrain', false),
  ('BI', 'Burundi', false),
  ('BJ', 'Benin', false),
  ('BL', 'St. Barthélemy', false),
  ('BM', 'Bermuda', false),
  ('BN', 'Brunei', false),
  ('BO', 'Bolivia', false),
  ('BQ', 'Caribbean Netherlands', false),
  ('BR', 'Brazil', false),
  ('BS', 'Bahamas', false),
  ('BT', 'Bhutan', false),
  ('BV', 'Bouvet Island', false),
  ('BW', 'Botswana', false),
  ('BY', 'Belarus', false),
  ('BZ', 'Belize', false),
  ('CA', 'Canada', true),
  ('CC', 'Cocos (Keeling) Islands', false),
  ('CD', 'Congo - Kinshasa', false),
  ('CF', 'Central African Republic', false),
  ('CG', 'Congo - Brazzaville', false),
  ('CH', 'Switzerland', false),
  ('CI', 'Côte d’Ivoire', false),
  ('CK', 'Cook Islands', false),
  ('CL', 'Chile', false),
  ('CM', 'Cameroon', false),
  ('CN', 'China', false),
  ('CO', 'Colombia', false),
  ('CR', 'Costa Rica', false),
  ('CU', 'Cuba', false),
  ('CV', 'Cape Verde', false),
  ('CW', 'Curaçao', false),
  ('CX', 'Christmas Island', false),
  ('CY', 'Cyprus', false),
  ('CZ', 'Czechia', true),
  ('DE', 'Germany', true),
  ('DJ', 'Djibouti', false),
  ('DK', 'Denmark', true),
  ('DM', 'Dominica', false),
  ('DO', 'Dominican Republic', false),
  ('DZ', 'Algeria', false),
  ('EC', 'Ecuador', false),
  ('EE', 'Estonia', true),
  ('EG', 'Egypt', false),
  ('EH', 'Western Sahara', false),
  ('ER', 'Eritrea', false),
  ('ES', 'Spain', true),
  ('ET', 'Ethiopia', false),
  ('FI', 'Finland', true),
  ('FJ', 'Fiji', false),
  ('FK', 'Falkland Islands', false),
  ('FM', 'Micronesia', false),
  ('FO', 'Faroe Islands', false),
  ('FR', 'France', true),
  ('GA', 'Gabon', false),
  ('GB', 'United Kingdom', false),
  ('GD', 'Grenada', false),
  ('GE', 'Georgia', false),
  ('GF', 'French Guiana', false),
  ('GG', 'Guernsey', false),
  ('GH', 'Ghana', false),
  ('GI', 'Gibraltar', false),
  ('GL', 'Greenland', false),
  ('GM', 'Gambia', false),
  ('GN', 'Guinea', false),
  ('GP', 'Guadeloupe', false),
  ('GQ', 'Equatorial Guinea', false),
  ('GR', 'Greece', false),
  ('GS', 'South Georgia & South Sandwich Islands', false),
  ('GT', 'Guatemala', false),
  ('GU', 'Guam', false),
  ('GW', 'Guinea-Bissau', false),
  ('GY', 'Guyana', false),
  ('HK', 'Hong Kong SAR China', false),
  ('HM', 'Heard & McDonald Islands', false),
  ('HN', 'Honduras', false),
  ('HR', 'Croatia', false),
  ('HT', 'Haiti', false),
  ('HU', 'Hungary', false),
  ('ID', 'Indonesia', false),
  ('IE', 'Ireland', true),
  ('IL', 'Israel', false),
  ('IM', 'Isle of Man', false),
  ('IN', 'India', false),
  ('IO', 'British Indian Ocean Territory', false),
  ('IQ', 'Iraq', false),
  ('IR', 'Iran', false),
  ('IS', 'Iceland', false),
  ('IT', 'Italy', false),
  ('JE', 'Jersey', false),
  ('JM', 'Jamaica', false),
  ('JO', 'Jordan', false),
  ('JP', 'Japan', false),
  ('KE', 'Kenya', false),
  ('KG', 'Kyrgyzstan', false),
  ('KH', 'Cambodia', false),
  ('KI', 'Kiribati', false),
  ('KM', 'Comoros', false),
  ('KN', 'St. Kitts & Nevis', false),
  ('KP', 'North Korea', false),
  ('KR', 'South Korea', false),
  ('KW', 'Kuwait', false),
  ('KY', 'Cayman Islands', false),
  ('KZ', 'Kazakhstan', false),
  ('LA', 'Laos', false),
  ('LB', 'Lebanon', false),
  ('LC', 'St. Lucia', false),
  ('LI', 'Liechtenstein', false),
  ('LK', 'Sri Lanka', false),
  ('LR', 'Liberia', false),
  ('LS', 'Lesotho', false),
  ('LT', 'Lithuania', false),
  ('LU', 'Luxembourg', false),
  ('LV', 'Latvia', false),
  ('LY', 'Libya', false),
  ('MA', 'Morocco', false),
  ('MC', 'Monaco', false),
  ('MD', 'Moldova', false),
  ('ME', 'Montenegro', false),
  ('MF', 'St. Martin', false),
  ('MG', 'Madagascar', false),
  ('MH', 'Marshall Islands', false),
  ('MK', 'North Macedonia', false),
  ('ML', 'Mali', false),
  ('MM', 'Myanmar (Burma)', false),
  ('MN', 'Mongolia', false),
  ('MO', 'Macao SAR China', false),
  ('MP', 'Northern Mariana Islands', false),
  ('MQ', 'Martinique', false),
  ('MR', 'Mauritania', false),
  ('MS', 'Montserrat', false),
  ('MT', 'Malta', false),
  ('MU', 'Mauritius', false),
  ('MV', 'Maldives', false),
  ('MW', 'Malawi', false),
  ('MX', 'Mexico', false),
  ('MY', 'Malaysia', false),
  ('MZ', 'Mozambique', false),
  ('NA', 'Namibia', false),
  ('NC', 'New Caledonia', false),
  ('NE', 'Niger', false),
  ('NF', 'Norfolk Island', false),
  ('NG', 'Nigeria', false),
  ('NI', 'Nicaragua', false),
  ('NL', 'Netherlands', true),
  ('NO', 'Norway', false),
  ('NP', 'Nepal', false),
  ('NR', 'Nauru', false),
  ('NU', 'Niue', false),
  ('NZ', 'New Zealand', false),
  ('OM', 'Oman', false),
  ('PA', 'Panama', false),
  ('PE', 'Peru', false),
  ('PF', 'French Polynesia', false),
  ('PG', 'Papua New Guinea', false),
  ('PH', 'Philippines', false),
  ('PK', 'Pakistan', false),
  ('PL', 'Poland', true),
  ('PM', 'St. Pierre & Miquelon', false),
  ('PN', 'Pitcairn Islands', false),
  ('PR', 'Puerto Rico', false),
  ('PS', 'Palestinian Territories', false),
  ('PT', 'Portugal', true),
  ('PW', 'Palau', false),
  ('PY', 'Paraguay', false),
  ('QA', 'Qatar', true),
  ('RE', 'Réunion', false),
  ('RO', 'Romania', false),
  ('RS', 'Serbia', false),
  ('RU', 'Russia', false),
  ('RW', 'Rwanda', false),
  ('SA', 'Saudi Arabia', true),
  ('SB', 'Solomon Islands', false),
  ('SC', 'Seychelles', false),
  ('SD', 'Sudan', false),
  ('SE', 'Sweden', true),
  ('SG', 'Singapore', false),
  ('SH', 'St. Helena', false),
  ('SI', 'Slovenia', false),
  ('SJ', 'Svalbard & Jan Mayen', false),
  ('SK', 'Slovakia', false),
  ('SL', 'Sierra Leone', false),
  ('SM', 'San Marino', false),
  ('SN', 'Senegal', false),
  ('SO', 'Somalia', false),
  ('SR', 'Suriname', false),
  ('SS', 'South Sudan', false),
  ('ST', 'São Tomé & Príncipe', false),
  ('SV', 'El Salvador', false),
  ('SX', 'Sint Maarten', false),
  ('SY', 'Syria', false),
  ('SZ', 'Eswatini', false),
  ('TC', 'Turks & Caicos Islands', false),
  ('TD', 'Chad', false),
  ('TF', 'French Southern Territories', false),
  ('TG', 'Togo', false),
  ('TH', 'Thailand', false),
  ('TJ', 'Tajikistan', false),
  ('TK', 'Tokelau', false),
  ('TL', 'Timor-Leste', false),
  ('TM', 'Turkmenistan', false),
  ('TN', 'Tunisia', false),
  ('TO', 'Tonga', false),
  ('TR', 'Türkiye', false),
  ('TT', 'Trinidad & Tobago', false),
  ('TV', 'Tuvalu', false),
  ('TW', 'Taiwan', false),
  ('TZ', 'Tanzania', false),
  ('UA', 'Ukraine', false),
  ('UG', 'Uganda', false),
  ('UM', 'U.S. Outlying Islands', false),
  ('US', 'United States', true),
  ('UY', 'Uruguay', false),
  ('UZ', 'Uzbekistan', false),
  ('VA', 'Vatican City', false),
  ('VC', 'St. Vincent & Grenadines', false),
  ('VE', 'Venezuela', false),
  ('VG', 'British Virgin Islands', false),
  ('VI', 'U.S. Virgin Islands', false),
  ('VN', 'Vietnam', false),
  ('VU', 'Vanuatu', false),
  ('WF', 'Wallis & Futuna', false),
  ('WS', 'Samoa', false),
  ('YE', 'Yemen', false),
  ('YT', 'Mayotte', false),
  ('ZA', 'South Africa', false),
  ('ZM', 'Zambia', false),
  ('ZW', 'Zimbabwe', false)
ON CONFLICT ("code") DO NOTHING;

-- --- Row Level Security -------------------------------------------------------
--
-- Model:
--   * Tables are owned by the migration role (postgres). The owner bypasses RLS
--     and is used only by Better Auth, migrations and privileged maintenance
--     (account deletion).
--   * All candidate data access runs inside src/server/db.ts withUserContext(),
--     which runs SET LOCAL ROLE jobhunt_app and sets app.current_user_id for the
--     transaction. jobhunt_app has no BYPASSRLS, so these policies apply.
--   * The Supabase Data API roles (anon, authenticated) get no privileges on
--     these tables, and RLS with no matching policy denies them regardless.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'jobhunt_app') THEN
    CREATE ROLE jobhunt_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

-- Allow the connecting (owner) role to switch into jobhunt_app per transaction.
GRANT jobhunt_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public TO jobhunt_app;

CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid $$;
REVOKE ALL ON FUNCTION app_current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO jobhunt_app;

-- Enable RLS everywhere (including auth and reference tables).
ALTER TABLE "users"                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts"                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "verifications"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "countries"                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_profiles"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_education"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_experiences"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_projects"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_achievements"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_skills"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_certifications"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_portfolio_items"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_languages"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_work_authorizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_preferences"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_target_locations"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_documents"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "candidate_fact_candidates"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_generations"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs"                    ENABLE ROW LEVEL SECURITY;

-- Own user row: read-only for the app role.
GRANT SELECT ON "users" TO jobhunt_app;
CREATE POLICY "users_self_select" ON "users" FOR SELECT TO jobhunt_app USING ("id" = app_current_user_id());

-- Reference data: readable by the app role.
GRANT SELECT ON "countries" TO jobhunt_app;
CREATE POLICY "countries_read" ON "countries" FOR SELECT TO jobhunt_app USING (true);

-- User-owned tables: full CRUD on own rows only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'candidate_profiles', 'candidate_education', 'candidate_experiences', 'candidate_projects',
    'candidate_achievements', 'candidate_skills', 'candidate_certifications', 'candidate_portfolio_items',
    'candidate_languages', 'candidate_work_authorizations', 'candidate_preferences',
    'candidate_target_locations', 'candidate_documents', 'candidate_fact_candidates', 'ai_generations'
  ]
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO jobhunt_app', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO jobhunt_app USING ("user_id" = app_current_user_id()) WITH CHECK ("user_id" = app_current_user_id())',
      t || '_owner', t
    );
  END LOOP;
END
$$;

-- Audit log: append-only for the app role (no UPDATE / DELETE grants or policies).
GRANT SELECT, INSERT ON "audit_logs" TO jobhunt_app;
CREATE POLICY "audit_logs_owner_select" ON "audit_logs" FOR SELECT TO jobhunt_app USING ("user_id" = app_current_user_id());
CREATE POLICY "audit_logs_owner_insert" ON "audit_logs" FOR INSERT TO jobhunt_app WITH CHECK ("user_id" = app_current_user_id());

-- Supabase Data API roles: no direct access to any of these tables.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON FUNCTION app_current_user_id() FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END
$$;
