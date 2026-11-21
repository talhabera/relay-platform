-- Reverses 0025_company_member_role.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0025 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "company_members" DROP CONSTRAINT IF EXISTS "company_members_role_check";
--> statement-breakpoint
ALTER TABLE "company_members" DROP COLUMN IF EXISTS "role";
