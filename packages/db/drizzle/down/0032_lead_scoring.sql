-- Reverses 0032_lead_scoring.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0032 row from
-- drizzle.__drizzle_migrations. Leads copied from "leads" are removed (the
-- "leads" table still holds them), lead statuses written since are lost, and
-- scores set on the 0..100 scale are divided back down (rounded).
DELETE FROM "company_records" r USING "leads" l WHERE r."id" = l."id";
--> statement-breakpoint
UPDATE "company_records" SET "status" = 'researched'
  WHERE "status" IN ('gathered', 'qualified', 'borderline', 'rejected', 'contacted', 'delivered');
--> statement-breakpoint
UPDATE "company_records" SET "status" = 'qualified' WHERE "status" = 'interested';
--> statement-breakpoint
UPDATE "lead_events" SET "from_status" = 'qualified' WHERE "from_status" = 'interested';
--> statement-breakpoint
UPDATE "lead_events" SET "to_status" = 'qualified' WHERE "to_status" = 'interested';
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_score_chk";
--> statement-breakpoint
UPDATE "company_records" SET "score" = round("score" / 10.0) WHERE "score" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_records" ADD CONSTRAINT "company_records_score_chk" CHECK (score IS NULL OR (score >= 0 AND score <= 10));
--> statement-breakpoint
DROP INDEX IF EXISTS "company_records_chat_id_uidx";
--> statement-breakpoint
DROP INDEX IF EXISTS "company_records_company_phone_uidx";
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_source_chk";
--> statement-breakpoint
ALTER TABLE "company_records" DROP CONSTRAINT IF EXISTS "company_records_chat_id_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "company_records"
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "source",
  DROP COLUMN IF EXISTS "chat_id",
  DROP COLUMN IF EXISTS "referral",
  DROP COLUMN IF EXISTS "fit_reasons",
  DROP COLUMN IF EXISTS "reject_reason",
  DROP COLUMN IF EXISTS "intake_complete",
  DROP COLUMN IF EXISTS "first_delivered_at",
  DROP COLUMN IF EXISTS "notified_at";
