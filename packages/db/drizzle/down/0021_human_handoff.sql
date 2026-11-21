-- Reverses 0021_human_handoff.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0021 row from
-- drizzle.__drizzle_migrations. Human-authored messages lose their author.
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_human_display_name_chk";
--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "author_display_name";
--> statement-breakpoint
ALTER TABLE "messages" DROP COLUMN IF EXISTS "author";
--> statement-breakpoint
DROP TABLE IF EXISTS "handoff_requests";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_handoff_settings";
