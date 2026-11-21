DROP TABLE IF EXISTS "verifications";--> statement-breakpoint
DROP TABLE IF EXISTS "sessions";--> statement-breakpoint
DROP TABLE IF EXISTS "accounts";--> statement-breakpoint
UPDATE "users" SET "email" = lower("email");
