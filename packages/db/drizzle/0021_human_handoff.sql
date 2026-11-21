-- Human handoff (spec 2026-10-02-human-handoff). Per-agent settings, handoff
-- requests, and the human author on messages. Reverse: down/0021_human_handoff.sql.
CREATE TABLE IF NOT EXISTS "agent_handoff_settings" (
  "agent_id" uuid PRIMARY KEY NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "mode" text DEFAULT 'quick_answer' NOT NULL,
  "trigger_price_not_listed" boolean DEFAULT true NOT NULL,
  "trigger_asks_for_person" boolean DEFAULT true NOT NULL,
  "trigger_complaint_or_refund" boolean DEFAULT true NOT NULL,
  "trigger_low_confidence" boolean DEFAULT true NOT NULL,
  "recipient_name" text,
  "recipient_whatsapp" text,
  "recipient_confirmed" boolean DEFAULT false NOT NULL,
  "recipient_confirmed_at" timestamp,
  "expiry_minutes" integer DEFAULT 120 NOT NULL,
  "default_reply" text DEFAULT 'agent' NOT NULL,
  "recipient_can_take_over" boolean DEFAULT false NOT NULL,
  "waiting_text" text,
  "if_nobody_answers" text DEFAULT 'reply_here' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "agent_handoff_settings_expiry_chk" CHECK (expiry_minutes IN (30, 60, 120, 240))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_handoff_settings_company_id_idx" ON "agent_handoff_settings" ("company_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "chat_id" uuid NOT NULL REFERENCES "chats"("id") ON DELETE cascade,
  "status" text DEFAULT 'open' NOT NULL,
  "mode" text NOT NULL,
  "token_hash" text,
  "reason" text NOT NULL,
  "confidence" integer,
  "questions" jsonb NOT NULL,
  "suggested_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recipient_name" text,
  "recipient_whatsapp" text,
  "can_take_over" boolean DEFAULT false NOT NULL,
  "notified_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "answer" text,
  "reply_mode" text,
  "answered_at" timestamp,
  "taken_over_at" timestamp,
  "last_human_message_at" timestamp,
  "handed_back_at" timestamp,
  "hand_back_reason" text,
  "expired_at" timestamp,
  "link_closed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "handoff_requests_confidence_chk" CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100)),
  CONSTRAINT "handoff_requests_token_chk" CHECK (mode = 'team_chat' OR token_hash IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "handoff_requests_token_hash_uidx" ON "handoff_requests" ("token_hash");
--> statement-breakpoint
-- One open request per conversation; later questions append to it.
CREATE UNIQUE INDEX IF NOT EXISTS "handoff_requests_chat_open_uidx" ON "handoff_requests" ("chat_id") WHERE "handoff_requests"."status" = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_requests_chat_id_idx" ON "handoff_requests" ("chat_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_requests_company_id_status_idx" ON "handoff_requests" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_requests_status_expires_at_idx" ON "handoff_requests" ("status", "expires_at");
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "author" text;
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "author_display_name" text;
--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_human_display_name_chk";
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_human_display_name_chk" CHECK (author IS DISTINCT FROM 'human' OR author_display_name IS NOT NULL);
