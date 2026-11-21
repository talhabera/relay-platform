import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { channels } from "./channels";

/** The raw `comments` change value Meta delivers, kept verbatim. */
export type InstagramCommentPayload = {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  [key: string]: unknown;
};

export const instagramComments = pgTable(
  "instagram_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channelId: uuid("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    igCommentId: text("ig_comment_id").notNull(),
    igMediaId: text("ig_media_id").notNull(),
    parentIgCommentId: text("parent_ig_comment_id"),

    fromIgUserId: text("from_ig_user_id"),
    fromUsername: text("from_username"),
    content: text("content").notNull(),
    commentedAt: timestamp("commented_at", { withTimezone: true }).notNull(),

    publicReplyIgId: text("public_reply_ig_id"),
    publicReplyText: text("public_reply_text"),
    publicRepliedAt: timestamp("public_replied_at", { withTimezone: true }),
    privateReplyIgId: text("private_reply_ig_id"),
    privateReplySentAt: timestamp("private_reply_sent_at", {
      withTimezone: true,
    }),

    raw: jsonb("raw").$type<InstagramCommentPayload>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("instagram_comments_ig_comment_id_idx").on(table.igCommentId),
    index("instagram_comments_agent_id_commented_at_idx").on(
      table.agentId,
      table.commentedAt
    ),
    index("instagram_comments_ig_media_id_idx").on(table.igMediaId),
  ]
);
