-- Reverses 0035_handoff_team_chat.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0035 row from
-- drizzle.__drizzle_migrations.
DROP TABLE IF EXISTS "handoff_team_chat_questions";
DROP TABLE IF EXISTS "handoff_team_chat_groups";
