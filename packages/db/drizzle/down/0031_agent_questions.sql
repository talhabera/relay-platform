-- Reverses 0031_agent_questions.sql. Not run by the migrator (drizzle has no
-- down step); apply by hand, then delete the 0031 row from
-- drizzle.__drizzle_migrations. Question history is lost.
DROP TABLE IF EXISTS "agent_questions";
