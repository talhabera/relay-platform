import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  bigint,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";
import {
  AD_CHANGE_ACTIONS,
  AD_CHANGE_ACTOR_TYPES,
  AD_CHANGE_OUTCOMES,
  AD_CHANGE_PHASES,
  AD_PLATFORMS,
} from "../ad-change";

/**
 * RL8a: append-only ledger of every ad change Relay asks a platform to make.
 * An intent row is written under the company's cap lock before the platform
 * call and a result row (same `change_id`) after it. Triggers refuse UPDATE,
 * DELETE and TRUNCATE (0055). `company_id` restricts deletes on purpose; user
 * and agent ids carry no foreign key because a SET NULL would be an UPDATE.
 */
export const adChangeLog = pgTable(
  "ad_change_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    changeId: uuid("change_id").notNull(),
    phase: text("phase", { enum: AD_CHANGE_PHASES }).notNull(),
    platform: text("platform", { enum: AD_PLATFORMS }).notNull(),
    accountId: text("account_id").notNull(),
    campaignId: text("campaign_id").notNull(),
    campaignName: text("campaign_name"),
    action: text("action", { enum: AD_CHANGE_ACTIONS }).notNull(),
    beforeValue: jsonb("before_value").$type<unknown>(),
    afterValue: jsonb("after_value").$type<unknown>(),
    deltaMinor: bigint("delta_minor", { mode: "number" }).notNull().default(0),
    dailyTotalAfterMinor: bigint("daily_total_after_minor", { mode: "number" }),
    actorType: text("actor_type", { enum: AD_CHANGE_ACTOR_TYPES }).notNull(),
    actorAgentId: uuid("actor_agent_id"),
    actorUserId: text("actor_user_id"),
    autonomous: boolean("autonomous").notNull().default(false),
    checkpointId: uuid("checkpoint_id"),
    attempt: integer("attempt"),
    reversesChangeId: uuid("reverses_change_id"),
    reasonText: text("reason_text").notNull(),
    reasonMetric: text("reason_metric"),
    reasonValue: doublePrecision("reason_value"),
    reasonThreshold: doublePrecision("reason_threshold"),
    outcome: text("outcome", { enum: AD_CHANGE_OUTCOMES }),
    outcomeCode: text("outcome_code"),
    outcomeDetail: text("outcome_detail"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("ad_change_log_outcome_chk", sql`(phase = 'intent') = (outcome IS NULL)`),
    check(
      "ad_change_log_reason_chk",
      sql`actor_type <> 'agent' OR (reason_metric IS NOT NULL AND reason_value IS NOT NULL AND reason_threshold IS NOT NULL)`,
    ),
    check(
      "ad_change_log_actor_chk",
      sql`(actor_type <> 'agent' OR actor_agent_id IS NOT NULL) AND (actor_type <> 'human' OR actor_user_id IS NOT NULL)`,
    ),
    uniqueIndex("ad_change_log_change_phase_uidx").on(table.changeId, table.phase),
    uniqueIndex("ad_change_log_checkpoint_attempt_phase_uidx")
      .on(table.checkpointId, table.attempt, table.phase)
      .where(sql`checkpoint_id IS NOT NULL`),
    index("ad_change_log_company_seq_idx").on(table.companyId, table.seq),
    index("ad_change_log_company_intent_created_idx")
      .on(table.companyId, table.createdAt)
      .where(sql`phase = 'intent'`),
  ],
);

export type AdChangeLogRow = InferSelectModel<typeof adChangeLog>;
export type NewAdChangeLogRow = InferInsertModel<typeof adChangeLog>;
