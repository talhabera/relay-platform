-- Reverses 0049_projects_tasks.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0049 row from
-- drizzle.__drizzle_migrations. tasks references projects, so it drops first.
DROP TABLE IF EXISTS "tasks";
--> statement-breakpoint
DROP TABLE IF EXISTS "projects";
