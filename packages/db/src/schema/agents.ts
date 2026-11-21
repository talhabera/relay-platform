import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { workflows } from "./workflows";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").default(true),
    responseLength: text("response_length", {
      enum: ["short", "medium", "long"],
    }).default("medium"),
    language: text("language", {
      enum: ["en", "es", "fr", "de", "tr"],
    }).default("en"),
    memoryEnabled: boolean("memory_enabled").default(true),
    persona: text("persona", {
      enum: ["friendly", "professional", "casual", "expert"],
    }).default("professional"),
    kind: text("kind", { enum: ["customer", "operator"] })
      .notNull()
      .default("customer"),
    model: text("model", { enum: ["haiku", "sonnet", "opus"] })
      .notNull()
      .default("haiku"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    packageSlug: text("package_slug"),
    /**
     * Customer agents only (lead scoring spec, decision 8): registers the
     * `record_lead` tool. Off for new agents; migration 0033 turned it on for
     * every customer agent that had the always-on `captureLead`.
     */
    leadCaptureEnabled: boolean("lead_capture_enabled").notNull().default(false),
    /** Workflow the recorded leads feed; its intake list is the checklist. */
    leadCaptureWorkflowId: uuid("lead_capture_workflow_id").references(
      (): AnyPgColumn => workflows.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("agents_company_id_idx").on(table.companyId),
    index("agents_kind_idx").on(table.kind),
    // 0041 dropped the unique index: a package now installs several agents
    // (Lead engine has three). One install per company is package_installs'.
    index("agents_company_package_slug_idx")
      .on(table.companyId, table.packageSlug)
      .where(sql`${table.packageSlug} is not null`),
  ]
);
