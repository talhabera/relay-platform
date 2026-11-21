-- Reverses 0022_checkpoints.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0022 row from
-- drizzle.__drizzle_migrations.
-- Lossy: checkpoints of kinds without a company record (post, review_reply)
-- are deleted, and every `discarded` row returns as `rejected`.
UPDATE "cron_runs" SET "status" = 'awaiting_approval' WHERE "status" = 'awaiting_input';
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP CONSTRAINT IF EXISTS "checkpoints_superseded_by_checkpoints_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN IF EXISTS "artifact_hash";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN IF EXISTS "attempt_count";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN IF EXISTS "superseded_by";
--> statement-breakpoint
UPDATE "checkpoints" SET "status" = 'rejected' WHERE "status" = 'discarded';
--> statement-breakpoint
DELETE FROM "checkpoints" WHERE "record_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "checkpoints" ALTER COLUMN "record_id" SET NOT NULL;
--> statement-breakpoint
UPDATE "checkpoints" SET "payload" = "payload" - 'kind';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checkpoints' AND column_name = 'kind'
  ) THEN
    ALTER TABLE "checkpoints" RENAME COLUMN "kind" TO "action_type";
  END IF;
  IF to_regclass('public.checkpoints') IS NOT NULL AND to_regclass('public.pending_actions') IS NULL THEN
    ALTER INDEX "checkpoints_pending_idx" RENAME TO "pending_actions_pending_idx";
    ALTER INDEX "checkpoints_record_id_idx" RENAME TO "pending_actions_record_id_idx";
    ALTER INDEX "checkpoints_cron_run_id_idx" RENAME TO "pending_actions_cron_run_id_idx";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_resolved_by_user_id_users_id_fk" TO "pending_actions_resolved_by_user_id_users_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_record_id_company_records_id_fk" TO "pending_actions_record_id_company_records_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_cron_run_id_cron_runs_id_fk" TO "pending_actions_cron_run_id_cron_runs_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_chat_id_chats_id_fk" TO "pending_actions_chat_id_chats_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_agent_id_agents_id_fk" TO "pending_actions_agent_id_agents_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_company_id_companies_id_fk" TO "pending_actions_company_id_companies_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_parent_chk" TO "pending_actions_parent_chk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "checkpoints_pkey" TO "pending_actions_pkey";
    ALTER TABLE "checkpoints" RENAME TO "pending_actions";
  END IF;
END $$;
