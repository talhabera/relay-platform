-- S26: lead scoring and one lead model (spec 2026-10-02-lead-scoring-and-intake).
--
-- 1. company_records gains the lead columns: phone (E.164), source, chat_id,
--    referral, fit reasons, reject reason, intake-complete flag,
--    first-delivered and notified timestamps.
-- 2. Fit score moves to 0..100: existing scores x10, check widened.
-- 3. The post-reply status `qualified` becomes `interested` (records and the
--    lead event log), freeing `qualified` for fit score >= 70.
-- 4. The #18 `leads` table is copied into company_records (decision 17) and
--    each copied lead gets one creation lead_events row. `leads` itself is not
--    touched: it stays as the read-only reference until the qualified count is
--    verified on preprod (S110 retires it).
--
-- Steps 2 and 3 run once, keyed on the old score check still being in place,
-- so a re-run never multiplies a score twice or renames a migrated lead. Step 4
-- skips leads already copied (same id), so a re-run is a no-op.
--
-- Migration invariant (billing): every lead with status 'qualified' in `leads`
-- is copied with status 'qualified', whatever its score. Its fit score is left
-- null (the old 1-10 skor was the customer agent's own rating, now intake
-- data), so no band rule can move it.
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "phone" text;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "source" text;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "chat_id" uuid;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "referral" jsonb;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "fit_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "reject_reason" text;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "intake_complete" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "first_delivered_at" timestamp;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN IF NOT EXISTS "notified_at" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "company_records" ADD CONSTRAINT "company_records_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "company_records" ADD CONSTRAINT "company_records_source_chk" CHECK (source IS NULL OR source IN ('outbound', 'whatsapp', 'instagram', 'widget', 'shopify', 'telegram', 'messenger'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_records_company_phone_uidx"
  ON "company_records" ("company_id", "phone")
  WHERE "phone" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_records_chat_id_uidx"
  ON "company_records" ("chat_id")
  WHERE "chat_id" IS NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'company_records_score_chk'
      AND pg_get_constraintdef(oid) LIKE '%<= 10)%'
  ) THEN
    ALTER TABLE "company_records" DROP CONSTRAINT "company_records_score_chk";
    UPDATE "company_records" SET "score" = "score" * 10 WHERE "score" IS NOT NULL;
    ALTER TABLE "company_records" ADD CONSTRAINT "company_records_score_chk" CHECK (score IS NULL OR (score >= 0 AND score <= 100));
    UPDATE "company_records" SET "status" = 'interested' WHERE "status" = 'qualified';
    UPDATE "lead_events" SET "from_status" = 'interested' WHERE "from_status" = 'qualified';
    UPDATE "lead_events" SET "to_status" = 'interested' WHERE "to_status" = 'qualified';
  END IF;
END $$;
--> statement-breakpoint
-- Backfill (decision 17). Same id as the `leads` row, so S110 and the count
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
