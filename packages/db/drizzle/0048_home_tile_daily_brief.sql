-- Home tile catalog gains daily_brief (Daily Manager package). Widens the
-- tile_key CHECK that 0037 created so Edit Home can save a daily_brief row.
-- Reverse: down/0048_home_tile_daily_brief.sql.
ALTER TABLE "company_home_tiles" DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk";
--> statement-breakpoint
ALTER TABLE "company_home_tiles" ADD CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map', 'daily_brief'));
