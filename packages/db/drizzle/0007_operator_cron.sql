CREATE TABLE "cron_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prompt" text NOT NULL,
	"schedule_kind" text NOT NULL,
	"interval_minutes" integer,
	"weekday" integer,
	"time_of_day" integer,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_fire_at" timestamp NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text NOT NULL,
	"fire_at" timestamp NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"error" text,
	"anthropic_batch_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cron_run_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"content" text NOT NULL,
	"role" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pending_tool_calls" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_tool_calls" ADD COLUMN "cron_run_id" uuid;--> statement-breakpoint
ALTER TABLE "session_files" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_files" ADD COLUMN "cron_run_id" uuid;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_version_id_agent_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_jobs" ADD CONSTRAINT "cron_jobs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_runs" ADD CONSTRAINT "cron_runs_job_id_cron_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."cron_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cron_run_messages" ADD CONSTRAINT "cron_run_messages_run_id_cron_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tool_calls" ADD CONSTRAINT "pending_tool_calls_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_files" ADD CONSTRAINT "session_files_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_tool_calls" ADD CONSTRAINT "pending_tool_calls_parent_chk" CHECK ((chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL));--> statement-breakpoint
ALTER TABLE "session_files" ADD CONSTRAINT "session_files_parent_chk" CHECK ((chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL));--> statement-breakpoint
CREATE INDEX "cron_jobs_company_id_idx" ON "cron_jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "cron_jobs_next_fire_at_idx" ON "cron_jobs" USING btree ("next_fire_at");--> statement-breakpoint
CREATE INDEX "cron_runs_job_id_idx" ON "cron_runs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "cron_runs_status_idx" ON "cron_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cron_run_messages_run_id_idx" ON "cron_run_messages" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "pending_tool_calls_cron_run_id_idx" ON "pending_tool_calls" USING btree ("cron_run_id");
