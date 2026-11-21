-- S37: per-company Home tile configuration (panel-chat-removal-and-home spec,
-- decision 4). No rows = the default arrangement; Edit Home (S106) writes rows.
-- Reverse: down/0037_company_home_tiles.sql.
CREATE TABLE IF NOT EXISTS "company_home_tiles" (
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "tile_key" text NOT NULL,
  "visible" boolean DEFAULT true NOT NULL,
  "position" integer DEFAULT 0 NOT NULL,
  "visibility" text DEFAULT 'everyone' NOT NULL,
  "required_permission" text,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "company_home_tiles_pk" PRIMARY KEY ("company_id", "tile_key"),
  CONSTRAINT "company_home_tiles_tile_key_chk" CHECK (tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map')),
  CONSTRAINT "company_home_tiles_visibility_chk" CHECK ((visibility = 'requires' AND required_permission IN ('operator', 'agents', 'messaging', 'analytics')) OR (visibility IN ('everyone', 'owners_only') AND required_permission IS NULL))
);
