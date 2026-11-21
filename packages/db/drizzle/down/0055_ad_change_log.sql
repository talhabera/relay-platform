-- Reverses 0055_ad_change_log.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0055 row from
-- drizzle.__drizzle_migrations. Dropping the table discards the ad change
-- ledger; export it first if it must be kept.
DROP TRIGGER IF EXISTS "ad_change_log_no_truncate_trg" ON "ad_change_log";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ad_change_log_no_delete_trg" ON "ad_change_log";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ad_change_log_no_update_trg" ON "ad_change_log";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "ad_change_log_immutable"();
--> statement-breakpoint
DROP TABLE IF EXISTS "ad_change_log";
