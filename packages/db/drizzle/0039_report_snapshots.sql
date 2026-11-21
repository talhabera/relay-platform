-- S86-87: report_snapshots, the frozen numbers of each closed day, week and
-- month in company time (spec 2026-10-02-report-snapshots-and-live-feed).
-- Only "narrative" may change after insert; the trigger refuses the rest.
-- Reverse: down/0039_report_snapshots.sql.
CREATE TABLE IF NOT EXISTS "report_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "period" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "metrics" jsonb NOT NULL,
  "series" jsonb DEFAULT '{"delivered":[],"funnel":[]}'::jsonb NOT NULL,
  "narrative" jsonb,
  "frozen_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "report_snapshots_period_chk" CHECK (period IN ('daily', 'weekly', 'monthly')),
  CONSTRAINT "report_snapshots_range_chk" CHECK (period_end > period_start)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_snapshots_company_period_start_uidx" ON "report_snapshots" ("company_id", "period", "period_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_snapshots_period_start_idx" ON "report_snapshots" ("period", "period_start");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "report_snapshots_frozen"() RETURNS trigger AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.period IS DISTINCT FROM OLD.period
    OR NEW.period_start IS DISTINCT FROM OLD.period_start
    OR NEW.period_end IS DISTINCT FROM OLD.period_end
    OR NEW.metrics IS DISTINCT FROM OLD.metrics
    OR NEW.series IS DISTINCT FROM OLD.series
    OR NEW.frozen_at IS DISTINCT FROM OLD.frozen_at THEN
    RAISE EXCEPTION 'report_snapshots rows are frozen; only narrative may change';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "report_snapshots_frozen_trg" ON "report_snapshots";
--> statement-breakpoint
CREATE TRIGGER "report_snapshots_frozen_trg" BEFORE UPDATE ON "report_snapshots" FOR EACH ROW EXECUTE FUNCTION "report_snapshots_frozen"();
