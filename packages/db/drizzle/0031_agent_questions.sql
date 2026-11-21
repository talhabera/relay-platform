-- S24: agent_questions, the blocking Agent question entity (checkpoints spec
-- decisions 8-12). Additive. Reverse: down/0031_agent_questions.sql.
CREATE TABLE IF NOT EXISTS "agent_questions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "chat_id" uuid REFERENCES "chats"("id") ON DELETE cascade,
  "cron_run_id" uuid REFERENCES "cron_runs"("id") ON DELETE cascade,
  "question" text NOT NULL,
  "suggested_answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "answer" text,
  "answered_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "answered_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "agent_questions_parent_chk" CHECK ((chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL)),
  CONSTRAINT "agent_questions_status_chk" CHECK (status IN ('open', 'answered')),
  CONSTRAINT "agent_questions_answer_chk" CHECK ((status = 'open' AND answer IS NULL) OR (status = 'answered' AND answer IS NOT NULL AND answered_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_questions_chat_id_idx" ON "agent_questions" ("chat_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_questions_cron_run_id_idx" ON "agent_questions" ("cron_run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_questions_open_company_idx" ON "agent_questions" ("company_id") WHERE "status" = 'open';
