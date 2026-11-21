import {
  pgTable,
  text,
  uuid,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";

/**
 * Maps a Meta click-to-WhatsApp ad (`referral.source_id`) to its fixed code
 * (e.g. `MWEB1`) and campaign name. Written only from the company settings
 * screen; the webhook side and reports only read it.
 */
export const adMetaMappings = pgTable(
  "ad_meta_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    code: text("code").notNull(),
    campaignName: text("campaign_name").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ad_meta_mappings_company_source_uidx").on(
      table.companyId,
      table.sourceId,
    ),
    check("ad_meta_mappings_code_chk", sql`code ~ '^[A-Z0-9]{5}$'`),
  ],
);

export type AdMetaMapping = InferSelectModel<typeof adMetaMappings>;
export type NewAdMetaMapping = InferInsertModel<typeof adMetaMappings>;
