-- W4GAP: delivery status of the handoff staff notification. The worker stores
-- the wamid when it sends the WhatsApp notification; the WhatsApp webhook's
-- statuses[] (delivered/read/failed) then move the status forward only.
ALTER TABLE "handoff_requests" ADD COLUMN IF NOT EXISTS "notification_message_id" text;--> statement-breakpoint
ALTER TABLE "handoff_requests" ADD COLUMN IF NOT EXISTS "notification_status" text;--> statement-breakpoint
ALTER TABLE "handoff_requests" ADD COLUMN IF NOT EXISTS "notification_status_at" timestamp;--> statement-breakpoint
ALTER TABLE "handoff_requests" ADD COLUMN IF NOT EXISTS "notification_error" jsonb;--> statement-breakpoint
ALTER TABLE "handoff_requests" DROP CONSTRAINT IF EXISTS "handoff_requests_notification_status_chk";--> statement-breakpoint
ALTER TABLE "handoff_requests" ADD CONSTRAINT "handoff_requests_notification_status_chk" CHECK (notification_status IS NULL OR notification_status IN ('sent', 'delivered', 'read', 'failed'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "handoff_requests_notification_message_id_idx" ON "handoff_requests" USING btree ("notification_message_id") WHERE "handoff_requests"."notification_message_id" IS NOT NULL;
