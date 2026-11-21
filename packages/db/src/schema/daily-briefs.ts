import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { cronRuns } from "./cron-runs";

/** What a brief item asks of the reader: act, set something up, or decide. */
export const DAILY_BRIEF_ITEM_KINDS = ["do", "setup", "decide"] as const;
export type DailyBriefItemKind = (typeof DAILY_BRIEF_ITEM_KINDS)[number];

/** Where the reader left a brief item; absent on briefs written before it existed. */
export const DAILY_BRIEF_ITEM_STATUSES = ["open", "done", "dismissed"] as const;
export type DailyBriefItemStatus = (typeof DAILY_BRIEF_ITEM_STATUSES)[number];

/**
 * One ranked item of a morning brief; `href` is null when no page fits.
 * `taskId` points at the task the item came from or created, when any.
 * `source: "ads"` marks an item the ad monitor wrote (RL7); its
 * `proposalKey` names the ad action proposal it carries. Items without a
 * `source` are the Daily Manager's.
 */
export type DailyBriefItem = {
  rank: number;
  kind: DailyBriefItemKind;
  title: string;
  why: string;
  href: string | null;
  taskId?: string | null;
  status?: DailyBriefItemStatus;
  source?: "ads";
  proposalKey?: string | null;
};

export const DAILY_BRIEF_MAX_ITEMS = 5;

/**
 * One morning brief per company per local day, written by the Daily Manager
 * package agent. `localDate` is the company-local `YYYY-MM-DD` the brief is
 * for; a re-run on the same day replaces the brief through the unique index.
 */
export const dailyBriefs = pgTable(
  "daily_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "set null",
    }),
    localDate: text("local_date").notNull(),
    summary: text("summary").notNull(),
    items: jsonb("items").$type<DailyBriefItem[]>().notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("daily_briefs_company_local_date_uidx").on(
      table.companyId,
      table.localDate,
    ),
    index("daily_briefs_company_created_at_idx").on(
      table.companyId,
      table.createdAt,
    ),
  ],
);

export type DailyBrief = InferSelectModel<typeof dailyBriefs>;
export type NewDailyBrief = InferInsertModel<typeof dailyBriefs>;
