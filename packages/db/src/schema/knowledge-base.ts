import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  jsonb,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { companies } from "./companies";

export const knowledgeBase = pgTable(
  "knowledge_base",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["file", "website", "api"] }).notNull(),
    content: text("content"),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    sourceUrl: text("source_url"),
    metadata: jsonb("metadata").$type<{
      title?: string;
      domain: string;
      wordCount: number;
      fetchedAt: string;
    }>(),
    errorMessage: text("error_message"),
    status: text("status", {
      enum: ["processing", "ready", "error"],
    }).default("processing"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_base_agent_id_idx").on(table.agentId),
    index("knowledge_base_company_id_idx").on(table.companyId),
  ]
);
