-- Home tile catalog gains ad_report (Koleva reklam: ad spend, leads, sales and
-- cash per channel). Widens the tile_key CHECK that 0050 last set so Edit Home
-- can save an ad_report row.
-- Reverse: down/0054_home_tile_ad_report.sql.
ALTER TABLE "company_home_tiles" DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk";
--> statement-breakpoint
ALTER TABLE "company_home_tiles" ADD CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map', 'daily_brief', 'my_tasks', 'ad_report'));
