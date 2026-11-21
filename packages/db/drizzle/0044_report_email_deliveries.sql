-- S88: report_email_deliveries, one row per report email to one client user.
-- The report archive reads it for Emailed / Delivered and Sent-to.
-- Reverse: down/0044_report_email_deliveries.sql.
CREATE TABLE IF NOT EXISTS "report_email_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "snapshot_id" uuid NOT NULL REFERENCES "report_snapshots"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "user_id" text REFERENCES "users"("id") ON DELETE set null,
  "email" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "provider_message_id" text,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "sent_at" timestamp with time zone,
  CONSTRAINT "report_email_deliveries_status_chk" CHECK (status IN ('pending', 'sent', 'failed', 'delivered', 'bounced'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "report_email_deliveries_snapshot_email_uidx" ON "report_email_deliveries" ("snapshot_id", "email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_email_deliveries_company_idx" ON "report_email_deliveries" ("company_id");
