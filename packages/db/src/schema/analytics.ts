import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { agents } from "./agents";

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    integrationType: text("integration_type"),
    event: text("event").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    timestamp: timestamp("timestamp").notNull().defaultNow(),
  },
  (table) => [
    index("analytics_events_company_id_idx").on(table.companyId),
    index("analytics_events_agent_id_idx").on(table.agentId),
    index("analytics_events_timestamp_idx").on(table.timestamp),
  ]
);
