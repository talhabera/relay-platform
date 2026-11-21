ALTER TABLE "knowledge_base" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "knowledge_base" ADD COLUMN "error_message" text;