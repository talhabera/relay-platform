import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { cronRuns } from "./cron-runs";
import type { MessageMetadata } from "./messages";

export const cronRunMessages = pgTable(
  "cron_run_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => cronRuns.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    role: text("role", {
      enum: ["user", "assistant", "system", "tool"],
    }).notNull(),
    metadata: jsonb("metadata").$type<MessageMetadata>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [index("cron_run_messages_run_id_idx").on(table.runId)],
);
