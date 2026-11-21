-- Reverses 0039_report_snapshots.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0039 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "report_snapshots";
DROP FUNCTION IF EXISTS "report_snapshots_frozen"();
