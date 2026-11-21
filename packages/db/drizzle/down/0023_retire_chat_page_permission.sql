-- Reverses 0023_retire_chat_page_permission.sql. Not run by the migrator (drizzle
-- has no down step); apply by hand, then delete the 0023 row from
-- drizzle.__drizzle_migrations. Restores "chat" as true for every member.
ALTER TABLE "company_members" ALTER COLUMN "page_permissions" SET DEFAULT '{"chat":true,"operator":true,"agents":false,"messaging":false,"analytics":false}'::jsonb;
--> statement-breakpoint
UPDATE "company_members" SET "page_permissions" = "page_permissions" || '{"chat":true}'::jsonb WHERE NOT ("page_permissions" ? 'chat');
