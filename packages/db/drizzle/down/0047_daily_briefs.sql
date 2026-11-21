-- Reverses 0047_daily_briefs.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0047 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "daily_briefs";
