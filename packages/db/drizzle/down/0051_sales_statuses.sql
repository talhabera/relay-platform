-- Reverses 0051_sales_statuses.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0051 row from
-- drizzle.__drizzle_migrations. Drops both CHECKs before both columns.
-- This file does not delete proposal or won rows: the DB has no status CHECK,
-- so they stay valid text. If you must also roll back the TypeScript enum,
-- first run by hand:
--   UPDATE company_records SET status = 'meeting' WHERE status IN ('proposal','won')
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_won_sale_chk";
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_sale_package_chk";
--> statement-breakpoint
ALTER TABLE "company_records" DROP COLUMN IF EXISTS "sale_amount_minor";
--> statement-breakpoint
ALTER TABLE "company_records" DROP COLUMN IF EXISTS "sale_package";
