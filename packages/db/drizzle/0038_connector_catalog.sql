-- S80: connector catalog expansion. integrations.type is a text column (no check
-- constraint since 0010), so the new catalog types need no column change; widen the
-- one-row-per-company partial unique index to every company-level catalog connector.
DROP INDEX IF EXISTS "integrations_company_id_operator_type_uidx";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "integrations_company_id_operator_type_uidx"
  ON "integrations" ("company_id", "type")
  WHERE "type" IN ('hunter', 'snov', 'google_places', 'google_workspace', 'meta', 'google_business_profile', 'linkedin', 'trustpilot');
