-- Retire the "chat" page permission (Panel Chat removed; /home is never page-gated).
ALTER TABLE "company_members" ALTER COLUMN "page_permissions" SET DEFAULT '{"operator":true,"agents":false,"messaging":false,"analytics":false}'::jsonb;
--> statement-breakpoint
UPDATE "company_members" SET "page_permissions" = "page_permissions" - 'chat' WHERE "page_permissions" ? 'chat';
