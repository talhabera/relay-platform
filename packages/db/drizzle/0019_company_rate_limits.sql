-- Per-company rate-limit settings (Company → Rate limits). Policy name to
-- limit; an absent key means the platform default. Values are sanitised and
-- clamped by the app on every read, so this column needs no CHECK.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "rate_limits" jsonb DEFAULT '{}'::jsonb NOT NULL;
