ALTER TABLE "company_members" ADD COLUMN "page_permissions" jsonb DEFAULT '{"chat":true,"operator":true,"agents":false,"messaging":false,"analytics":false}'::jsonb NOT NULL;
