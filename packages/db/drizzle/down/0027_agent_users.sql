-- Reverses 0027_agent_users.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0027 row from
-- drizzle.__drizzle_migrations. Approve-only rows (backfilled or granted) are
-- dropped; editor rows stay as plain editor grants.
DELETE FROM "operator_agent_editors" WHERE "can_edit" = false;
--> statement-breakpoint
ALTER TABLE "operator_agent_editors" DROP COLUMN IF EXISTS "can_approve";
--> statement-breakpoint
ALTER TABLE "operator_agent_editors" DROP COLUMN IF EXISTS "can_edit";
