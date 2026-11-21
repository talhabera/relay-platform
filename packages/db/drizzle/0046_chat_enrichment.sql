-- S83: post-chat enrichment on customer conversations (Inbox Sentiment card,
-- Duration and Language rows). Written by the worker cron's enrichment sweep.
-- Reverse: down/0046_chat_enrichment.sql.
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "sentiment" text;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "sentiment_score" integer;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "language" text;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "duration_seconds" integer;
--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "enriched_through" timestamp;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_sentiment_chk" CHECK (sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "chats" ADD CONSTRAINT "chats_sentiment_score_chk" CHECK (sentiment_score IS NULL OR sentiment_score BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
