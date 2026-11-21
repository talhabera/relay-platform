-- Reverses 0029_portal_events.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0029 row from
-- drizzle.__drizzle_migrations. The Live feed history is lost.
DROP TABLE IF EXISTS "portal_events";
