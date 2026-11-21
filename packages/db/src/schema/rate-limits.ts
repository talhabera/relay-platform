import {
  pgTable,
  text,
  uuid,
  timestamp,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

/**
 * Sliding-window request counters. One row per (key, fixed window); the
 * limiter weighs the previous window against the current one, so only two rows
 * per key are ever live. `expires_at` lets the cron prune sweep old windows.
 */
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.windowStart] }),
    index("rate_limit_counters_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Concurrency leases: one row per in-flight unit of work (a streaming chat
 * turn). A lease that is never released expires, so a crashed process cannot
 * lock a user out for longer than the policy's TTL.
 */
export const rateLimitLeases = pgTable(
  "rate_limit_leases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("rate_limit_leases_key_idx").on(table.key, table.expiresAt),
    index("rate_limit_leases_expires_idx").on(table.expiresAt),
  ],
);
