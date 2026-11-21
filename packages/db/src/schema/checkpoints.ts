import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { chats } from "./chats";
import { cronRuns } from "./cron-runs";
import { users } from "./users";
import { companyRecords } from "./company-records";
import type { AdChangeCommand, AdChangeReason, AdPlatform } from "../ad-change";

export type SendOutreachSnapshot = {
  url: string;
  method: string;
  headerSecretsSha256: string;
};

export const CHECKPOINT_STATUSES = [
  "pending",
  "approved",
  "changes_requested",
  "discarded",
  "stale",
  "failed",
] as const;

export type CheckpointStatus = (typeof CHECKPOINT_STATUSES)[number];

export const CHECKPOINT_KINDS = [
  "outreach",
  "email_sequence",
  "post",
  "review_reply",
  "lead_delivery",
  "ad_change",
] as const;

export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

export type OutreachPayload = {
  kind: "outreach";
  channel: "email" | "whatsapp" | "copy";
  recipient: string;
  subject?: string;
  body: string;
  reason: string;
  recordName: string;
  domain: string | null;
};

export type EmailSequencePayload = {
  kind: "email_sequence";
  recipient: string;
  recordName: string;
  steps: { subject: string; body: string; delayDays: number }[];
  reason: string;
};

export type PostPayload = {
  kind: "post";
  channel: "instagram" | "facebook" | "linkedin" | "gbp";
  body: string;
  mediaUrls: string[];
  scheduledFor: string | null;
  reason: string;
};

export type ReviewReplyPayload = {
  kind: "review_reply";
  platform: "gbp";
  reviewId: string;
  reviewerName: string;
  rating: number;
  reviewText: string;
  body: string;
  reason: string;
};

export type LeadDeliveryPayload = {
  kind: "lead_delivery";
  leadId: string;
  channel: "email" | "whatsapp" | "webhook";
  recipient: string;
  summary: string;
  reason: string;
};

/**
 * RL8b1: an ad change waiting for a person. `change` is a proposal that runs
 * only on Approve; `undo` reverses an autonomous reduction already applied
 * (`reversesChangeId`) and also runs only on Approve, through the same cap
 * check. `deltaMinor` is the signed daily-budget delta in TRY minor units;
 * the cap reservation SQL reads `payload->>'deltaMinor'`. No credential,
 * token or account secret is ever stored here.
 */
export type AdChangePayload = {
  kind: "ad_change";
  mode: "change" | "undo";
  changeId: string;
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  campaignName: string;
  command: AdChangeCommand;
  before: unknown;
  after: unknown;
  deltaMinor: number;
  dailyTotalAfterMinor: number;
  reason: AdChangeReason;
  /** ISO time; the card expires `AD_CHANGE_CARD_TTL_MS` after creation (enforced in b2). */
  expiresAt: string;
  reversesChangeId?: string;
  executionMode: "api" | "manual";
};

/**
 * The worker's at-most-once marker for a card that sends something (W3GAP).
 * Claimed as `sending` before the send and settled as `sent` with the send's
 * result, so a repeat call (stuck Retry, persist Retry) returns the earlier
 * result instead of sending again. A failed send clears it.
 */
export type CheckpointSendReceipt =
  | { state: "sending"; at: string }
  | { state: "sent"; at: string; result: Record<string, unknown> };

export type CheckpointPayload =
  | OutreachPayload
  | EmailSequencePayload
  | PostPayload
  | ReviewReplyPayload
  | LeadDeliveryPayload
  | AdChangePayload;

export const checkpoints = pgTable(
  "checkpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "cascade",
    }),
    // Null for kinds with no company record (post, review_reply).
    recordId: uuid("record_id").references(() => companyRecords.id, {
      onDelete: "restrict",
    }),
    kind: text("kind", { enum: CHECKPOINT_KINDS }).notNull(),
    payload: jsonb("payload").$type<CheckpointPayload>().notNull(),
    endpointSnapshot: jsonb("endpoint_snapshot").$type<
      SendOutreachSnapshot | null
    >(),
    status: text("status", { enum: CHECKPOINT_STATUSES })
      .notNull()
      .default("pending"),
    // The newer card posted after Ask for changes / Refresh.
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => checkpoints.id,
      { onDelete: "set null" },
    ),
    // Execution attempts; Retry on a failed card increments it.
    attemptCount: integer("attempt_count").notNull().default(1),
    // Hash of the work-pane artifact the card was drafted from (eager stale).
    artifactHash: text("artifact_hash"),
    executeResult: jsonb("execute_result").$type<Record<string, unknown> | null>(),
    sendReceipt: jsonb("send_receipt").$type<CheckpointSendReceipt | null>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Set by the first Refresh on a stale card; a repeat Refresh while the
    // agent has not answered is a no-op (no duplicate messages, no second poke).
    refreshRequestedAt: timestamp("refresh_requested_at"),
  },
  (table) => [
    index("checkpoints_cron_run_id_idx").on(table.cronRunId),
    index("checkpoints_record_id_idx").on(table.recordId),
    index("checkpoints_pending_idx")
      .on(table.status)
      .where(sql`${table.status} = 'pending'`),
    // One open card per company record (migration 0030).
    uniqueIndex("checkpoints_record_pending_uidx")
      .on(table.recordId)
      .where(
        sql`${table.status} = 'pending' AND ${table.recordId} IS NOT NULL`,
      ),
    check(
      "checkpoints_parent_chk",
      sql`(chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL)`,
    ),
  ],
);
