-- Reverses 0043_client_profile_notifications.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0043 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "company_members" DROP COLUMN IF EXISTS "notifications_seen_at";
ALTER TABLE "company_members" DROP COLUMN IF EXISTS "report_email_opt_out";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_whatsapp_number_e164_chk";
ALTER TABLE "users" DROP COLUMN IF EXISTS "whatsapp_number";
