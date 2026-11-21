-- Reverses 0053_lead_event_metadata.sql. Not run by the migrator (drizzle has
-- no down step); apply by hand, then delete the 0053 row from
-- drizzle.__drizzle_migrations. Drops the payment audit metadata.
ALTER TABLE "lead_events" DROP COLUMN IF EXISTS "metadata";
