-- S60: change note on operator agent versions (Figma 07 agents-operator/versions-fork:
-- "Change note" in Fork a new version, shown on the Version ticket). Nullable, additive.
-- Reverse: down/0042_agent_version_change_note.sql.
ALTER TABLE "agent_versions" ADD COLUMN IF NOT EXISTS "change_note" text;
