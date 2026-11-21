-- RL8a (RELAY-166): ad_change_log, the append-only ledger of every ad change
-- Relay asks a platform to make. applyAdChange writes an intent row under the
-- company's cap lock before the platform call and a result row after it; an
-- unresolved intent is the reservation the next cap check sees. Triggers
-- refuse UPDATE, DELETE and TRUNCATE; company_id is ON DELETE restrict so a
-- cascade can never erase the ledger.
-- Reverse: down/0055_ad_change_log.sql.
CREATE TABLE IF NOT EXISTS "ad_change_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE restrict,
  "change_id" uuid NOT NULL,
  "phase" text NOT NULL,
  "platform" text NOT NULL,
  "account_id" text NOT NULL,
  "campaign_id" text NOT NULL,
  "campaign_name" text,
  "action" text NOT NULL,
  "before_value" jsonb,
  "after_value" jsonb,
  "delta_minor" bigint DEFAULT 0 NOT NULL,
  "daily_total_after_minor" bigint,
  "actor_type" text NOT NULL,
  "actor_agent_id" uuid,
  "actor_user_id" text,
  "autonomous" boolean DEFAULT false NOT NULL,
  "checkpoint_id" uuid,
  "attempt" integer,
  "reverses_change_id" uuid,
  "reason_text" text NOT NULL,
  "reason_metric" text,
  "reason_value" double precision,
  "reason_threshold" double precision,
  "outcome" text,
  "outcome_code" text,
  "outcome_detail" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ad_change_log_phase_value_chk" CHECK (phase IN ('intent', 'result')),
  CONSTRAINT "ad_change_log_platform_chk" CHECK (platform IN ('google', 'meta')),
  CONSTRAINT "ad_change_log_action_chk" CHECK (action IN ('pause', 'resume', 'set_daily_budget', 'add_keyword', 'add_negative_keyword', 'update_ad_copy')),
  CONSTRAINT "ad_change_log_actor_type_chk" CHECK (actor_type IN ('agent', 'human')),
  CONSTRAINT "ad_change_log_outcome_value_chk" CHECK (outcome IS NULL OR outcome IN ('applied', 'rejected', 'failed')),
  CONSTRAINT "ad_change_log_outcome_code_chk" CHECK (outcome_code IS NULL OR outcome_code IN ('cap_exceeded', 'cap_unset', 'platform_unreachable', 'platform_error', 'no_such_campaign')),
  CONSTRAINT "ad_change_log_outcome_detail_chk" CHECK (outcome_detail IS NULL OR char_length(outcome_detail) <= 300),
  CONSTRAINT "ad_change_log_outcome_chk" CHECK ((phase = 'intent') = (outcome IS NULL)),
  CONSTRAINT "ad_change_log_reason_chk" CHECK (actor_type <> 'agent' OR (reason_metric IS NOT NULL AND reason_value IS NOT NULL AND reason_threshold IS NOT NULL)),
  CONSTRAINT "ad_change_log_actor_chk" CHECK ((actor_type <> 'agent' OR actor_agent_id IS NOT NULL) AND (actor_type <> 'human' OR actor_user_id IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_change_log_change_phase_uidx" ON "ad_change_log" ("change_id", "phase");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ad_change_log_checkpoint_attempt_phase_uidx" ON "ad_change_log" ("checkpoint_id", "attempt", "phase") WHERE checkpoint_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_change_log_company_seq_idx" ON "ad_change_log" ("company_id", "seq");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ad_change_log_company_intent_created_idx" ON "ad_change_log" ("company_id", "created_at") WHERE phase = 'intent';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ad_change_log_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ad_change_log is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ad_change_log_no_update_trg" ON "ad_change_log";
--> statement-breakpoint
CREATE TRIGGER "ad_change_log_no_update_trg" BEFORE UPDATE ON "ad_change_log" FOR EACH ROW EXECUTE FUNCTION "ad_change_log_immutable"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ad_change_log_no_delete_trg" ON "ad_change_log";
--> statement-breakpoint
CREATE TRIGGER "ad_change_log_no_delete_trg" BEFORE DELETE ON "ad_change_log" FOR EACH ROW EXECUTE FUNCTION "ad_change_log_immutable"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ad_change_log_no_truncate_trg" ON "ad_change_log";
--> statement-breakpoint
CREATE TRIGGER "ad_change_log_no_truncate_trg" BEFORE TRUNCATE ON "ad_change_log" FOR EACH STATEMENT EXECUTE FUNCTION "ad_change_log_immutable"();
