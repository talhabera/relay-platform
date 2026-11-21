import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { cronJobs } from "./cron-jobs";

export type CronRunStatus =
  | "running"
  | "awaiting_input"
  | "succeeded"
  | "failed";

export const cronRuns = pgTable(
  "cron_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => cronJobs.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["running", "awaiting_input", "succeeded", "failed"],
    }).notNull(),
    fireAt: timestamp("fire_at").notNull(),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    error: text("error"),
    anthropicBatchId: text("anthropic_batch_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("cron_runs_job_id_idx").on(table.jobId),
    index("cron_runs_status_idx").on(table.status),
  ],
);
