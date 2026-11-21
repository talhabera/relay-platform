-- S100: lead_events + companies.timezone (spec 2026-10-02-lead-attribution-and-weekly-target).
-- Every lead status change writes one lead_events row with exactly one actor.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'UTC' NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"record_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"agent_id" uuid,
	"user_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_events_one_actor_chk" CHECK (num_nonnulls(agent_id, user_id) = 1)
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_record_id_company_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."company_records"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_company_id_at_idx" ON "lead_events" USING btree ("company_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_record_id_at_idx" ON "lead_events" USING btree ("record_id","at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lead_events_agent_id_at_idx" ON "lead_events" USING btree ("agent_id","at");
--> statement-breakpoint
-- Backfill: one creation event per existing lead (from_status null, to_status
-- its current status, at its last update), credited to the agent that sourced
-- it, else to the company owner. Records that already have an event are
-- skipped, so a re-run is a no-op. S26 adds the same row for each lead it
-- migrates from "leads".
INSERT INTO "lead_events" ("company_id", "record_id", "from_status", "to_status", "agent_id", "user_id", "at")
SELECT r."company_id", r."id", NULL, r."status", r."source_agent_id",
       CASE WHEN r."source_agent_id" IS NULL THEN co."owner_id" END,
       r."updated_at"
FROM "company_records" r
JOIN "companies" co ON co."id" = r."company_id"
WHERE NOT EXISTS (SELECT 1 FROM "lead_events" e WHERE e."record_id" = r."id");
