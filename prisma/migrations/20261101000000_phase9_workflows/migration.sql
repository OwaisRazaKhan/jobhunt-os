-- Phase 9 Checkpoint 1: workflow definitions + immutable versions (owner-only RLS).

-- CreateTable
CREATE TABLE "workflows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "draft_definition" JSONB NOT NULL,
    "draft_revision" INTEGER NOT NULL DEFAULT 1,
    "draft_saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latest_version" INTEGER NOT NULL DEFAULT 0,
    "active_version_id" UUID,
    "activated_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "origin" TEXT NOT NULL DEFAULT 'BLANK',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "workflow_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "definition" JSONB NOT NULL,
    "definition_hash" CHAR(64) NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "node_versions" JSONB NOT NULL,
    "validation_status" TEXT NOT NULL,
    "validation" JSONB NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflows_active_version_id_key" ON "workflows"("active_version_id");

-- CreateIndex
CREATE INDEX "workflows_user_id_status_updated_at_idx" ON "workflows"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "workflow_versions_user_id_idx" ON "workflow_versions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflow_id_version_number_key" ON "workflow_versions"("workflow_id", "version_number");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Phase 9 CP1: rules enforced by the database ────────────────────────────────────────────

ALTER TABLE "workflows" ADD CONSTRAINT "workflows_ck" CHECK (
  "status" IN ('DRAFT', 'ACTIVE', 'ARCHIVED')
  AND char_length(btrim("name")) BETWEEN 1 AND 120
  AND ("description" IS NULL OR char_length("description") <= 2000)
  AND cardinality("tags") <= 12
  AND "origin" IN ('BLANK', 'TEMPLATE', 'DUPLICATE', 'IMPORT')
  AND jsonb_typeof("draft_definition") = 'object'
  AND "draft_revision" >= 1
  AND "latest_version" >= 0
  -- An active workflow always points at a version; an archived one has an archive time.
  AND ("status" <> 'ACTIVE' OR ("active_version_id" IS NOT NULL AND "activated_at" IS NOT NULL))
  AND ("status" <> 'ARCHIVED' OR "archived_at" IS NOT NULL)
);

ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_ck" CHECK (
  "version_number" >= 1
  AND "definition_hash" ~ '^[0-9a-f]{64}$'
  AND "schema_version" >= 1
  AND "validation_status" IN ('VALID', 'INVALID')
  AND jsonb_typeof("definition") = 'object'
  AND jsonb_typeof("node_versions") = 'object'
  AND jsonb_typeof("validation") = 'object'
  AND ("note" IS NULL OR char_length("note") <= 500)
);

-- Versions are immutable snapshots: executions pin them, so they never change.
CREATE OR REPLACE FUNCTION workflow_versions_immutable() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Workflow versions are immutable' USING ERRCODE = 'check_violation';
END
$$;
CREATE TRIGGER "workflow_versions_immutable"
  BEFORE UPDATE ON "workflow_versions"
  FOR EACH ROW EXECUTE FUNCTION workflow_versions_immutable();

-- The active version must be a VALID version of the same workflow and owner.
CREATE OR REPLACE FUNCTION workflows_guard_active_version() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  v record;
BEGIN
  IF NEW."active_version_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."active_version_id" IS DISTINCT FROM OLD."active_version_id") THEN
    SELECT "workflow_id", "user_id", "validation_status" INTO v FROM public."workflow_versions" WHERE "id" = NEW."active_version_id";
    IF v IS NULL OR v."workflow_id" <> NEW."id" OR v."user_id" <> NEW."user_id" THEN
      RAISE EXCEPTION 'The active version must belong to this workflow' USING ERRCODE = 'check_violation';
    END IF;
    IF v."validation_status" <> 'VALID' THEN
      RAISE EXCEPTION 'Only a valid workflow version can be activated' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."user_id" IS DISTINCT FROM OLD."user_id" THEN
    RAISE EXCEPTION 'A workflow cannot change owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "workflows_guard_active_version"
  BEFORE INSERT OR UPDATE ON "workflows"
  FOR EACH ROW EXECUTE FUNCTION workflows_guard_active_version();

-- A version belongs to the workflow's owner.
CREATE OR REPLACE FUNCTION workflow_versions_guard_owner() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public."workflows" w WHERE w."id" = NEW."workflow_id" AND w."user_id" = NEW."user_id") THEN
    RAISE EXCEPTION 'A version must belong to the workflow owner' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "workflow_versions_guard_owner"
  BEFORE INSERT ON "workflow_versions"
  FOR EACH ROW EXECUTE FUNCTION workflow_versions_guard_owner();

-- ─── RLS (owner only) + grants: workflows are never deleted by the app (archive instead) ─────

ALTER TABLE "workflows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "workflow_versions" ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON "workflows" TO jobhunt_app;
GRANT SELECT, INSERT ON "workflow_versions" TO jobhunt_app;
CREATE POLICY "workflows_owner" ON "workflows" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));
CREATE POLICY "workflow_versions_owner" ON "workflow_versions" FOR ALL TO jobhunt_app
  USING ("user_id" = (SELECT app_current_user_id()))
  WITH CHECK ("user_id" = (SELECT app_current_user_id()));

DO $$
DECLARE
  r text;
  t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['workflows', 'workflow_versions']
      LOOP
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END
$$;
