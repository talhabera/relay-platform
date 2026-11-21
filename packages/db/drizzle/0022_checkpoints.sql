-- S06: generalize pending_actions into checkpoints (spec 2026-10-02-checkpoints).
-- Renames run inside one guarded block so a re-run is harmless.
DO $$
BEGIN
  IF to_regclass('public.pending_actions') IS NOT NULL AND to_regclass('public.checkpoints') IS NULL THEN
    ALTER TABLE "pending_actions" RENAME TO "checkpoints";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_pkey" TO "checkpoints_pkey";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_parent_chk" TO "checkpoints_parent_chk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_company_id_companies_id_fk" TO "checkpoints_company_id_companies_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_agent_id_agents_id_fk" TO "checkpoints_agent_id_agents_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_chat_id_chats_id_fk" TO "checkpoints_chat_id_chats_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_cron_run_id_cron_runs_id_fk" TO "checkpoints_cron_run_id_cron_runs_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_record_id_company_records_id_fk" TO "checkpoints_record_id_company_records_id_fk";
    ALTER TABLE "checkpoints" RENAME CONSTRAINT "pending_actions_resolved_by_user_id_users_id_fk" TO "checkpoints_resolved_by_user_id_users_id_fk";
    ALTER INDEX "pending_actions_cron_run_id_idx" RENAME TO "checkpoints_cron_run_id_idx";
    ALTER INDEX "pending_actions_record_id_idx" RENAME TO "checkpoints_record_id_idx";
    ALTER INDEX "pending_actions_pending_idx" RENAME TO "checkpoints_pending_idx";
  END IF;
  -- Payload is a union keyed by kind; the column replaces action_type.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'checkpoints' AND column_name = 'action_type'
  ) THEN
    ALTER TABLE "checkpoints" RENAME COLUMN "action_type" TO "kind";
  END IF;
END $$;
--> statement-breakpoint
UPDATE "checkpoints" SET "payload" = jsonb_set("payload", '{kind}', to_jsonb("kind"), true) WHERE NOT ("payload" ? 'kind');
--> statement-breakpoint
-- A post or review reply has no company record.
ALTER TABLE "checkpoints" ALTER COLUMN "record_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "checkpoints" SET "status" = 'discarded' WHERE "status" = 'rejected';
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD COLUMN IF NOT EXISTS "superseded_by" uuid;
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD COLUMN IF NOT EXISTS "artifact_hash" text;
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP CONSTRAINT IF EXISTS "checkpoints_superseded_by_checkpoints_id_fk";
--> statement-breakpoint
ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_superseded_by_checkpoints_id_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."checkpoints"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- A paused Schedule run now waits on checkpoints or agent questions.
UPDATE "cron_runs" SET "status" = 'awaiting_input' WHERE "status" = 'awaiting_approval';
