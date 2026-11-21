-- S81-82: packages (spec 2026-10-02-packages). One install row per company
-- and package; package Schedules carry their slug and may be paused while a
-- required connector is missing. A package now installs several agents, so
-- the 0008 one-agent-per-package unique index becomes a plain index.
-- Existing Revenue installs are untouched (no install row, no data change).
-- Reverse: down/0041_packages.sql.
CREATE TABLE IF NOT EXISTS "package_installs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "package_slug" text NOT NULL,
  "installed_at" timestamp DEFAULT now() NOT NULL,
  "installed_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "catalog_version" integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "package_installs_company_package_uidx" ON "package_installs" ("company_id", "package_slug");
--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN IF NOT EXISTS "package_slug" text;
--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD COLUMN IF NOT EXISTS "paused_reason" text;
--> statement-breakpoint
ALTER TABLE "cron_jobs" DROP CONSTRAINT IF EXISTS "cron_jobs_paused_reason_chk";
--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_paused_reason_chk" CHECK ("paused_reason" IS NULL OR ("paused_reason" IN ('waiting_for_connectors') AND "enabled" = false));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cron_jobs_company_package_slug_idx" ON "cron_jobs" ("company_id", "package_slug");
--> statement-breakpoint
DROP INDEX IF EXISTS "agents_company_package_slug_uidx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agents_company_package_slug_idx" ON "agents" ("company_id", "package_slug") WHERE "package_slug" is not null;
