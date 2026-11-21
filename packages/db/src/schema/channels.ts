import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agents } from "./agents";

export type ChannelConfig = {
  apiKey?: string;
  phoneNumberId?: string;
  accessToken?: string;
  accountId?: string;
  botToken?: string;
  widgetId?: string;
  /**
   * Answer inbound messages automatically. Absent means off, so connecting a
   * live business number cannot start replying to customers by accident.
   */
  autoReply?: boolean;
  /**
   * Answer Instagram post and reel comments with a public reply. Separate from
   * `autoReply` because this one writes on a public timeline: a channel that
   * already answers DMs must not start commenting because a deploy shipped.
   */
  autoCommentReply?: boolean;
  /**
   * Instagram Business account id, distinct from `accountId`. Reserved for a
   * future Instagram connect flow; not read by any send or webhook path yet.
   */
  igUserId?: string;
  /**
   * Facebook Page id backing an Instagram Business account. Reserved for a
   * future Instagram connect flow; not read by any send or webhook path yet.
   */
  pageId?: string;
  /**
   * Per-channel webhook verify token. Reserved for a future per-channel
   * verification flow; today's Meta webhook handshake is verified with the
   * single app-level `META_WEBHOOK_VERIFY_TOKEN` env var, not this field.
   */
  webhookVerifyToken?: string;
};

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: text("type", {
      enum: ["whatsapp", "instagram", "telegram", "messenger", "widget"],
    }).notNull(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["active", "inactive"] }).default("active"),
    config: jsonb("config").$type<ChannelConfig>().default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("channels_agent_id_idx").on(table.agentId),
    // One inbound routing key, one channel. The Meta webhooks resolve a
    // delivery by these values, and an Instagram Business account id is
    // public, so without uniqueness a second company can claim a key that
    // already belongs to someone else and start receiving their
    // conversations. Unique across every status: a duplicate that only fails
    // at the moment someone activates it fails at the worst possible time.
    uniqueIndex("channels_whatsapp_phone_number_uidx")
      .on(sql`(${table.config} ->> 'phoneNumberId')`)
      .where(
        sql`${table.type} = 'whatsapp' AND (${table.config} ->> 'phoneNumberId') IS NOT NULL`
      ),
    uniqueIndex("channels_instagram_account_uidx")
      .on(sql`(${table.config} ->> 'accountId')`)
      .where(
        sql`${table.type} = 'instagram' AND (${table.config} ->> 'accountId') IS NOT NULL`
      ),
  ]
);
