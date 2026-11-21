-- Reverses 0052_ad_data.sql. Not run by the migrator (drizzle has no down
-- step); apply by hand, then delete the 0052 row from
-- drizzle.__drizzle_migrations. Drops the three ad tables, then the five
-- companies CHECKs before their columns.
DROP TABLE IF EXISTS "ad_meta_mappings";
--> statement-breakpoint
DROP TABLE IF EXISTS "ad_clicks";
--> statement-breakpoint
DROP TABLE IF EXISTS "ad_spend_daily";
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_monthly_target_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_cpl_stop_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_daily_cap_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_capacity_site_monthly_chk";
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_capacity_social_monthly_chk";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "ad_monthly_target_minor";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "ad_cpl_stop_minor";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "ad_daily_cap_minor";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "ad_capacity_site_monthly";
--> statement-breakpoint
ALTER TABLE "companies" DROP COLUMN IF EXISTS "ad_capacity_social_monthly";
