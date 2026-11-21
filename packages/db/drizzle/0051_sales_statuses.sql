-- Sales statuses (RELAY-157): company_records.status gains proposal (teklif)
-- and won (satış) in the TypeScript enum; the column is plain text with no
-- status CHECK, so no constraint changes for the new values. Adds the sale
-- package and the sale amount in TRY minor units (kuruş, VAT excluded), and a
-- CHECK that refuses a won row without both. Only won is bound.
-- Reverse: down/0051_sales_statuses.sql.
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "sale_package" text;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "sale_amount_minor" integer;
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_sale_package_chk";
--> statement-breakpoint
ALTER TABLE "company_records" ADD CONSTRAINT "company_records_sale_package_chk" CHECK (sale_package IS NULL OR sale_package IN ('website','social'));
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_won_sale_chk";
--> statement-breakpoint
ALTER TABLE "company_records" ADD CONSTRAINT "company_records_won_sale_chk" CHECK (status <> 'won' OR (sale_package IS NOT NULL AND sale_amount_minor IS NOT NULL AND sale_amount_minor > 0));
