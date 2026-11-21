import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  timestamp,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { PAGE_PERMISSION_KEYS } from "./company-members";

/**
 * Home tile catalog (spec 2026-10-02-panel-chat-removal-and-home, decision 4).
 * Fixed: it comes from the Figma Home frames. Adding a tile is a code change.
 */
export const HOME_TILE_KEYS = [
  "goal_strip",
  "needs_you",
  "today",
  "lead_engine",
  "agent_map",
  "daily_brief",
  "my_tasks",
  "ad_report",
] as const;

export type HomeTileKey = (typeof HOME_TILE_KEYS)[number];

/** `requires` pairs with `required_permission` (a page permission key). */
export const HOME_TILE_VISIBILITIES = [
  "everyone",
  "requires",
  "owners_only",
] as const;

export type HomeTileVisibilityKind = (typeof HOME_TILE_VISIBILITIES)[number];

/**
 * Per-company Home tile configuration, written by the owner (Edit Home, S106).
 * A company with no rows uses the default arrangement; a missing tile row
 * falls back to that tile's default. Per-user arrangement is a later addition.
 */
export const companyHomeTiles = pgTable(
  "company_home_tiles",
  {
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    tileKey: text("tile_key", { enum: HOME_TILE_KEYS }).notNull(),
    visible: boolean("visible").notNull().default(true),
    position: integer("position").notNull().default(0),
    visibility: text("visibility", { enum: HOME_TILE_VISIBILITIES })
      .notNull()
      .default("everyone"),
    requiredPermission: text("required_permission", {
      enum: PAGE_PERMISSION_KEYS,
    }),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "company_home_tiles_pk",
      columns: [table.companyId, table.tileKey],
    }),
    check(
      "company_home_tiles_tile_key_chk",
      sql`tile_key IN ('goal_strip', 'needs_you', 'today', 'lead_engine', 'agent_map', 'daily_brief', 'my_tasks', 'ad_report')`,
    ),
    check(
      "company_home_tiles_visibility_chk",
      sql`(visibility = 'requires' AND required_permission IN ('operator', 'agents', 'messaging', 'analytics')) OR (visibility IN ('everyone', 'owners_only') AND required_permission IS NULL)`,
    ),
  ],
);
