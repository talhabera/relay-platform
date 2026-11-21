CREATE TABLE "instagram_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"ig_comment_id" text NOT NULL,
	"ig_media_id" text NOT NULL,
	"parent_ig_comment_id" text,
	"from_ig_user_id" text,
	"from_username" text,
	"content" text NOT NULL,
	"commented_at" timestamptz NOT NULL,
	"public_reply_ig_id" text,
	"public_replied_at" timestamptz,
	"private_reply_ig_id" text,
	"private_reply_sent_at" timestamptz,
	"raw" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "instagram_comments_ig_comment_id_idx" ON "instagram_comments" ("ig_comment_id");
--> statement-breakpoint
CREATE INDEX "instagram_comments_agent_id_commented_at_idx" ON "instagram_comments" ("agent_id", "commented_at");
--> statement-breakpoint
CREATE INDEX "instagram_comments_ig_media_id_idx" ON "instagram_comments" ("ig_media_id");
--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "instagram_comments" ADD CONSTRAINT "instagram_comments_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "channels_instagram_account_id_idx"
  ON "channels" (("config"->>'accountId')) WHERE "type" = 'instagram';
