-- S102: browser push for Needs you. One row per browser that turned
-- notifications on, plus one row per item already pushed to it (the dedupe
-- claim). Reverse: down/0047_push_subscriptions.sql.
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE ("endpoint")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_deliveries" (
  "subscription_id" uuid NOT NULL REFERENCES "push_subscriptions"("id") ON DELETE cascade,
  "item_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_deliveries_subscription_id_item_id_pk" PRIMARY KEY ("subscription_id", "item_id")
);
