-- Reverses 0042_agent_version_change_note.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0042 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "agent_versions" DROP COLUMN IF EXISTS "change_note";
