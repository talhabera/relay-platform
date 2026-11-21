-- Reverses 0044_report_email_deliveries.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0044 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "report_email_deliveries";
