-- Reverses 0038_connector_catalog.sql. Not run by the migrator
-- (drizzle has no down step); apply by hand, then delete the 0038 row from
-- drizzle.__drizzle_migrations. Delete rows of the new catalog types first if
-- any exist, since the app enum no longer accepts them.
DROP INDEX IF EXISTS "integrations_company_id_operator_type_uidx";
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_company_id_operator_type_uidx"
  ON "integrations" ("company_id", "type")
  WHERE "type" IN ('hunter', 'snov', 'google_places');
