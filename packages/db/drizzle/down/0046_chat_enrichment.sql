-- Reverses 0046_chat_enrichment.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0046 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "chats_sentiment_score_chk";
ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "chats_sentiment_chk";
ALTER TABLE "chats" DROP COLUMN IF EXISTS "enriched_through";
ALTER TABLE "chats" DROP COLUMN IF EXISTS "duration_seconds";
ALTER TABLE "chats" DROP COLUMN IF EXISTS "language";
ALTER TABLE "chats" DROP COLUMN IF EXISTS "sentiment_score";
ALTER TABLE "chats" DROP COLUMN IF EXISTS "sentiment";
