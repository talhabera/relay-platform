import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { agents } from "./agents";
import { chats } from "./chats";

export type LeadStatus = "new" | "qualified" | "rejected";

/**
 * Channels whose conversations can produce a billable lead. The dashboard
 * test chat (`web`), operator and master sessions are not customers, so they
 * are deliberately absent.
 */
export const LEAD_CHANNEL_TYPES = [
  "widget",
  "whatsapp",
  "instagram",
  "telegram",
  "messenger",
] as const;

export type LeadChannelType = (typeof LEAD_CHANNEL_TYPES)[number];

/**
 * One row per customer conversation. `agent_id` and `chat_id` are
 * `ON DELETE SET NULL` so deleting an agent or a chat does not erase a lead
 * that may already have been billed; only deleting the company does.
 */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    chatId: uuid("chat_id").references(() => chats.id, {
      onDelete: "set null",
    }),
    channelType: text("channel_type", { enum: LEAD_CHANNEL_TYPES }).notNull(),
    tip: text("tip"),
    m2: text("m2"),
    lokasyon: text("lokasyon"),
    butce: text("butce"),
    iletisim: text("iletisim"),
    skor: integer("skor"),
    kod: text("kod"),
    status: text("status", { enum: ["new", "qualified", "rejected"] })
      .notNull()
      .default("new"),
    notifiedAt: timestamp("notified_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("leads_chat_id_uidx").on(table.chatId),
    index("leads_company_id_status_idx").on(table.companyId, table.status),
    index("leads_agent_id_created_at_idx").on(table.agentId, table.createdAt),
    check(
      "leads_skor_chk",
      sql`skor IS NULL OR (skor >= 1 AND skor <= 10)`,
    ),
  ],
);
