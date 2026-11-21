-- Reverses 0054_home_tile_ad_report.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0054 row from
-- drizzle.__drizzle_migrations. Drops ad_report rows first so the narrower
-- CHECK can be added back.
DELETE FROM "company_home_tiles" WHERE "tile_key" = 'ad_report';
--> statement-breakpoint
ALTER TABLE "company_home_tiles" DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk";
--> statement-breakpoint
ALTER TABLE "company_home_tiles" ADD CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map', 'daily_brief', 'my_tasks'));
