
-- AlterTable
ALTER TABLE "recipient_contexts" ADD COLUMN     "last_verified_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "application_attempts" ADD COLUMN     "control_command" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "heartbeat_at" TIMESTAMPTZ(3),
ADD COLUMN     "human_action" TEXT,
ADD COLUMN     "phase" TEXT NOT NULL DEFAULT 'FILL',
ALTER COLUMN "status" SET DEFAULT 'QUEUED';

-- AlterTable
ALTER TABLE "application_forms" ADD COLUMN     "inspection_source" TEXT NOT NULL DEFAULT 'BROWSER',
ADD COLUMN     "is_test_adapter" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "application_settings" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_automation_mode" TEXT NOT NULL DEFAULT 'HUMAN_APPROVAL',
    "auto_fill_min_confidence" TEXT NOT NULL DEFAULT 'HIGH',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "application_settings_user_id_key" ON "application_settings"("user_id");

-- AddForeignKey
ALTER TABLE "application_settings" ADD CONSTRAINT "application_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written: execution control, manual confirmation path, contact provenance
-- ===========================================================================

-- Attempts: queued state, phase and user control commands.
ALTER TABLE "application_attempts" DROP CONSTRAINT "application_attempts_ck";
ALTER TABLE "application_attempts" ADD CONSTRAINT "application_attempts_ck" CHECK (
  "status" IN ('QUEUED', 'RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNCERTAIN')
  AND "phase" IN ('INSPECT', 'FILL', 'FILL_AND_SUBMIT', 'SUBMIT')
  AND "control_command" IN ('NONE', 'PAUSE', 'RESUME', 'STOP')
  AND "mode" IN ('MANUAL_ONLY', 'HUMAN_APPROVAL', 'AUTO_FILL_REVIEW_SUBMIT')
  AND "attempt_number" >= 1
  AND jsonb_typeof("steps") = 'array'
  AND ("error_code" IS NULL OR "error_code" IN ('FORM_FIELD_NOT_FOUND', 'FILE_UPLOAD_FAILED', 'SESSION_EXPIRED', 'NETWORK_ERROR',
       'AUTHENTICATION_REQUIRED', 'CAPTCHA_REQUIRED', 'TWO_FACTOR_REQUIRED', 'ANTI_BOT_BLOCKED', 'RATE_LIMITED', 'FORM_CHANGED',
       'SUBMISSION_REJECTED', 'UNKNOWN_RESULT', 'UNSAFE_URL', 'JOB_CLOSED', 'TIMEOUT', 'CANCELLED', 'VALIDATION_FAILED', 'INTERNAL_ERROR'))
  AND ("error_message" IS NULL OR char_length("error_message") <= 1000)
  AND ("human_action" IS NULL OR char_length("human_action") <= 500)
  AND ("status" IN ('QUEUED', 'RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT') OR "completed_at" IS NOT NULL)
);
DROP INDEX "application_attempts_one_active_uq";
CREATE UNIQUE INDEX "application_attempts_one_active_uq" ON "application_attempts" ("application_id")
  WHERE "status" IN ('QUEUED', 'RUNNING', 'PAUSED', 'NEEDS_HUMAN_INPUT');
-- Worker queue scan.
CREATE INDEX "application_attempts_queue_idx" ON "application_attempts" ("status", "lease_expires_at");

ALTER TABLE "application_forms" ADD CONSTRAINT "application_forms_source_ck" CHECK ("inspection_source" IN ('API', 'BROWSER', 'FIXTURE'));

-- Contacts: inferred details are allowed but never "verified"; talent acquisition role; last verified.
ALTER TABLE "recipient_contexts" DROP CONSTRAINT "recipient_contexts_ck";
ALTER TABLE "recipient_contexts" ADD CONSTRAINT "recipient_contexts_ck" CHECK (
  "recipient_type" IN ('RECRUITER', 'HIRING_MANAGER', 'HR', 'TALENT_ACQUISITION', 'TEAM_MEMBER', 'GENERAL_COMPANY', 'UNKNOWN', 'CUSTOM')
  AND "source" IN ('JOB_POST', 'OFFICIAL_COMPANY_PAGE', 'USER_PROVIDED', 'PUBLIC_PROFESSIONAL_SOURCE', 'PHASE_8_DISCOVERY', 'UNKNOWN')
  AND "verification_status" IN ('SOURCE_VERIFIED', 'UNVERIFIED', 'INVALID', 'STALE', 'INFERRED')
  AND "confidence" IN ('HIGH', 'MEDIUM', 'LOW')
  AND ("verification_status" <> 'SOURCE_VERIFIED' OR ("source" IN ('JOB_POST', 'OFFICIAL_COMPANY_PAGE', 'PUBLIC_PROFESSIONAL_SOURCE') AND "source_url" IS NOT NULL AND "verified_at" IS NOT NULL))
  AND ("name" IS NOT NULL OR "email" IS NOT NULL OR "title" IS NOT NULL OR "company" IS NOT NULL)
  AND ("name" IS NULL OR char_length("name") <= 200)
  AND ("title" IS NULL OR char_length("title") <= 200)
  AND ("company" IS NULL OR char_length("company") <= 200)
  AND ("email" IS NULL OR ("email" ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' AND char_length("email") <= 254))
  AND ("source_url" IS NULL OR ("source_url" ~ '^https?://' AND char_length("source_url") <= 2048))
  AND ("notes" IS NULL OR char_length("notes") <= 2000)
);

ALTER TABLE "application_settings" ADD CONSTRAINT "application_settings_ck" CHECK (
  "default_automation_mode" IN ('MANUAL_ONLY', 'HUMAN_APPROVAL', 'AUTO_FILL_REVIEW_SUBMIT')
  AND "auto_fill_min_confidence" IN ('EXACT', 'HIGH')
);

-- State machine: adds the manual path — the candidate applied themselves and confirms it. Only a
-- USER_CONFIRMED submission may reach SUBMITTED this way (automatic success always goes through SUBMITTING).
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
  IF NEW."status" = ANY (allowed) THEN
    RETURN NEW;
  END IF;
  -- MANUAL_CONFIRM_FROM: IN_PROGRESS, NEEDS_HUMAN_INPUT, READY, READY_TO_SUBMIT, FAILED, BLOCKED
  IF NEW."status" = 'SUBMITTED' AND NEW."confirmation_source" = 'USER_CONFIRMED'
     AND OLD."status" = ANY (ARRAY['IN_PROGRESS', 'NEEDS_HUMAN_INPUT', 'READY', 'READY_TO_SUBMIT', 'FAILED', 'BLOCKED']) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invalid application status change % -> %', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
END
$$;

ALTER TABLE "application_settings" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "application_settings" TO jobhunt_app;
CREATE POLICY "application_settings_owner" ON "application_settings" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "application_settings" FROM %I', r);
    END IF;
  END LOOP;
END
$$;

-- Answers to legal / preference questions are the candidate's own statement (not fact-audited):
-- a USER_AUTHORED answer may be approved while NOT_VALIDATED. Unsupported answers still never can.
ALTER TABLE "application_answers" DROP CONSTRAINT "application_answers_ck";
ALTER TABLE "application_answers" ADD CONSTRAINT "application_answers_ck" CHECK (
  "content_source" IN ('AI_GENERATED', 'AI_ASSISTED', 'USER_AUTHORED', 'PROFILE_DERIVED')
  AND "validation_status" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED', 'UNSUPPORTED', 'NEEDS_USER_INPUT', 'NOT_VALIDATED')
  AND "approval_status" IN ('DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED')
  AND "version_number" >= 1
  AND "content_hash" ~ '^[0-9a-f]{64}$'
  AND char_length("answer_text") <= 20000
  AND jsonb_typeof("warnings") = 'array'
  AND ("approval_status" <> 'APPROVED' OR (
    "approved_at" IS NOT NULL
    AND ("validation_status" IN ('SUPPORTED', 'PARTIALLY_SUPPORTED')
         OR ("validation_status" = 'NOT_VALIDATED' AND "content_source" = 'USER_AUTHORED'))
  ))
);
