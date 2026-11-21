CREATE TABLE "token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"identifier_type" text NOT NULL,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"week_start" date NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "token_usage_identifier_week_idx" UNIQUE("identifier","identifier_type","week_start")
);
--> statement-breakpoint
CREATE INDEX "token_usage_lookup_idx" ON "token_usage" USING btree ("identifier","identifier_type","week_start");