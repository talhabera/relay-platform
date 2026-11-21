import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companies } from "./companies";
import { users } from "./users";
import { projects } from "./projects";
import { dailyBriefs } from "./daily-briefs";

export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

/** `brief`: created from a Daily Manager brief item (`briefId` set). */
export const TASK_SOURCES = ["manual", "brief"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/**
 * A company task, optionally inside a project. `dueDate` is the
 * company-local `YYYY-MM-DD`, like `daily_briefs.local_date`.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status", { enum: TASK_STATUSES }).notNull().default("todo"),
    priority: text("priority", { enum: TASK_PRIORITIES })
      .notNull()
      .default("normal"),
    assigneeUserId: text("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    dueDate: text("due_date"),
    recurrence: text("recurrence", { enum: TASK_RECURRENCES })
      .notNull()
      .default("none"),
    source: text("source", { enum: TASK_SOURCES }).notNull().default("manual"),
    briefId: uuid("brief_id").references(() => dailyBriefs.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("tasks_company_status_idx").on(table.companyId, table.status),
    index("tasks_company_due_date_idx").on(table.companyId, table.dueDate),
    index("tasks_project_id_idx").on(table.projectId),
    check(
      "tasks_status_chk",
      sql`status IN ('todo', 'doing', 'blocked', 'done')`,
    ),
    check("tasks_priority_chk", sql`priority IN ('high', 'normal', 'low')`),
    check(
      "tasks_recurrence_chk",
      sql`recurrence IN ('none', 'daily', 'weekly', 'monthly')`,
    ),
    check("tasks_source_chk", sql`source IN ('manual', 'brief')`),
  ],
);

export type Task = InferSelectModel<typeof tasks>;
export type NewTask = InferInsertModel<typeof tasks>;
