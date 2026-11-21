-- Daily Manager package: daily_briefs, one morning brief per company per
-- local day (local_date is the company-local YYYY-MM-DD). A re-run on the
-- same day replaces the brief through the unique index.
-- Reverse: down/0047_daily_briefs.sql.
CREATE TABLE IF NOT EXISTS "daily_briefs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "cron_run_id" uuid REFERENCES "cron_runs"("id") ON DELETE set null,
  "local_date" text NOT NULL,
  "summary" text NOT NULL,
  "items" jsonb NOT NULL,
  "read_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "daily_briefs_company_local_date_uidx" ON "daily_briefs" ("company_id", "local_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "daily_briefs_company_created_at_idx" ON "daily_briefs" ("company_id", "created_at");
