-- Ad data (RELAY-161): daily ad spend, ad clicks and the Meta ad mapping,
-- plus owner-editable ad settings on companies. Money is kuruş (TRY minor
-- units, columns end in _minor; currency is the AD_CURRENCY constant, not a
-- column). ad_spend_daily.spend_date is the Europe/Istanbul calendar day.
-- ad_clicks has no IP and no user-agent column by design. Additive.
-- Reverse: down/0052_ad_data.sql.
CREATE TABLE IF NOT EXISTS "ad_spend_daily" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "spend_date" date NOT NULL,
  "channel" text NOT NULL,
  "campaign_id" text NOT NULL,
  "campaign_name" text,
  "amount_minor" bigint NOT NULL,
  "impressions" integer,
  "clicks" integer,
  "source" text NOT NULL,
  "complete" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ad_spend_daily_channel_chk" CHECK (channel IN ('google', 'instagram', 'meta')),
  CONSTRAINT "ad_spend_daily_source_chk" CHECK (source IN ('manual', 'csv', 'api')),
  CONSTRAINT "ad_spend_daily_amount_minor_chk" CHECK (amount_minor >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_spend_daily_company_date_channel_campaign_uidx" ON "ad_spend_daily" ("company_id", "spend_date", "channel", "campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_spend_daily_company_date_idx" ON "ad_spend_daily" ("company_id", "spend_date");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "code" text NOT NULL,
  "channel" text NOT NULL,
  "gclid" varchar(200),
  "gbraid" varchar(200),
  "wbraid" varchar(200),
  "fbclid" varchar(200),
  "utm_source" text,
  "utm_medium" text,
  "utm_campaign" text,
  "utm_term" text,
  "utm_content" text,
  "landing_path" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "linked_record_id" uuid REFERENCES "company_records"("id") ON DELETE set null,
  "linked_at" timestamptz,
  CONSTRAINT "ad_clicks_code_chk" CHECK (code ~ '^[A-Z0-9]{5}$'),
  CONSTRAINT "ad_clicks_channel_chk" CHECK (channel IN ('google', 'instagram', 'meta')),
  CONSTRAINT "ad_clicks_expires_after_created_chk" CHECK (expires_at > created_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_company_code_uidx" ON "ad_clicks" ("company_id", "code");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_clicks_linked_record_uidx" ON "ad_clicks" ("linked_record_id") WHERE linked_record_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_clicks_expires_at_idx" ON "ad_clicks" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ad_meta_mappings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "source_id" text NOT NULL,
  "code" text NOT NULL,
  "campaign_name" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "ad_meta_mappings_code_chk" CHECK (code ~ '^[A-Z0-9]{5}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_meta_mappings_company_source_uidx" ON "ad_meta_mappings" ("company_id", "source_id");
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ad_monthly_target_minor" bigint;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ad_cpl_stop_minor" bigint;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ad_daily_cap_minor" bigint;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ad_capacity_site_monthly" integer;
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "ad_capacity_social_monthly" integer;
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_monthly_target_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ad_monthly_target_minor_chk" CHECK ("ad_monthly_target_minor" IS NULL OR "ad_monthly_target_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_cpl_stop_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ad_cpl_stop_minor_chk" CHECK ("ad_cpl_stop_minor" IS NULL OR "ad_cpl_stop_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_daily_cap_minor_chk";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ad_daily_cap_minor_chk" CHECK ("ad_daily_cap_minor" IS NULL OR "ad_daily_cap_minor" >= 0);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_capacity_site_monthly_chk";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ad_capacity_site_monthly_chk" CHECK ("ad_capacity_site_monthly" IS NULL OR "ad_capacity_site_monthly" >= 0);
--> statement-breakpoint
ALTER TABLE "companies" DROP CONSTRAINT IF EXISTS "companies_ad_capacity_social_monthly_chk";
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_ad_capacity_social_monthly_chk" CHECK ("ad_capacity_social_monthly" IS NULL OR "ad_capacity_social_monthly" >= 0);
