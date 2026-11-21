-- S104: inbound intake. Customer agents get a per-agent Lead capture toggle and
-- the workflow it feeds (lead scoring spec, decisions 8-10); `captureLead`
-- becomes `record_lead` and writes company_records instead of `leads`.
--
-- 1. agents.lead_capture_enabled + agents.lead_capture_workflow_id.
-- 2. `captureLead` was registered for every customer agent, so every existing
--    customer agent gets Lead capture on, with no workflow (the runtime then
--    keeps the old tip/m2/lokasyon/butce/iletisim checklist). Runs once, keyed
--    on the column being new, so an owner who turns it off stays off.
-- 3. The 0032 copy of `leads` into company_records runs again for leads
--    written between 0032 and this release (idempotent by id).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'lead_capture_enabled'
  ) THEN
    ALTER TABLE "agents" ADD COLUMN "lead_capture_enabled" boolean DEFAULT false NOT NULL;
    UPDATE "agents" SET "lead_capture_enabled" = true WHERE "kind" = 'customer';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "lead_capture_workflow_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "agents" ADD CONSTRAINT "agents_lead_capture_workflow_id_workflows_id_fk" FOREIGN KEY ("lead_capture_workflow_id") REFERENCES "public"."workflows"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
-- Backfill again (0032, decision 17). Same id as the `leads` row, so S110 and the count
-- check can join the two. Intake answers (5 fields + kod) and the old skor x10
-- go into payload.intake; the fit score stays null.
INSERT INTO "company_records" (
  "id", "company_id", "source_agent_id", "entity_type", "name", "domain",
  "payload", "score", "status", "source", "chat_id", "intake_complete",
  "notified_at", "created_at", "updated_at"
)
SELECT
  l."id",
  l."company_id",
  l."agent_id",
  'person',
  COALESCE(NULLIF(btrim(l."iletisim"), ''), NULLIF(btrim(l."tip"), ''), 'Lead'),
  NULL,
  jsonb_build_object(
    'intake', jsonb_strip_nulls(jsonb_build_object(
      'tip', l."tip",
      'm2', l."m2",
      'lokasyon', l."lokasyon",
      'butce', l."butce",
      'iletisim', l."iletisim",
      'kod', l."kod",
      'skor', l."skor" * 10
    )),
    'migratedFrom', 'leads'
  ),
  NULL,
  CASE l."status"
    WHEN 'qualified' THEN 'qualified'
    WHEN 'rejected' THEN 'rejected'
    ELSE 'gathered'
  END,
  l."channel_type",
  l."chat_id",
  (l."tip" IS NOT NULL AND l."m2" IS NOT NULL AND l."lokasyon" IS NOT NULL
    AND l."butce" IS NOT NULL AND l."iletisim" IS NOT NULL),
  l."notified_at",
  l."created_at",
  l."updated_at"
FROM "leads" l
WHERE NOT EXISTS (SELECT 1 FROM "company_records" r WHERE r."id" = l."id");
--> statement-breakpoint
-- One creation event per copied lead, matching the 0028 backfill: credit the
-- agent that captured it, else the company owner, at its last update.
INSERT INTO "lead_events" ("company_id", "record_id", "from_status", "to_status", "agent_id", "user_id", "at")
SELECT r."company_id", r."id", NULL, r."status", r."source_agent_id",
       CASE WHEN r."source_agent_id" IS NULL THEN co."owner_id" END,
       r."updated_at"
FROM "company_records" r
JOIN "leads" l ON l."id" = r."id"
JOIN "companies" co ON co."id" = r."company_id"
WHERE NOT EXISTS (SELECT 1 FROM "lead_events" e WHERE e."record_id" = r."id");
