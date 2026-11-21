-- Reverses 0024_chat_status.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0024 row from
-- drizzle.__drizzle_migrations.
DROP INDEX IF EXISTS "chats_company_id_last_activity_at_idx";
--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN IF EXISTS "last_activity_at";
--> statement-breakpoint
ALTER TABLE "chats" DROP COLUMN IF EXISTS "status";
