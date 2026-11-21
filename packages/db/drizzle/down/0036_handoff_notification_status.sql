-- Reverses 0036_handoff_notification_status.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0036 row from
-- drizzle.__drizzle_migrations.
DROP INDEX IF EXISTS "handoff_requests_notification_message_id_idx";
ALTER TABLE "handoff_requests" DROP CONSTRAINT IF EXISTS "handoff_requests_notification_status_chk";
ALTER TABLE "handoff_requests" DROP COLUMN IF EXISTS "notification_error";
ALTER TABLE "handoff_requests" DROP COLUMN IF EXISTS "notification_status_at";
ALTER TABLE "handoff_requests" DROP COLUMN IF EXISTS "notification_status";
ALTER TABLE "handoff_requests" DROP COLUMN IF EXISTS "notification_message_id";
