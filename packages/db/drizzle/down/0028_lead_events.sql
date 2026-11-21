-- Reverses 0028_lead_events.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0028 row from
-- drizzle.__drizzle_migrations. The lead event log is lost.
DROP TABLE IF EXISTS "lead_events";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "timezone";
