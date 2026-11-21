-- Home tile catalog gains my_tasks (the signed-in user's open tasks). Widens
-- the tile_key CHECK that 0048 last set so Edit Home can save a my_tasks row.
-- Reverse: down/0050_home_tile_my_tasks.sql.
ALTER TABLE "company_home_tiles" DROP CONSTRAINT IF EXISTS "company_home_tiles_tile_key_chk";
--> statement-breakpoint
ALTER TABLE "company_home_tiles" ADD CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map', 'daily_brief', 'my_tasks'));
