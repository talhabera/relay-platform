-- Reverses 0048_home_tile_daily_brief.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0048 row from
-- drizzle.__drizzle_migrations. Drops daily_brief rows first so the narrower
-- CHECK can be added back.
DELETE FROM "company_home_tiles" WHERE "tile_key" = 'daily_brief';
--> statement-breakpoint
ALTER TABLE "company_home_tiles" DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk";
--> statement-breakpoint
ALTER TABLE "company_home_tiles" ADD CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map'));
