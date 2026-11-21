import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { chats } from "./chats";
import { cronRuns } from "./cron-runs";

export const sessionFiles = pgTable(
  "session_files",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id").references(() => chats.id, { onDelete: "cascade" }),
    cronRunId: uuid("cron_run_id").references(() => cronRuns.id, {
      onDelete: "cascade",
    }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storageKey: text("storage_key").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "session_files_parent_chk",
      sql`(chat_id IS NOT NULL AND cron_run_id IS NULL) OR (chat_id IS NULL AND cron_run_id IS NOT NULL)`,
    ),
  ],
);
