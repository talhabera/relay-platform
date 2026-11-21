-- Reverses 0047_push_subscriptions.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0045 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "push_deliveries";
DROP TABLE IF EXISTS "push_subscriptions";
