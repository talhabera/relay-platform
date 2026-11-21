import {
  pgTable,
  text,
  varchar,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";
import { companyRecords } from "./company-records";
import { AD_CHANNELS } from "../ad-constants";

/**
 * One ad click landing on koleva-web, keyed by the 5-char code the visitor
 * later quotes in the intake chat. Written by the click endpoint (RL4b),
 * bound to a lead by `bindClickToRecord`. No IP and no user-agent column:
 * the visitor IP only ever becomes a short-lived rate-limit subject hash.
 * The partial unique index is the one-code-per-lead backstop.
 */
export const adClicks = pgTable(
  "ad_clicks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    channel: text("channel", { enum: AD_CHANNELS }).notNull(),
    gclid: varchar("gclid", { length: 200 }),
    gbraid: varchar("gbraid", { length: 200 }),
    wbraid: varchar("wbraid", { length: 200 }),
    fbclid: varchar("fbclid", { length: 200 }),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    landingPath: text("landing_path"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    linkedRecordId: uuid("linked_record_id").references(
      () => companyRecords.id,
      { onDelete: "set null" },
    ),
    linkedAt: timestamp("linked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("ad_clicks_company_code_uidx").on(
      table.companyId,
      table.code,
    ),
    uniqueIndex("ad_clicks_linked_record_uidx")
      .on(table.linkedRecordId)
      .where(sql`linked_record_id IS NOT NULL`),
    index("ad_clicks_expires_at_idx").on(table.expiresAt),
    check("ad_clicks_code_chk", sql`code ~ '^[A-Z0-9]{5}$'`),
    check(
      "ad_clicks_channel_chk",
      sql`channel IN ('google', 'instagram', 'meta')`,
    ),
    check(
      "ad_clicks_expires_after_created_chk",
      sql`expires_at > created_at`,
    ),
  ],
);

export type AdClick = InferSelectModel<typeof adClicks>;
export type NewAdClick = InferInsertModel<typeof adClicks>;
