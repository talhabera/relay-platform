import {
  pgTable,
  text,
  uuid,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { agents } from "./agents";
import { agentVersions } from "./agent-versions";
import { users } from "./users";

export type ScheduleKind = "interval" | "daily" | "weekly";

/**
 * Why a Schedule is off without anyone turning it off (packages spec,
 * decision 6). `waiting_for_connectors`: a package Schedule created paused
 * because a required connector is missing; it resumes on its own once the
 * last required connector connects.
 */
export const CRON_PAUSED_REASONS = ["waiting_for_connectors"] as const;
export type CronPausedReason = (typeof CRON_PAUSED_REASONS)[number];

export const cronJobs = pgTable(
  "cron_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    versionId: uuid("version_id")
      .notNull()
      .references(() => agentVersions.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    scheduleKind: text("schedule_kind", {
      enum: ["interval", "daily", "weekly"],
    }).notNull(),
    intervalMinutes: integer("interval_minutes"),
    weekday: integer("weekday"),
    timeOfDay: integer("time_of_day"),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    /** Set only while `enabled` is false for a system reason. */
    pausedReason: text("paused_reason", { enum: CRON_PAUSED_REASONS }),
    /** Package that installed this Schedule; null for hand-made Schedules. */
    packageSlug: text("package_slug"),
    nextFireAt: timestamp("next_fire_at").notNull(),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("cron_jobs_company_id_idx").on(table.companyId),
    index("cron_jobs_next_fire_at_idx").on(table.nextFireAt),
    index("cron_jobs_company_package_slug_idx").on(
      table.companyId,
      table.packageSlug,
    ),
  ],
);
