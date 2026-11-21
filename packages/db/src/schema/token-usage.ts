import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  date,
  index,
  unique,
} from "drizzle-orm/pg-core";

export const tokenUsage = pgTable(
  "token_usage",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    identifierType: text("identifier_type", {
      enum: ["user", "widget", "channel"],
    }).notNull(),
    tokensUsed: integer("tokens_used").notNull().default(0),
    weekStart: date("week_start").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    unique("token_usage_identifier_week_idx").on(
      table.identifier,
      table.identifierType,
      table.weekStart
    ),
    index("token_usage_lookup_idx").on(
      table.identifier,
      table.identifierType,
      table.weekStart
    ),
  ]
);
