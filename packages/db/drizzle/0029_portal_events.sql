-- S101: portal_events, the append-only Live feed (spec
-- 2026-10-02-report-snapshots-and-live-feed). Reverse: down/0029_portal_events.sql.
CREATE TABLE IF NOT EXISTS "portal_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "at" timestamp DEFAULT now() NOT NULL,
  "title" text NOT NULL,
  "detail" text DEFAULT '' NOT NULL,
  "channel" text,
  "ref_id" text,
  CONSTRAINT "portal_events_type_chk" CHECK (type IN ('lead_inbound_qualified', 'lead_delivered', 'handoff_sent', 'conversation_started', 'site_visit_booked', 'review_new'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_events_company_id_at_idx" ON "portal_events" ("company_id", "at" DESC);
