import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { reportSnapshots } from "./report-snapshots";
import { users } from "./users";

/**
 * `pending` is claimed before the Resend call (so a crash never double-sends),
 * `sent` once Resend accepted it, `failed` when it refused or the call threw.
 * `delivered` / `bounced` are reserved for a Resend webhook (not wired yet).
 */
export const REPORT_EMAIL_STATUSES = [
  "pending",
  "sent",
  "failed",
  "delivered",
  "bounced",
] as const;
export type ReportEmailStatus = (typeof REPORT_EMAIL_STATUSES)[number];

/**
 * One report email to one client user (S88). The report archive reads these
 * for Emailed / Delivered and Sent-to. `email` is the address at send time,
 * so the archive still shows it after the user changes theirs.
 */
export const reportEmailDeliveries = pgTable(
  "report_email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => reportSnapshots.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    status: text("status", { enum: REPORT_EMAIL_STATUSES }).notNull().default("pending"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("report_email_deliveries_snapshot_email_uidx").on(
      table.snapshotId,
      table.email,
    ),
    index("report_email_deliveries_company_idx").on(table.companyId),
    check(
      "report_email_deliveries_status_chk",
      sql`status IN ('pending', 'sent', 'failed', 'delivered', 'bounced')`,
    ),
  ],
);
