import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  unique,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { agents } from "./agents";
import { users } from "./users";

export type AgentVersionStatus = "live" | "draft";

export type ToolToggles = {
  webSearch: boolean;
  excel: boolean;
  companyMemory: boolean;
  proposeAction: boolean;
};

export const DEFAULT_TOOL_TOGGLES: ToolToggles = {
  webSearch: false,
  excel: false,
  companyMemory: false,
  proposeAction: false,
};

export function normalizeToolToggles(
  value: (Partial<ToolToggles> & { httpApi?: boolean }) | null | undefined,
): ToolToggles {
  return {
    webSearch: value?.webSearch ?? false,
    excel: value?.excel ?? false,
    companyMemory: value?.companyMemory ?? false,
    proposeAction: value?.proposeAction ?? false,
  };
}

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentVersionId: uuid("parent_version_id"),
    /** Fork dialog "Change note", shown on the Version ticket (0042). */
    changeNote: text("change_note"),
    instructions: text("instructions"),
    toolToggles: jsonb("tool_toggles")
      .$type<ToolToggles>()
      .notNull()
      .default(DEFAULT_TOOL_TOGGLES),
    model: text("model", { enum: ["haiku", "sonnet", "opus"] })
      .notNull()
      .default("haiku"),
    status: text("status", { enum: ["live", "draft"] })
      .notNull()
      .default("draft"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("agent_versions_agent_id_name_idx").on(table.agentId, table.name),
    index("agent_versions_agent_id_idx").on(table.agentId),
    uniqueIndex("agent_versions_one_live_idx")
      .on(table.agentId)
      .where(sql`${table.status} = 'live'`),
  ],
);
