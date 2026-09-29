
-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "company_id" UUID,
    "communication_package_id" UUID NOT NULL,
    "channel_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "automation_mode" TEXT NOT NULL DEFAULT 'HUMAN_APPROVAL',
    "readiness" TEXT NOT NULL DEFAULT 'NOT_READY',
    "current_attempt" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "package_integrity_hash" CHAR(64) NOT NULL,
    "prepared_at" TIMESTAMPTZ(3),
    "application_hash" CHAR(64),
    "application_url" TEXT,
    "job_url" TEXT,
    "deadline_at" TIMESTAMPTZ(3),
    "submitted_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "confirmation_source" TEXT,
    "external_application_id" TEXT,
    "confirmation_url" TEXT,
    "blocked_reason" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_channels" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "channel_type" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'NONE',
    "url" TEXT,
    "email" TEXT,
    "source" TEXT NOT NULL,
    "source_url" TEXT,
    "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "confidence" TEXT NOT NULL DEFAULT 'MEDIUM',
    "evidence_excerpt" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "discovered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_attempts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "execution_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "mode" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "adapter_version" TEXT NOT NULL,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "error_message" TEXT,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_forms" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "channel_id" UUID,
    "url" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "adapter" TEXT NOT NULL,
    "adapter_version" TEXT NOT NULL,
    "form_fingerprint" CHAR(64) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "field_map_version" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'CURRENT',
    "discovered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_fields" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "external_field_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "field_type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "max_length" INTEGER,
    "page_url" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "classification" TEXT NOT NULL DEFAULT 'OTHER',
    "field_fingerprint" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_field_mappings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "mapping_type" TEXT NOT NULL,
    "source_ref" TEXT,
    "value" JSONB,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "policy" TEXT NOT NULL DEFAULT 'REQUIRE_REVIEW',
    "status" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "explanation" TEXT,
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_questions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "field_id" UUID,
    "question_text" TEXT NOT NULL,
    "answer_type" TEXT NOT NULL DEFAULT 'OTHER',
    "classification" TEXT NOT NULL DEFAULT 'OTHER',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "max_length" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'FORM',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_answers" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "answer_text" TEXT NOT NULL,
    "content_hash" CHAR(64) NOT NULL,
    "content_source" TEXT NOT NULL,
    "supporting_fact_refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supporting_research_claim_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" JSONB NOT NULL DEFAULT '[]',
    "validation_status" TEXT NOT NULL DEFAULT 'NOT_VALIDATED',
    "approval_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "approved_at" TIMESTAMPTZ(3),
    "generation" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_approvals" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "application_hash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "approved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" TEXT,

    CONSTRAINT "application_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_submissions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "attempt_id" UUID,
    "channel_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "application_hash" CHAR(64) NOT NULL,
    "submission_fingerprint" CHAR(64) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),
    "external_application_id" TEXT,
    "confirmation_url" TEXT,
    "confirmation_text" TEXT,
    "confirmation_source" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_evidence" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "submission_id" UUID,
    "attempt_id" UUID,
    "evidence_type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "storage_path" TEXT,
    "text_excerpt" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "application_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "attempt_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "applications_channel_id_key" ON "applications"("channel_id");

-- CreateIndex
CREATE INDEX "applications_user_id_status_updated_at_idx" ON "applications"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "applications_candidate_id_idx" ON "applications"("candidate_id");

-- CreateIndex
CREATE INDEX "applications_job_id_idx" ON "applications"("job_id");

-- CreateIndex
CREATE INDEX "applications_company_id_idx" ON "applications"("company_id");

-- CreateIndex
CREATE INDEX "applications_communication_package_id_idx" ON "applications"("communication_package_id");

-- CreateIndex
CREATE INDEX "application_channels_application_id_idx" ON "application_channels"("application_id");

-- CreateIndex
CREATE INDEX "application_channels_user_id_idx" ON "application_channels"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_attempts_execution_id_key" ON "application_attempts"("execution_id");

-- CreateIndex
CREATE INDEX "application_attempts_user_id_idx" ON "application_attempts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_attempts_application_id_attempt_number_key" ON "application_attempts"("application_id", "attempt_number");

-- CreateIndex
CREATE INDEX "application_forms_application_id_discovered_at_idx" ON "application_forms"("application_id", "discovered_at" DESC);

-- CreateIndex
CREATE INDEX "application_forms_channel_id_idx" ON "application_forms"("channel_id");

-- CreateIndex
CREATE INDEX "application_forms_user_id_idx" ON "application_forms"("user_id");

-- CreateIndex
CREATE INDEX "application_fields_user_id_idx" ON "application_fields"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_fields_form_id_external_field_id_key" ON "application_fields"("form_id", "external_field_id");

-- CreateIndex
CREATE INDEX "application_field_mappings_user_id_idx" ON "application_field_mappings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_field_mappings_field_id_version_key" ON "application_field_mappings"("field_id", "version");

-- CreateIndex
CREATE INDEX "application_questions_application_id_idx" ON "application_questions"("application_id");

-- CreateIndex
CREATE INDEX "application_questions_field_id_idx" ON "application_questions"("field_id");

-- CreateIndex
CREATE INDEX "application_questions_user_id_idx" ON "application_questions"("user_id");

-- CreateIndex
CREATE INDEX "application_answers_user_id_idx" ON "application_answers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "application_answers_question_id_version_number_key" ON "application_answers"("question_id", "version_number");

-- CreateIndex
CREATE INDEX "application_approvals_application_id_idx" ON "application_approvals"("application_id");

-- CreateIndex
CREATE INDEX "application_approvals_user_id_idx" ON "application_approvals"("user_id");

-- CreateIndex
CREATE INDEX "application_submissions_application_id_started_at_idx" ON "application_submissions"("application_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "application_submissions_attempt_id_idx" ON "application_submissions"("attempt_id");

-- CreateIndex
CREATE INDEX "application_submissions_user_id_idx" ON "application_submissions"("user_id");

-- CreateIndex
CREATE INDEX "application_evidence_application_id_idx" ON "application_evidence"("application_id");

-- CreateIndex
CREATE INDEX "application_evidence_submission_id_idx" ON "application_evidence"("submission_id");

-- CreateIndex
CREATE INDEX "application_evidence_attempt_id_idx" ON "application_evidence"("attempt_id");

-- CreateIndex
CREATE INDEX "application_evidence_user_id_idx" ON "application_evidence"("user_id");

-- CreateIndex
CREATE INDEX "application_events_application_id_created_at_idx" ON "application_events"("application_id", "created_at");

-- CreateIndex
CREATE INDEX "application_events_attempt_id_idx" ON "application_events"("attempt_id");

-- CreateIndex
CREATE INDEX "application_events_user_id_idx" ON "application_events"("user_id");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "candidate_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_communication_package_id_fkey" FOREIGN KEY ("communication_package_id") REFERENCES "communication_packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "application_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_channels" ADD CONSTRAINT "application_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_channels" ADD CONSTRAINT "application_channels_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_attempts" ADD CONSTRAINT "application_attempts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_attempts" ADD CONSTRAINT "application_attempts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_forms" ADD CONSTRAINT "application_forms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_forms" ADD CONSTRAINT "application_forms_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_forms" ADD CONSTRAINT "application_forms_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "application_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_fields" ADD CONSTRAINT "application_fields_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_fields" ADD CONSTRAINT "application_fields_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "application_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_field_mappings" ADD CONSTRAINT "application_field_mappings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_field_mappings" ADD CONSTRAINT "application_field_mappings_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "application_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "application_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "application_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_approvals" ADD CONSTRAINT "application_approvals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_approvals" ADD CONSTRAINT "application_approvals_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "application_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "application_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "application_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "application_attempts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: integrity, state machine, immutability, RLS, grants
-- ===========================================================================

-- --- Integrity constraints ---------------------------------------------------
ALTER TABLE "applications" ADD CONSTRAINT "applications_ck" CHECK (
  "status" IN ('DRAFT', 'READY', 'IN_PROGRESS', 'NEEDS_HUMAN_INPUT', 'READY_TO_SUBMIT', 'SUBMITTING', 'SUBMITTED',
               'SUBMISSION_CONFIRMED', 'SUBMISSION_UNCERTAIN', 'FAILED', 'BLOCKED', 'CANCELLED', 'WITHDRAWN', 'ARCHIVED')
  AND "automation_mode" IN ('MANUAL_ONLY', 'HUMAN_APPROVAL', 'AUTO_FILL_REVIEW_SUBMIT')
  AND "readiness" IN ('NOT_READY', 'READY', 'NEEDS_USER_INPUT', 'BLOCKED', 'STALE')
  AND "current_attempt" >= 0
  AND "package_integrity_hash" ~ '^[0-9a-f]{64}$'
  AND ("application_hash" IS NULL OR "application_hash" ~ '^[0-9a-f]{64}$')
  AND jsonb_typeof("snapshot") = 'object'
  AND ("confirmation_source" IS NULL OR "confirmation_source" IN ('CONFIRMATION_PAGE', 'CONFIRMATION_ID', 'SUCCESS_MESSAGE', 'EXTERNAL_APPLICATION_ID', 'HTTP_API_SUCCESS', 'USER_CONFIRMED'))
  -- Never a fake submission: submitted/confirmed states need a submission time and recorded evidence.
  AND ("status" NOT IN ('SUBMITTED', 'SUBMISSION_CONFIRMED') OR ("submitted_at" IS NOT NULL AND "confirmation_source" IS NOT NULL))
  AND ("status" <> 'SUBMISSION_CONFIRMED' OR "confirmed_at" IS NOT NULL)
  AND ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
  AND ("status" <> 'BLOCKED' OR "blocked_reason" IS NOT NULL)
  AND ("application_url" IS NULL OR ("application_url" ~ '^https?://' AND char_length("application_url") <= 2048))
  AND ("job_url" IS NULL OR char_length("job_url") <= 2048)
  AND ("confirmation_url" IS NULL OR ("confirmation_url" ~ '^https?://' AND char_length("confirmation_url") <= 2048))
  AND ("external_application_id" IS NULL OR char_length("external_application_id") BETWEEN 1 AND 200)
  AND ("blocked_reason" IS NULL OR char_length("blocked_reason") <= 1000)
);
-- One active application per candidate and job (a retry is a new attempt, not a new application).
CREATE UNIQUE INDEX "applications_one_active_per_job_uq" ON "applications" ("user_id", "job_id")
  WHERE "status" NOT IN ('CANCELLED', 'WITHDRAWN', 'ARCHIVED');

ALTER TABLE "application_channels" ADD CONSTRAINT "application_channels_ck" CHECK (
  "channel_type" IN ('ATS', 'CAREERS_PAGE', 'APPLICATION_FORM', 'EMAIL_APPLICATION', 'EXTERNAL_PORTAL', 'MANUAL_APPLICATION', 'UNKNOWN')
  AND "provider" IN ('GREENHOUSE', 'LEVER', 'ASHBY', 'OTHER', 'NONE')
  AND "source" IN ('JOB_RECORD', 'JOB_POST', 'ATS_API', 'OFFICIAL_CAREERS_PAGE', 'OFFICIAL_COMPANY_PAGE', 'USER_PROVIDED', 'UNKNOWN')
  AND "verification_status" IN ('SOURCE_VERIFIED', 'UNVERIFIED', 'STALE', 'INVALID', 'INFERRED')
  AND "confidence" IN ('HIGH', 'MEDIUM', 'LOW')
  -- Verified only with a citable source; user-provided/unknown/inferred details are never "verified".
  AND ("verification_status" <> 'SOURCE_VERIFIED' OR ("source" NOT IN ('USER_PROVIDED', 'UNKNOWN') AND "source_url" IS NOT NULL))
  AND ("channel_type" <> 'EMAIL_APPLICATION' OR "email" IS NOT NULL)
  AND ("url" IS NULL OR ("url" ~ '^https?://' AND char_length("url") <= 2048))
  AND ("source_url" IS NULL OR ("source_url" ~ '^https?://' AND char_length("source_url") <= 2048))
  AND ("email" IS NULL OR ("email" ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' AND char_length("email") <= 254))
  AND ("evidence_excerpt" IS NULL OR char_length("evidence_excerpt") <= 1000)
);
CREATE UNIQUE INDEX "application_channels_one_primary_uq" ON "application_channels" ("application_id") WHERE "is_primary";

ALTER TABLE "application_attempts" ADD CONSTRAINT "application_attempts_ck" CHECK (
  "status" IN ('RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCERTAIN')
  AND "mode" IN ('MANUAL_ONLY', 'HUMAN_APPROVAL', 'AUTO_FILL_REVIEW_SUBMIT')
  AND "attempt_number" >= 1
  AND jsonb_typeof("steps") = 'array'
  AND ("error_code" IS NULL OR "error_code" IN ('FORM_FIELD_NOT_FOUND', 'FILE_UPLOAD_FAILED', 'SESSION_EXPIRED', 'NETWORK_ERROR',
       'AUTHENTICATION_REQUIRED', 'CAPTCHA_REQUIRED', 'TWO_FACTOR_REQUIRED', 'ANTI_BOT_BLOCKED', 'RATE_LIMITED', 'FORM_CHANGED',
       'SUBMISSION_REJECTED', 'UNKNOWN_RESULT', 'UNSAFE_URL', 'JOB_CLOSED', 'TIMEOUT', 'CANCELLED', 'VALIDATION_FAILED', 'INTERNAL_ERROR'))
  AND ("error_message" IS NULL OR char_length("error_message") <= 1000)
  AND ("status" IN ('RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT') OR "completed_at" IS NOT NULL)
);
-- One active execution per application (no concurrent workers).
CREATE UNIQUE INDEX "application_attempts_one_active_uq" ON "application_attempts" ("application_id")
  WHERE "status" IN ('RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT');

ALTER TABLE "application_forms" ADD CONSTRAINT "application_forms_ck" CHECK (
  "status" IN ('CURRENT', 'SUPERSEDED', 'CHANGED')
  AND "form_fingerprint" ~ '^[0-9a-f]{64}$'
  AND "schema_version" >= 1 AND "field_map_version" >= 0
  AND "url" ~ '^https?://' AND char_length("url") <= 2048
);
CREATE UNIQUE INDEX "application_forms_one_current_uq" ON "application_forms" ("application_id") WHERE "status" = 'CURRENT';

ALTER TABLE "application_fields" ADD CONSTRAINT "application_fields_ck" CHECK (
  "field_type" IN ('TEXT', 'TEXTAREA', 'EMAIL', 'PHONE', 'URL', 'NUMBER', 'DATE', 'SELECT', 'MULTISELECT', 'RADIO', 'CHECKBOX',
                   'FILE', 'ADDRESS', 'LOCATION', 'YES_NO', 'CUSTOM', 'UNKNOWN')
  AND "classification" IN ('FACTUAL', 'EXPERIENCE', 'PREFERENCE', 'MOTIVATION', 'BEHAVIORAL', 'TECHNICAL', 'LEGAL', 'DEMOGRAPHIC', 'CONSENT', 'FILE', 'OTHER')
  AND char_length("external_field_id") BETWEEN 1 AND 300
  AND char_length("label") BETWEEN 1 AND 2000
  AND jsonb_typeof("options") = 'array'
  AND ("max_length" IS NULL OR "max_length" > 0)
  AND "field_fingerprint" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "application_field_mappings" ADD CONSTRAINT "application_field_mappings_ck" CHECK (
  "mapping_type" IN ('CANDIDATE_FACT', 'CANDIDATE_PROFILE', 'RESUME', 'COVER_LETTER', 'COMMUNICATION_PACKAGE', 'GENERATED_ANSWER', 'USER_INPUT', 'UNKNOWN')
  AND "confidence" IN ('EXACT', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN')
  AND "policy" IN ('AUTO_FILL', 'REQUIRE_REVIEW', 'REQUIRE_USER_INPUT', 'BLOCK')
  AND "status" IN ('MAPPED', 'NEEDS_REVIEW', 'NEEDS_USER_INPUT', 'BLOCKED', 'CONFIRMED', 'OVERRIDDEN')
  AND "created_by" IN ('SYSTEM', 'AI', 'USER')
  AND "version" >= 1
  -- Auto-fill only for exact/high-confidence mappings; unknown mappings never carry a value.
  AND ("policy" <> 'AUTO_FILL' OR "confidence" IN ('EXACT', 'HIGH'))
  AND ("mapping_type" <> 'UNKNOWN' OR "value" IS NULL)
  AND ("explanation" IS NULL OR char_length("explanation") <= 1000)
);
CREATE UNIQUE INDEX "application_field_mappings_one_current_uq" ON "application_field_mappings" ("field_id") WHERE "is_current";

ALTER TABLE "application_questions" ADD CONSTRAINT "application_questions_ck" CHECK (
  "answer_type" IN ('CANDIDATE_FACT', 'EXPERIENCE', 'PROJECT', 'MOTIVATION', 'COMPANY_INTEREST', 'ROLE_INTEREST', 'BEHAVIORAL',
                    'TECHNICAL', 'PREFERENCES', 'AVAILABILITY', 'OTHER')
  AND "classification" IN ('FACTUAL', 'EXPERIENCE', 'PREFERENCE', 'MOTIVATION', 'BEHAVIORAL', 'TECHNICAL', 'LEGAL', 'DEMOGRAPHIC', 'OTHER')
  AND "source" IN ('FORM', 'USER')
  AND char_length("question_text") BETWEEN 1 AND 4000
  AND ("max_length" IS NULL OR "max_length" > 0)
);

ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_ck" CHECK (
  "content_source" IN ('AI_GENERATED', 'AI_ASSISTED', 'USER_AUTHORED', 'PROFILE_DERIVED')
  AND "validation_status" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'NEEDS_USER_INPUT', 'NOT_VALIDATED')
  AND "approval_status" IN ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED')
  AND "version_number" >= 1
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND char_length("answer_text") <= 20000
  AND jsonb_typeof("warnings") = 'array'
  -- An unsupported answer can never be approved.
  AND ("approval_status" <> 'APPROVED' OR ("validation_status" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED') AND "approved_at" IS NOT NULL))
);
CREATE UNIQUE INDEX "application_answers_one_current_uq" ON "application_answers" ("question_id") WHERE "is_current";

ALTER TABLE "application_approvals" ADD CONSTRAINT "application_approvals_ck" CHECK (
  "application_hash" ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof("payload") = 'object'
  AND ("revoked_at" IS NULL OR "revoke_reason" IS NOT NULL)
);
CREATE UNIQUE INDEX "application_approvals_one_active_uq" ON "application_approvals" ("application_id") WHERE "revoked_at" IS NULL;

ALTER TABLE "application_submissions" ADD CONSTRAINT "application_submissions_ck" CHECK (
  "status" IN ('SUBMITTING', 'SUBMITTED', 'SUBMISSION_CONFIRMED', 'SUBMISSION_UNCERTAIN', 'FAILED',
               'READY_TO_SEND', 'SENDING', 'SENT', 'DELIVERY_UNKNOWN')
  AND "application_hash" ~ '^[0-9a-f]{64}$'
  AND "submission_fingerprint" ~ '^[0-9a-f]{64}$'
  AND ("confirmation_source" IS NULL OR "confirmation_source" IN ('CONFIRMATION_PAGE', 'CONFIRMATION_ID', 'SUCCESS_MESSAGE', 'EXTERNAL_APPLICATION_ID', 'HTTP_API_SUCCESS', 'USER_CONFIRMED'))
  -- Success is only recorded with evidence.
  AND ("status" NOT IN ('SUBMITTED', 'SUBMISSION_CONFIRMED', 'SENT') OR ("submitted_at" IS NOT NULL AND "confirmation_source" IS NOT NULL))
  AND ("confirmation_url" IS NULL OR ("confirmation_url" ~ '^https?://' AND char_length("confirmation_url") <= 2048))
  AND ("confirmation_text" IS NULL OR char_length("confirmation_text") <= 2000)
  AND ("external_application_id" IS NULL OR char_length("external_application_id") BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "application_submissions_fingerprint_uq" ON "application_submissions" ("submission_fingerprint");
-- At most one live/successful submission per application: never two concurrent or duplicate submissions.
CREATE UNIQUE INDEX "application_submissions_one_live_uq" ON "application_submissions" ("application_id")
  WHERE "status" IN ('READY_TO_SEND', 'SUBMITTING', 'SENDING', 'SUBMITTED', 'SUBMISSION_CONFIRMED', 'SUBMISSION_UNCERTAIN', 'SENT', 'DELIVERY_UNKNOWN');

ALTER TABLE "application_evidence" ADD CONSTRAINT "application_evidence_ck" CHECK (
  "evidence_type" IN ('SCREENSHOT', 'CONFIRMATION_PAGE', 'CONFIRMATION_ID', 'SUCCESS_MESSAGE', 'EXTERNAL_APPLICATION_ID',
                      'HTTP_API_SUCCESS', 'USER_CONFIRMED', 'FAILURE_STATE', 'REVIEW_STATE')
  AND "source" IN ('AUTOMATED', 'USER')
  -- User confirmations are always labelled as such.
  AND (("evidence_type" = 'USER_CONFIRMED') = ("source" = 'USER') OR "evidence_type" IN ('SCREENSHOT', 'FAILURE_STATE', 'REVIEW_STATE'))
  AND ("storage_path" IS NULL OR "storage_path" LIKE "user_id"::text || '/applications/%')
  AND ("text_excerpt" IS NULL OR char_length("text_excerpt") <= 2000)
  AND jsonb_typeof("metadata") = 'object'
);

ALTER TABLE "application_events" ADD CONSTRAINT "application_events_ck" CHECK (
  "event_type" IN ('APPLICATION_CREATED', 'PACKAGE_VALIDATED', 'CHANNEL_DETECTED', 'CHANNEL_RESOLVED', 'FORM_OPENED', 'FORM_DISCOVERED',
                   'FORM_ANALYZED', 'FORM_CHANGED', 'FIELDS_MAPPED', 'FIELD_OVERRIDDEN', 'ANSWER_GENERATED', 'ANSWER_VALIDATED',
                   'ANSWER_EDITED', 'ANSWER_APPROVED', 'FILES_ATTACHED', 'READY_FOR_REVIEW', 'WAITING_FOR_USER', 'APPROVED',
                   'APPROVAL_INVALIDATED', 'AUTOFILL_STARTED', 'AUTOFILL_COMPLETED', 'PAUSED', 'RESUMED', 'STOPPED',
                   'SUBMISSION_STARTED', 'SUBMITTED', 'CONFIRMED', 'SUBMISSION_UNCERTAIN', 'USER_CONFIRMED', 'FAILED',
                   'BLOCKED', 'STATUS_CHANGED', 'CANCELLED', 'WITHDRAWN', 'ARCHIVED', 'STALE_DETECTED')
  AND jsonb_typeof("payload") = 'object'
);

-- --- Application state machine (defence in depth; mirrors src/modules/applications/state-machine.ts) ---
CREATE OR REPLACE FUNCTION applications_guard_status() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  allowed text[];
BEGIN
  IF NEW."status" IS NOT DISTINCT FROM OLD."status" THEN
    RETURN NEW;
  END IF;
  allowed := CASE OLD."status"
    WHEN 'DRAFT' THEN ARRAY['IN_PROGRESS', 'READY', 'NEEDS_HUMAN_INPUT', 'BLOCKED', 'CANCELLED', 'ARCHIVED']
    WHEN 'IN_PROGRESS' THEN ARRAY['DRAFT', 'READY', 'NEEDS_HUMAN_INPUT', 'BLOCKED', 'FAILED', 'CANCELLED']
    WHEN 'NEEDS_HUMAN_INPUT' THEN ARRAY['IN_PROGRESS', 'READY', 'BLOCKED', 'CANCELLED']
    WHEN 'READY' THEN ARRAY['READY_TO_SUBMIT', 'IN_PROGRESS', 'NEEDS_HUMAN_INPUT', 'BLOCKED', 'CANCELLED']
    WHEN 'READY_TO_SUBMIT' THEN ARRAY['SUBMITTING', 'READY', 'IN_PROGRESS', 'NEEDS_HUMAN_INPUT', 'BLOCKED', 'CANCELLED']
    WHEN 'SUBMITTING' THEN ARRAY['SUBMITTED', 'SUBMISSION_UNCERTAIN', 'FAILED', 'NEEDS_HUMAN_INPUT', 'BLOCKED']
    WHEN 'SUBMITTED' THEN ARRAY['SUBMISSION_CONFIRMED', 'WITHDRAWN', 'ARCHIVED']
    WHEN 'SUBMISSION_CONFIRMED' THEN ARRAY['WITHDRAWN', 'ARCHIVED']
    WHEN 'SUBMISSION_UNCERTAIN' THEN ARRAY['SUBMITTED', 'SUBMISSION_CONFIRMED', 'FAILED', 'ARCHIVED']
    WHEN 'FAILED' THEN ARRAY['IN_PROGRESS', 'READY', 'CANCELLED', 'ARCHIVED']
    WHEN 'BLOCKED' THEN ARRAY['IN_PROGRESS', 'CANCELLED', 'ARCHIVED']
    WHEN 'CANCELLED' THEN ARRAY['ARCHIVED']
    WHEN 'WITHDRAWN' THEN ARRAY['ARCHIVED']
    ELSE ARRAY[]::text[]
  END;
  IF NOT (NEW."status" = ANY (allowed)) THEN
    RAISE EXCEPTION 'Invalid application status change % -> %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "applications_guard_status"
  BEFORE UPDATE ON "applications"
  FOR EACH ROW EXECUTE FUNCTION applications_guard_status();

-- Locked versions also cannot change when the status stays the same.
CREATE OR REPLACE FUNCTION applications_protect_snapshot() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."package_integrity_hash" IS DISTINCT FROM OLD."package_integrity_hash"
     OR NEW."communication_package_id" IS DISTINCT FROM OLD."communication_package_id" OR NEW."job_id" IS DISTINCT FROM OLD."job_id"
     OR NEW."candidate_id" IS DISTINCT FROM OLD."candidate_id" THEN
    RAISE EXCEPTION 'An application''s locked package and versions cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "applications_protect_snapshot"
  BEFORE UPDATE ON "applications"
  FOR EACH ROW EXECUTE FUNCTION applications_protect_snapshot();

-- Approvals: immutable except a one-time revocation.
CREATE OR REPLACE FUNCTION application_approvals_protect() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW."application_hash" IS DISTINCT FROM OLD."application_hash" OR NEW."payload" IS DISTINCT FROM OLD."payload"
     OR NEW."approved_at" IS DISTINCT FROM OLD."approved_at" OR NEW."application_id" IS DISTINCT FROM OLD."application_id"
     OR (OLD."revoked_at" IS NOT NULL AND (NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" OR NEW."revoke_reason" IS DISTINCT FROM OLD."revoke_reason")) THEN
    RAISE EXCEPTION 'Application approvals are immutable (they can only be revoked once)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "application_approvals_protect"
  BEFORE UPDATE ON "application_approvals"
  FOR EACH ROW EXECUTE FUNCTION application_approvals_protect();

-- Approved answers: text, hash and provenance are immutable; only superseding / current flag may change.
CREATE OR REPLACE FUNCTION application_answers_protect_approved() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD."approval_status" IN ('APPROVED', 'SUPERSEDED') AND (
       NEW."answer_text" IS DISTINCT FROM OLD."answer_text"
    OR NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."supporting_fact_refs" IS DISTINCT FROM OLD."supporting_fact_refs"
    OR NEW."supporting_research_claim_ids" IS DISTINCT FROM OLD."supporting_research_claim_ids"
    OR NEW."validation_status" IS DISTINCT FROM OLD."validation_status"
    OR NEW."question_id" IS DISTINCT FROM OLD."question_id"
    OR (OLD."approval_status" = 'APPROVED' AND NEW."approval_status" NOT IN ('APPROVED', 'SUPERSEDED'))
    OR (OLD."approval_status" = 'SUPERSEDED' AND NEW."approval_status" <> 'SUPERSEDED')
  ) THEN
    RAISE EXCEPTION 'Approved answers are immutable; create a new version instead' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "application_answers_protect_approved"
  BEFORE UPDATE ON "application_answers"
  FOR EACH ROW EXECUTE FUNCTION application_answers_protect_approved();

-- Submissions: a successful submission's evidence can never be rewritten or downgraded.
CREATE OR REPLACE FUNCTION application_submissions_protect() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD."status" IN ('SUBMITTED', 'SUBMISSION_CONFIRMED', 'SENT') AND (
       NEW."status" NOT IN ('SUBMITTED', 'SUBMISSION_CONFIRMED', 'SENT')
    OR NEW."submitted_at" IS DISTINCT FROM OLD."submitted_at"
    OR NEW."application_hash" IS DISTINCT FROM OLD."application_hash"
    OR (OLD."external_application_id" IS NOT NULL AND NEW."external_application_id" IS DISTINCT FROM OLD."external_application_id")
  ) THEN
    RAISE EXCEPTION 'A recorded submission cannot be rewritten' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."submission_fingerprint" IS DISTINCT FROM OLD."submission_fingerprint" OR NEW."application_id" IS DISTINCT FROM OLD."application_id" THEN
    RAISE EXCEPTION 'Submission identity cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "application_submissions_protect"
  BEFORE UPDATE ON "application_submissions"
  FOR EACH ROW EXECUTE FUNCTION application_submissions_protect();

-- --- Row Level Security: owner only (one permissive policy per table) --------
ALTER TABLE "applications"               ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_channels"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_attempts"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_forms"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_fields"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_field_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_questions"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_answers"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_approvals"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_submissions"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_evidence"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "application_events"         ENABLE ROW LEVEL SECURITY;

-- Application history is archived, never deleted by the app. Fields are an immutable form snapshot;
-- events are append-only. Evidence files may be removed under the retention policy.
GRANT SELECT, INSERT, UPDATE ON "applications", "application_channels", "application_attempts", "application_forms",
  "application_field_mappings", "application_questions", "application_answers", "application_approvals",
  "application_submissions" TO jobhunt_app;
GRANT SELECT, INSERT ON "application_fields", "application_events" TO jobhunt_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "application_evidence" TO jobhunt_app;

CREATE POLICY "applications_owner" ON "applications" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "candidate_profiles" c WHERE c."id" = "candidate_id")
    AND EXISTS (SELECT 1 FROM "jobs" j WHERE j."id" = "job_id")
    AND EXISTS (SELECT 1 FROM "communication_packages" p WHERE p."id" = "communication_package_id")
    AND ("channel_id" IS NULL OR EXISTS (SELECT 1 FROM "application_channels" ch WHERE ch."id" = "channel_id")));

CREATE POLICY "application_channels_owner" ON "application_channels" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id"));

CREATE POLICY "application_attempts_owner" ON "application_attempts" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id"));

CREATE POLICY "application_forms_owner" ON "application_forms" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id")
    AND ("channel_id" IS NULL OR EXISTS (SELECT 1 FROM "application_channels" ch WHERE ch."id" = "channel_id")));

CREATE POLICY "application_fields_owner" ON "application_fields" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "application_forms" f WHERE f."id" = "form_id"));

CREATE POLICY "application_field_mappings_owner" ON "application_field_mappings" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "application_fields" f WHERE f."id" = "field_id"));

CREATE POLICY "application_questions_owner" ON "application_questions" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id")
    AND ("field_id" IS NULL OR EXISTS (SELECT 1 FROM "application_fields" f WHERE f."id" = "field_id")));

CREATE POLICY "application_answers_owner" ON "application_answers" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "application_questions" q WHERE q."id" = "question_id"));

CREATE POLICY "application_approvals_owner" ON "application_approvals" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id"));

CREATE POLICY "application_submissions_owner" ON "application_submissions" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id")
    AND ("attempt_id" IS NULL OR EXISTS (SELECT 1 FROM "application_attempts" t WHERE t."id" = "attempt_id")));

CREATE POLICY "application_evidence_owner" ON "application_evidence" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id")
    AND ("submission_id" IS NULL OR EXISTS (SELECT 1 FROM "application_submissions" s WHERE s."id" = "submission_id"))
    AND ("attempt_id" IS NULL OR EXISTS (SELECT 1 FROM "application_attempts" t WHERE t."id" = "attempt_id")));

CREATE POLICY "application_events_owner" ON "application_events" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id())
    AND EXISTS (SELECT 1 FROM "applications" a WHERE a."id" = "application_id")
    AND ("attempt_id" IS NULL OR EXISTS (SELECT 1 FROM "application_attempts" t WHERE t."id" = "attempt_id")));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "applications", "application_channels", "application_attempts", "application_forms", "application_fields", "application_field_mappings", "application_questions", "application_answers", "application_approvals", "application_submissions", "application_evidence", "application_events" FROM %I', r);
    END IF;
  END LOOP;
END
$$;
