import {
  pgTable,
  text,
  uuid,
  timestamp,
  unique,
  boolean,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";
import { users } from "./users";

// Agent users (spec 2026-10-02-approve-rights): one row per person on an
// operator agent, with independent `canEdit` / `canApprove` flags. The table
// keeps its original name; the agent creator and the company owner need no row.
export const operatorAgentEditors = pgTable(
  "operator_agent_editors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canEdit: boolean("can_edit").notNull().default(true),
    canApprove: boolean("can_approve").notNull().default(false),
    grantedByUserId: text("granted_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    unique("operator_agent_editors_agent_id_user_id_idx").on(
      table.agentId,
      table.userId,
    ),
  ],
);
