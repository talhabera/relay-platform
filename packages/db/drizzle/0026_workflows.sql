-- S11: workflows and workflow stages (spec 2026-10-02-workflow-stage-model).
-- Display grouping only; rows come from package installs (S81).
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"package_slug" text NOT NULL,
	"name" text NOT NULL,
	"flow" text DEFAULT 'sequence' NOT NULL,
	"weekly_target" integer,
	"target_metric_key" text,
	"inbound_stage_id" uuid,
	"intake" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflows_weekly_target_chk" CHECK (weekly_target IS NULL OR weekly_target >= 0),
	CONSTRAINT "workflows_flow_check" CHECK ("flow" IN ('sequence', 'parallel'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"name" text NOT NULL,
	"agent_id" uuid,
	"metric_key" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "workflows" ADD CONSTRAINT "workflows_inbound_stage_id_workflow_stages_id_fk" FOREIGN KEY ("inbound_stage_id") REFERENCES "public"."workflow_stages"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_company_id_position_idx" ON "workflows" USING btree ("company_id","position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_stages_workflow_id_order_uidx" ON "workflow_stages" USING btree ("workflow_id","order");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_stages_agent_id_idx" ON "workflow_stages" USING btree ("agent_id");
