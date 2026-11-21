import {
  pgTable,
  integer,
  text,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";
import { companies } from "./companies";
import { agents } from "./agents";
import { agentVersions } from "./agent-versions";

// Operator session status shown on the Session row and the Sessions filter
// chips (Figma 05/sessions): Running, Needs you, Completed, Failed.
export const CHAT_STATUSES = [
  "running",
  "needs_you",
  "completed",
  "failed",
] as const;

export type ChatStatus = (typeof CHAT_STATUSES)[number];

// Inbox Sentiment card (Figma 08a): written by the worker's post-chat
// enrichment job (S83) once a customer conversation goes quiet.
export const CHAT_SENTIMENTS = ["positive", "neutral", "negative"] as const;

export type ChatSentiment = (typeof CHAT_SENTIMENTS)[number];

/** Score bands: 0-39 negative, 40-60 neutral, 61-100 positive. */
export function sentimentOfScore(score: number): ChatSentiment {
  if (score < 40) return "negative";
  if (score > 60) return "positive";
  return "neutral";
}

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    visitorId: text("visitor_id"),
    channelType: text("channel_type", {
      enum: [
        "whatsapp",
        "instagram",
        "telegram",
        "messenger",
        "widget",
        "web",
        "operator",
        "master",
      ],
    }).default("web"),
    model: text("model", { enum: ["haiku", "sonnet", "opus"] }),
    versionId: uuid("version_id").references(() => agentVersions.id, {
      onDelete: "restrict",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    status: text("status", { enum: CHAT_STATUSES })
      .notNull()
      .default("completed"),
    // Last message, tool call or checkpoint in the session; Sessions sort by it.
    lastActivityAt: timestamp("last_activity_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    // Post-chat enrichment (S83). Null until a quiet customer conversation is
    // enriched; refreshed when new messages arrive and it goes quiet again.
    sentiment: text("sentiment", { enum: CHAT_SENTIMENTS }),
    /** 0 (very negative) to 100 (very positive); `sentiment` is its band. */
    sentimentScore: integer("sentiment_score"),
    /** ISO 639-1 code of the customer's language, e.g. "en", "de", "tr". */
    language: text("language"),
    /** First to last message, in seconds. */
    durationSeconds: integer("duration_seconds"),
    /**
     * `created_at` of the last message the enrichment covered. Same column
     * type as `messages.created_at`, so the job compares like with like: a
     * newer message makes the conversation due again.
     */
    enrichedThrough: timestamp("enriched_through"),
  },
  (table) => [
    index("chats_user_id_idx").on(table.userId),
    index("chats_company_id_idx").on(table.companyId),
    index("chats_visitor_id_idx").on(table.visitorId),
    index("chats_version_id_idx").on(table.versionId),
    index("chats_company_id_archived_at_idx").on(
      table.companyId,
      table.archivedAt,
    ),
    index("chats_company_id_last_activity_at_idx").on(
      table.companyId,
      table.lastActivityAt,
    ),
    // One conversation per sender per inbound channel. Two deliveries a second
    // apart can land on two web instances at once; without this both
    // check-then-insert paths miss and the conversation splits permanently.
    //
    // The channel_type qualification is load-bearing, not decoration: on
    // 'widget' the visitor_id is the client IP (literally 'unknown' with no
    // x-forwarded-for header), so unqualified this would collide for every
    // visitor behind one IP.
    uniqueIndex("chats_agent_channel_visitor_idx")
      .on(table.agentId, table.channelType, table.visitorId)
      .where(
        sql`${table.archivedAt} IS NULL AND ${table.channelType} IN ('whatsapp', 'instagram')`,
      ),
    check(
      "chats_sentiment_chk",
      sql`sentiment IS NULL OR sentiment IN ('positive', 'neutral', 'negative')`,
    ),
    check(
      "chats_sentiment_score_chk",
      sql`sentiment_score IS NULL OR sentiment_score BETWEEN 0 AND 100`,
    ),
  ]
);
