-- Reverses 0041_packages.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0041 row from
-- drizzle.__drizzle_migrations. Recreating the unique index fails while a
-- company has more than one agent with the same package_slug.
DROP INDEX IF EXISTS "agents_company_package_slug_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "agents_company_package_slug_uidx" ON "agents" ("company_id", "package_slug") WHERE "package_slug" is not null;
DROP INDEX IF EXISTS "cron_jobs_company_package_slug_idx";
ALTER TABLE "cron_jobs" DROP CONSTRAINT IF EXISTS "cron_jobs_paused_reason_chk";
ALTER TABLE "cron_jobs" DROP COLUMN IF EXISTS "paused_reason";
ALTER TABLE "cron_jobs" DROP COLUMN IF EXISTS "package_slug";
DROP TABLE IF EXISTS "package_installs";
