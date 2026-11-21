-- Reverses 0040_access_requests.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0040 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "access_requests";
