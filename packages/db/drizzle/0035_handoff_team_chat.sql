-- S109 Team chat (human handoff spec decision 11): one WhatsApp group per
-- customer agent, and each Team chat question as posted in the group.
-- Reverse: down/0035_handoff_team_chat.sql.
CREATE TABLE IF NOT EXISTS "handoff_team_chat_groups" (
  "agent_id" uuid PRIMARY KEY NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "phone_number_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "subject" text NOT NULL,
  "create_request_id" text,
  "group_id" text,
  "invite_link" text,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_team_chat_groups_company_id_idx" ON "handoff_team_chat_groups" ("company_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "handoff_team_chat_groups_group_id_uidx" ON "handoff_team_chat_groups" ("group_id") WHERE "group_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_team_chat_groups_create_request_id_idx" ON "handoff_team_chat_groups" ("create_request_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "handoff_team_chat_questions" (
  "request_id" uuid PRIMARY KEY NOT NULL REFERENCES "handoff_requests"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "group_id" text NOT NULL,
  "message_id" text NOT NULL,
  "code" text NOT NULL,
  "answered_by_wa_id" text,
  "answered_by_name" text,
  "answer_message_id" text,
  "confirmation_message_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "handoff_team_chat_questions_message_id_uidx" ON "handoff_team_chat_questions" ("message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "handoff_team_chat_questions_group_code_uidx" ON "handoff_team_chat_questions" ("group_id", "code");
