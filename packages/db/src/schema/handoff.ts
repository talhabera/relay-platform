import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { chats } from "./chats";

/**
 * Human handoff (spec `docs/superpowers/specs/2026-10-02-human-handoff.md`).
 * Everything here is per customer agent; there is no company-level setting.
 */

/**
 * WhatsApp delivery status of the staff notification, from the webhook's
 * `statuses[]`. Moves forward only (sent < delivered < read); failed is
 * terminal.
 */
export const HANDOFF_NOTIFICATION_STATUSES = [
  "sent",
  "delivered",
  "read",
  "failed",
] as const;
export type HandoffNotificationStatus =
  (typeof HANDOFF_NOTIFICATION_STATUSES)[number];

export const HANDOFF_MODES = ["quick_answer", "takeover", "team_chat"] as const;
export type HandoffMode = (typeof HANDOFF_MODES)[number];

/** "Expires after" choices, in minutes. The default is 2 h. */
export const HANDOFF_EXPIRY_MINUTES = [30, 60, 120, 240] as const;
export type HandoffExpiryMinutes = (typeof HANDOFF_EXPIRY_MINUTES)[number];
export const DEFAULT_HANDOFF_EXPIRY_MINUTES: HandoffExpiryMinutes = 120;

/** "Send as" on the quick-link page: verbatim as the person, or rephrased by the agent. */
export const HANDOFF_REPLY_MODES = ["person", "agent"] as const;
export type HandoffReplyMode = (typeof HANDOFF_REPLY_MODES)[number];

/** What the customer is told when a request expires unanswered. */
export const HANDOFF_IF_NOBODY_ANSWERS = ["reply_here", "reply_by_email"] as const;
export type HandoffIfNobodyAnswers = (typeof HANDOFF_IF_NOBODY_ANSWERS)[number];

/** The four fixed triggers. The 60% confidence threshold is fixed, not stored. */
export const HANDOFF_TRIGGERS = [
  "price_not_listed",
  "asks_for_person",
  "complaint_or_refund",
  "low_confidence",
] as const;
export type HandoffTrigger = (typeof HANDOFF_TRIGGERS)[number];
export const HANDOFF_LOW_CONFIDENCE_THRESHOLD = 60;

/** A takeover with no message from the person for this long hands back automatically. */
export const HANDOFF_TAKEOVER_IDLE_MINUTES = 30;

export const HANDOFF_REQUEST_STATUSES = [
  "open",
  "answered",
  "taken_over",
  "expired",
  "handed_back",
] as const;
export type HandoffRequestStatus = (typeof HANDOFF_REQUEST_STATUSES)[number];

/**
 * The only legal status moves. `expired` is resolved from the Inbox and
 * `handed_back` ends a takeover, so neither moves again.
 */
export const HANDOFF_REQUEST_TRANSITIONS: Readonly<
  Record<HandoffRequestStatus, readonly HandoffRequestStatus[]>
> = {
  open: ["answered", "taken_over", "expired"],
  answered: ["taken_over"],
  taken_over: ["handed_back"],
  expired: [],
  handed_back: [],
};

export function canTransitionHandoffRequest(
  from: HandoffRequestStatus,
  to: HandoffRequestStatus,
): boolean {
  return HANDOFF_REQUEST_TRANSITIONS[from].includes(to);
}

export const HANDOFF_HAND_BACK_REASONS = ["manual", "idle"] as const;
export type HandoffHandBackReason = (typeof HANDOFF_HAND_BACK_REASONS)[number];

/** One hard question. The first is the one that opened the request; later ones were appended. */
export type HandoffQuestion = { text: string; askedAt: string };

/**
 * One row per customer agent. A missing row means every default below. Saving
 * a new WhatsApp number must reset `recipient_confirmed`: until the recipient
 * confirms, requests go straight to the Inbox.
 */
export const agentHandoffSettings = pgTable(
  "agent_handoff_settings",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: HANDOFF_MODES })
      .notNull()
      .default("quick_answer"),
    triggerPriceNotListed: boolean("trigger_price_not_listed")
      .notNull()
      .default(true),
    triggerAsksForPerson: boolean("trigger_asks_for_person")
      .notNull()
      .default(true),
    triggerComplaintOrRefund: boolean("trigger_complaint_or_refund")
      .notNull()
      .default(true),
    triggerLowConfidence: boolean("trigger_low_confidence")
      .notNull()
      .default(true),
    recipientName: text("recipient_name"),
    recipientWhatsapp: text("recipient_whatsapp"),
    recipientConfirmed: boolean("recipient_confirmed").notNull().default(false),
    recipientConfirmedAt: timestamp("recipient_confirmed_at"),
    expiryMinutes: integer("expiry_minutes")
      .notNull()
      .default(DEFAULT_HANDOFF_EXPIRY_MINUTES),
    defaultReply: text("default_reply", { enum: HANDOFF_REPLY_MODES })
      .notNull()
      .default("agent"),
    recipientCanTakeOver: boolean("recipient_can_take_over")
      .notNull()
      .default(false),
    /** "Customer sees while waiting". Null means the product default copy. */
    waitingText: text("waiting_text"),
    ifNobodyAnswers: text("if_nobody_answers", {
      enum: HANDOFF_IF_NOBODY_ANSWERS,
    })
      .notNull()
      .default("reply_here"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("agent_handoff_settings_company_id_idx").on(table.companyId),
    check(
      "agent_handoff_settings_expiry_chk",
      sql`expiry_minutes IN (30, 60, 120, 240)`,
    ),
  ],
);

/**
 * A request for a human. At most one `open` request per conversation: a later
 * hard question is appended to `questions` and sends no second notification.
 *
 * Only the SHA-256 of the quick-link token is stored. Team chat has no quick
 * link, so its rows carry no token hash.
 */
export const handoffRequests = pgTable(
  "handoff_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    status: text("status", { enum: HANDOFF_REQUEST_STATUSES })
      .notNull()
      .default("open"),
    /** The agent's mode when the request opened; a later settings change does not move it. */
    mode: text("mode", { enum: HANDOFF_MODES }).notNull(),
    tokenHash: text("token_hash"),
    reason: text("reason").notNull(),
    /** Self-reported by the agent through `ask_human`, 0-100. */
    confidence: integer("confidence"),
    questions: jsonb("questions").$type<HandoffQuestion[]>().notNull(),
    suggestedReplies: jsonb("suggested_replies")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    recipientName: text("recipient_name"),
    recipientWhatsapp: text("recipient_whatsapp"),
    /** Snapshot of whether this request's link may take over the chat. */
    canTakeOver: boolean("can_take_over").notNull().default(false),
    notifiedAt: timestamp("notified_at"),
    /** The wamid of the staff notification, set when the worker sent it. */
    notificationMessageId: text("notification_message_id"),
    notificationStatus: text("notification_status", {
      enum: HANDOFF_NOTIFICATION_STATUSES,
    }),
    notificationStatusAt: timestamp("notification_status_at"),
    /** `{code?, title?}` from a failed status; null otherwise. */
    notificationError: jsonb("notification_error").$type<{
      code?: number;
      title?: string;
    }>(),
    expiresAt: timestamp("expires_at").notNull(),
    answer: text("answer"),
    replyMode: text("reply_mode", { enum: HANDOFF_REPLY_MODES }),
    answeredAt: timestamp("answered_at"),
    takenOverAt: timestamp("taken_over_at"),
    lastHumanMessageAt: timestamp("last_human_message_at"),
    handedBackAt: timestamp("handed_back_at"),
    handBackReason: text("hand_back_reason", {
      enum: HANDOFF_HAND_BACK_REASONS,
    }),
    expiredAt: timestamp("expired_at"),
    /** The person pressed Done: the link can no longer answer or take over. */
    linkClosedAt: timestamp("link_closed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("handoff_requests_token_hash_uidx").on(table.tokenHash),
    // One open request per conversation. Two hard questions a moment apart
    // must append, not open a second request and notify twice.
    uniqueIndex("handoff_requests_chat_open_uidx")
      .on(table.chatId)
      .where(sql`${table.status} = 'open'`),
    index("handoff_requests_chat_id_idx").on(table.chatId),
    index("handoff_requests_company_id_status_idx").on(
      table.companyId,
      table.status,
    ),
    index("handoff_requests_status_expires_at_idx").on(
      table.status,
      table.expiresAt,
    ),
    // Status webhooks name the notification by wamid only.
    index("handoff_requests_notification_message_id_idx")
      .on(table.notificationMessageId)
      .where(sql`${table.notificationMessageId} IS NOT NULL`),
    check(
      "handoff_requests_confidence_chk",
      sql`confidence IS NULL OR (confidence >= 0 AND confidence <= 100)`,
    ),
    check(
      "handoff_requests_notification_status_chk",
      sql`notification_status IS NULL OR notification_status IN ('sent', 'delivered', 'read', 'failed')`,
    ),
    check(
      "handoff_requests_token_chk",
      sql`mode = 'team_chat' OR token_hash IS NOT NULL`,
    ),
  ],
);

/**
 * Team chat (spec decision 11). Only an Official Business Account sender can
 * use the WhatsApp Groups API, so a group row exists only for such a sender.
 * Group creation is asynchronous: the create call returns a request id and
 * the `group_lifecycle_update` webhook later carries the group id and invite
 * link, which moves the row from `pending` to `active`.
 */
export const TEAM_CHAT_GROUP_STATUSES = ["pending", "active", "failed"] as const;
export type TeamChatGroupStatus = (typeof TEAM_CHAT_GROUP_STATUSES)[number];

/** WhatsApp groups hold at most 8 participants. */
export const TEAM_CHAT_MAX_PARTICIPANTS = 8;

/** One group per customer agent in Team chat mode. */
export const handoffTeamChatGroups = pgTable(
  "handoff_team_chat_groups",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    /** The company's WhatsApp sender (`channels.config.phoneNumberId`) that owns the group. */
    phoneNumberId: text("phone_number_id").notNull(),
    status: text("status", { enum: TEAM_CHAT_GROUP_STATUSES })
      .notNull()
      .default("pending"),
    subject: text("subject").notNull(),
    /** Groups API `request_id` of the create call, matched by the lifecycle webhook. */
    createRequestId: text("create_request_id"),
    groupId: text("group_id"),
    inviteLink: text("invite_link"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("handoff_team_chat_groups_company_id_idx").on(table.companyId),
    uniqueIndex("handoff_team_chat_groups_group_id_uidx")
      .on(table.groupId)
      .where(sql`${table.groupId} IS NOT NULL`),
    index("handoff_team_chat_groups_create_request_id_idx").on(
      table.createRequestId,
    ),
  ],
);

/**
 * A Team chat request's question as posted in the group. A group reply
 * counts as the answer when it quote-replies to `messageId` (webhook
 * `context.id`) or, while quote context in groups is undocumented, when it
 * starts with the question's reply code (`#K7Q2 …`). The code is unique
 * among the group's open questions.
 */
export const handoffTeamChatQuestions = pgTable(
  "handoff_team_chat_questions",
  {
    requestId: uuid("request_id")
      .primaryKey()
      .references(() => handoffRequests.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    groupId: text("group_id").notNull(),
    /** The wamid of the posted question. */
    messageId: text("message_id").notNull(),
    code: text("code").notNull(),
    /** Who answered in the group (`messages[].from` and profile name). */
    answeredByWaId: text("answered_by_wa_id"),
    answeredByName: text("answered_by_name"),
    answerMessageId: text("answer_message_id"),
    /** The wamid of the "Sent to Lukas: «…»" confirmation. */
    confirmationMessageId: text("confirmation_message_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("handoff_team_chat_questions_message_id_uidx").on(
      table.messageId,
    ),
    uniqueIndex("handoff_team_chat_questions_group_code_uidx").on(
      table.groupId,
      table.code,
    ),
  ],
);
