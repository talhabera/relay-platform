-- S12: client role on company memberships (spec 2026-10-02-client-role-and-portal).
-- Existing rows become members.
ALTER TABLE "company_members" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'member' NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "company_members" ADD CONSTRAINT "company_members_role_check" CHECK ("role" IN ('member', 'client'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
