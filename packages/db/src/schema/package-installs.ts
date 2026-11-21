import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";

// Packages spec decision 4: one row per installed package. Installed and
// Available states and "Installed <date>" read from here, not from agents.
// Pre-0041 Revenue installs have no row: they stay ordinary operator agents.
export const packageInstalls = pgTable(
  "package_installs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    packageSlug: text("package_slug").notNull(),
    installedAt: timestamp("installed_at").notNull().defaultNow(),
    installedByUserId: text("installed_by_user_id").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    /** Catalog version at install time, for a later "update available" flow. */
    catalogVersion: integer("catalog_version").notNull(),
  },
  (table) => [
    uniqueIndex("package_installs_company_package_uidx").on(
      table.companyId,
      table.packageSlug,
    ),
  ],
);
