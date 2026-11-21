-- Reverses 0033_lead_capture.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0033 row from
-- drizzle.__drizzle_migrations. Leads copied by the second backfill stay in
-- company_records (0032's down removes every copied lead).
ALTER TABLE "agents" DROP CONSTRAINT IF EXISTS "agents_lead_capture_workflow_id_workflows_id_fk";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "lead_capture_workflow_id";
--> statement-breakpoint
ALTER TABLE "agents" DROP COLUMN IF EXISTS "lead_capture_enabled";
