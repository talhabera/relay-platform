import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * One browser that turned on Needs you notifications in Preferences (S102,
 * approve-rights spec decision 9). Push is per browser: each browser holds its
 * own row, keyed by the push service endpoint. Deleting the row (toggle off,
 * or the push service answers 404/410) stops notifications to that browser.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    /** Browser ECDH public key (base64url, uncompressed P-256 point). */
    p256dh: text("p256dh").notNull(),
    /** Browser auth secret (base64url, 16 bytes). */
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    /** Only Needs you items created at or after this raise a notification. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("push_subscriptions_user_idx").on(table.userId)],
);

/**
 * One row per Needs you item already pushed to one browser. The insert is the
 * claim: a second dispatcher (another web replica) loses the conflict and
 * skips, so every item raises at most one notification per browser.
 */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => pushSubscriptions.id, { onDelete: "cascade" }),
    /** Needs you item id (checkpoint, agent question or cron run id). */
    itemId: text("item_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.subscriptionId, table.itemId] })],
);

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
