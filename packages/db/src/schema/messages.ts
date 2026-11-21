import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { chats } from "./chats";
import type { LeadReferral } from "./company-records";

export const MESSAGE_AUTHORS = ["agent", "human"] as const;
export type MessageAuthor = (typeof MESSAGE_AUTHORS)[number];

/** WhatsApp's delivery lifecycle for an outbound message, in order. */
export type MessageDeliveryStatus = "sent" | "delivered" | "read" | "failed";

/** One piece of an operator turn, in the order the agent produced it. */
export type TranscriptPart =
  | { type: "text"; text: string }
  | {
      type: "tool-result" | "tool-error";
      tool: string;
      toolCallId: string;
      input: unknown;
      output?: unknown;
      errorText?: string;
    };

export type MessageMetadata = {
  toolCalls?: Array<{
    type: string;
    tool: string;
    data: unknown;
  }>;
  /**
   * Operator turns: text and tool calls in order, so the transcript shows tool
   * chips between bubbles after a reload. Display only; never sent to the model.
   */
  transcript?: TranscriptPart[];
  model?: string;
  tokens?: number;
  /**
   * The platform's own id for this message: a WhatsApp `wamid` or an Instagram
   * `mid`. Inbound rows carry the delivered id; outbound rows carry the id the
   * send call returned. A partial unique index on this value makes a Meta
   * redelivery a no-op.
   */
  platformMessageId?: string;
  /**
   * The handoff request whose answer this agent message follows up (worker
   * handoff/follow-up.ts): at most one follow-up per request.
   */
  handoffRequestId?: string;
  /** The handoff request whose expiry notice this message is (worker handoff/sweep.ts). */
  handoffExpiredRequestId?: string;
  /** The sender's display name, when the platform provides one. */
  senderName?: string;
  /**
   * Latest delivery status for an outbound message, set by a WhatsApp status
   * webhook. Absent for inbound messages and for outbound ones before the
   * first status arrives.
   */
  status?: MessageDeliveryStatus;
  /** ISO timestamp of the most recent status event. */
  statusAt?: string;
  /** Present only when `status` is `"failed"`. */
  error?: { code?: number; title?: string };
  /**
   * Click-to-WhatsApp ad attribution on an inbound message (lead scoring
   * spec, decision 14). `record_lead` copies the first one onto the lead.
   */
  referral?: LeadReferral;
};

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    role: text("role", {
      enum: ["user", "assistant", "system", "tool"],
    }).notNull(),
    metadata: jsonb("metadata").$type<MessageMetadata>(),
    /**
     * Who wrote the message on the business side. Null means "derive from
     * role" (every row before human handoff). `human` is a person answering
     * through human handoff; their name goes in `author_display_name`.
     */
    author: text("author", { enum: MESSAGE_AUTHORS }),
    authorDisplayName: text("author_display_name"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("messages_chat_id_idx").on(table.chatId),
    index("messages_chat_id_created_at_idx").on(table.chatId, table.createdAt),
    // Meta redelivers. This is what makes a redelivery a no-op instead of a
    // second stored message and a second billed reply, so it is declared here
    // and not only in SQL: db:push drops what the schema does not describe.
    //
    // The predicate is `IS NOT NULL` rather than `metadata ? 'key'` so that
    // Postgres can prove it covers the equality lookup the status path runs
    // (`metadata->>'platformMessageId' = $1`); it cannot derive the `?`
    // operator from that expression, and the index would go unused.
    uniqueIndex("messages_platform_message_id_idx")
      .on(sql`(${table.metadata} ->> 'platformMessageId')`)
      .where(sql`(${table.metadata} ->> 'platformMessageId') IS NOT NULL`),
    // A human message without a name would render with no person marker.
    check(
      "messages_human_display_name_chk",
      sql`author IS DISTINCT FROM 'human' OR author_display_name IS NOT NULL`,
    ),
  ]
);
