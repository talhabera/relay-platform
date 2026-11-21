-- Reverses 0030_w2_concurrency_guards.sql. Not run by the migrator (drizzle
-- has no down step); apply by hand, then delete the 0030 row from
-- drizzle.__drizzle_migrations. Duplicate pending cards the up step
-- discarded stay discarded.
DROP INDEX IF EXISTS "company_members_client_user_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "checkpoints_record_pending_uidx";
--> statement-breakpoint
ALTER TABLE "checkpoints" DROP COLUMN IF EXISTS "refresh_requested_at";
