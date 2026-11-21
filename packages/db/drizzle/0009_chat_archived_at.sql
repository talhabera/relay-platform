ALTER TABLE "chats" ADD COLUMN "archived_at" timestamptz;
--> statement-breakpoint
CREATE INDEX "chats_company_id_archived_at_idx" ON "chats" ("company_id", "archived_at");
