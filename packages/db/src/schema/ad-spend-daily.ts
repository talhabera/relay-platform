import {
  pgTable,
  text,
  uuid,
  date,
  bigint,
  integer,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";
import { AD_CHANNELS } from "../ad-constants";

/** How a spend row got here: typed in, parsed from a CSV, or a platform API. */
export const AD_SPEND_SOURCES = ["manual", "csv", "api"] as const;
export type AdSpendSource = (typeof AD_SPEND_SOURCES)[number];

/**
 * One day of ad spend for one channel and campaign. `spendDate` is the
 * Europe/Istanbul calendar day; `campaignId` is `""` for an unnamed channel
 * total. `amountMinor` is kuruş (TRY minor units, see `AD_CURRENCY`).
 * Re-entry upserts on the unique index, so a day is never counted twice.
 * `complete` is false for a partial or unconfirmed day (RL6, RL7).
 */
export const adSpendDaily = pgTable(
  "ad_spend_daily",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    spendDate: date("spend_date").notNull(),
    channel: text("channel", { enum: AD_CHANNELS }).notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    impressions: integer("impressions"),
    clicks: integer("clicks"),
    source: text("source", { enum: AD_SPEND_SOURCES }).notNull(),
    complete: boolean("complete").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ad_spend_daily_company_date_channel_campaign_uidx").on(
      table.companyId,
      table.spendDate,
      table.channel,
      table.campaignId,
    ),
    index("ad_spend_daily_company_date_idx").on(
      table.companyId,
      table.spendDate,
    ),
    check(
      "ad_spend_daily_channel_chk",
      sql`channel IN ('google', 'instagram', 'meta')`,
    ),
    check(
      "ad_spend_daily_source_chk",
      sql`source IN ('manual', 'csv', 'api')`,
    ),
    check("ad_spend_daily_amount_minor_chk", sql`amount_minor >= 0`),
  ],
);

export type AdSpendDaily = InferSelectModel<typeof adSpendDaily>;
export type NewAdSpendDaily = InferInsertModel<typeof adSpendDaily>;
