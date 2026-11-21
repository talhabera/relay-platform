-- Reverses 0026_workflows.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0026 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "workflows" DROP CONSTRAINT IF EXISTS "workflows_inbound_stage_id_workflow_stages_id_fk";
--> statement-breakpoint
DROP TABLE IF EXISTS "workflow_stages";
--> statement-breakpoint
DROP TABLE IF EXISTS "workflows";
