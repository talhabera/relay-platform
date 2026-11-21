ALTER TABLE "agents" ADD COLUMN "package_slug" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "agents_company_package_slug_uidx"
  ON "agents" ("company_id", "package_slug")
  WHERE "package_slug" is not null;
--> statement-breakpoint
CREATE TABLE "company_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source_agent_id" uuid,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"score" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"researched_at" timestamp,
	"next_follow_up_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_records_score_chk" CHECK (score IS NULL OR (score >= 0 AND score <= 10))
);
--> statement-breakpoint
CREATE INDEX "company_records_company_id_idx" ON "company_records" ("company_id");
--> statement-breakpoint
CREATE INDEX "company_records_company_id_next_follow_up_at_idx" ON "company_records" ("company_id", "next_follow_up_at");
--> statement-breakpoint
CREATE INDEX "company_records_company_id_status_idx" ON "company_records" ("company_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "company_records_company_domain_uidx"
  ON "company_records" ("company_id", "domain")
  WHERE "domain" is not null;
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"chat_id" uuid,
	"cron_run_id" uuid,
	"record_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"endpoint_snapshot" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"execute_result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_user_id" text,
	CONSTRAINT "pending_actions_parent_chk" CHECK ((chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "pending_actions_cron_run_id_idx" ON "pending_actions" ("cron_run_id");
--> statement-breakpoint
CREATE INDEX "pending_actions_record_id_idx" ON "pending_actions" ("record_id");
--> statement-breakpoint
CREATE INDEX "pending_actions_pending_idx" ON "pending_actions" ("status") WHERE "status" = 'pending';
--> statement-breakpoint
ALTER TABLE "company_records" ADD CONSTRAINT "company_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_records" ADD CONSTRAINT "company_records_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_record_id_company_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."company_records"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
