-- Koleva work: projects and tasks, company-owned work the Daily Manager brief
-- reads. tasks.due_date is the company-local YYYY-MM-DD, like
-- daily_briefs.local_date. Additive.
-- Reverse: down/0049_projects_tasks.sql.
CREATE TABLE IF NOT EXISTS "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'active' NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "projects_status_chk" CHECK (status IN ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "projects_company_status_idx" ON "projects" ("company_id", "status");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid REFERENCES "projects"("id") ON DELETE set null,
  "title" text NOT NULL,
  "notes" text,
  "status" text DEFAULT 'todo' NOT NULL,
  "priority" text DEFAULT 'normal' NOT NULL,
  "assignee_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "due_date" text,
  "recurrence" text DEFAULT 'none' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "brief_id" uuid REFERENCES "daily_briefs"("id") ON DELETE set null,
  "created_by_user_id" text REFERENCES "users"("id") ON DELETE set null,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "tasks_status_chk" CHECK (status IN ('todo', 'doing', 'blocked', 'done')),
  CONSTRAINT "tasks_priority_chk" CHECK (priority IN ('high', 'normal', 'low')),
  CONSTRAINT "tasks_recurrence_chk" CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly')),
  CONSTRAINT "tasks_source_chk" CHECK (source IN ('manual', 'brief'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_company_status_idx" ON "tasks" ("company_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_company_due_date_idx" ON "tasks" ("company_id", "due_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tasks_project_id_idx" ON "tasks" ("project_id");
