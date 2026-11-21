-- S04: operator session status + last activity (plan S04, spec 2026-10-02-needs-you-ordering).
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'completed' NOT NULL;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
-- Backfill: last activity is the newest message, else the chat's creation.
UPDATE "chats" c SET "last_activity_at" = COALESCE(
  (SELECT max(m."created_at") FROM "messages" m WHERE m."chat_id" = c."id"),
  c."created_at"
);
--> statement-breakpoint
-- Sessions with an open checkpoint wait on a person.
UPDATE "chats" c SET "status" = 'needs_you'
WHERE c."channel_type" = 'operator'
  AND EXISTS (
    SELECT 1 FROM "checkpoints" k
    WHERE k."chat_id" = c."id"
      AND k."status" IN ('pending', 'stale', 'failed')
      AND k."superseded_by" IS NULL
  );
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chats_company_id_last_activity_at_idx" ON "chats" USING btree ("company_id","last_activity_at");
