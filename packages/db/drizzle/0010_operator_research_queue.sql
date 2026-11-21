ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "integrations_type_check";
--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_company_id_operator_type_uidx"
  ON "integrations" ("company_id", "type")
  WHERE "type" IN ('hunter', 'snov', 'google_places');
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN "research_attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN "research_last_error" text;
--> statement-breakpoint
ALTER TABLE "company_records" ADD COLUMN "research_locked_at" timestamp;
--> statement-breakpoint
UPDATE "company_records" SET "status" = 'pending' WHERE "status" = 'new';
