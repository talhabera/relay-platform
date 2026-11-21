-- Postgres-backed rate limiting (no Redis: see AGENTS.md). Counters hold
-- sliding-window request counts; leases hold in-flight streams for
-- concurrency caps. Both are pruned by the cron service via expires_at.
CREATE TABLE IF NOT EXISTS "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamptz NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamptz NOT NULL,
	CONSTRAINT "rate_limit_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_counters_expires_idx" ON "rate_limit_counters" ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rate_limit_leases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"expires_at" timestamptz NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_leases_key_idx" ON "rate_limit_leases" ("key","expires_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_leases_expires_idx" ON "rate_limit_leases" ("expires_at");
