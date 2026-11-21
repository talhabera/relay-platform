-- Structured leads (lead capture). One row per customer conversation;
-- unique chat_id makes captureLead an upsert. agent_id / chat_id are SET NULL
-- so a deleted agent or chat does not erase a lead that may already be billed.
CREATE TABLE IF NOT EXISTS "leads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "chat_id" uuid REFERENCES "chats"("id") ON DELETE set null,
  "channel_type" text NOT NULL,
  "tip" text,
  "m2" text,
  "lokasyon" text,
  "butce" text,
  "iletisim" text,
  "skor" integer,
  "kod" text,
  "status" text DEFAULT 'new' NOT NULL,
  "notified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "leads_skor_chk" CHECK (skor IS NULL OR (skor >= 1 AND skor <= 10))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "leads_chat_id_uidx" ON "leads" ("chat_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_company_id_status_idx" ON "leads" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_agent_id_created_at_idx" ON "leads" ("agent_id", "created_at");
--> statement-breakpoint
-- Recipient of the "lead qualified" WhatsApp message. Null = notifications off.
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "lead_notify_whatsapp" text;
