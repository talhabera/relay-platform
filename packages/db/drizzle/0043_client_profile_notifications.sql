-- S107: client profile + Notifications (spec client-role-and-portal,
-- decisions 8 and 10). WhatsApp number on the user profile, report-email
-- opt-out and bell read marker on the client membership row.
-- Reverse: down/0043_client_profile_notifications.sql.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "whatsapp_number" text;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_whatsapp_number_e164_chk";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_whatsapp_number_e164_chk" CHECK (whatsapp_number IS NULL OR whatsapp_number ~ '^\+[1-9][0-9]{6,14}$');--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN IF NOT EXISTS "report_email_opt_out" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company_members" ADD COLUMN IF NOT EXISTS "notifications_seen_at" timestamp;
