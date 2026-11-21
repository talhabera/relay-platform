import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  check,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";
import { companyRecords, type CompanyRecordStatus } from "./company-records";

/**
 * Lead event log (lead attribution spec, decision 1): one row per lead status
 * change, made by exactly one agent or one person. Leads per agent, stage
 * metric keys and the weekly target all count from this table, so it is
 * append-only and written only through `transitionLeadStatus` /
 * `insertLeadEvent` (`@relay/db/lead-events`).
 *
 * `agent_id` / `user_id` carry no foreign key on purpose: deleting an agent or
 * a user must neither erase the credit (cascade) nor break the exactly-one-actor
 * check (set null). The record and the company do cascade: their events have
 * nothing left to count.
 *
 * Statuses are plain text (no enum) because the lead status vocabulary changes
 * in S26; the TypeScript type follows `company_records.status`.
 */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    recordId: uuid("record_id")
      .notNull()
      .references(() => companyRecords.id, { onDelete: "cascade" }),
    /** Null for the event that creates the lead. */
    fromStatus: text("from_status").$type<CompanyRecordStatus>(),
    toStatus: text("to_status").$type<CompanyRecordStatus>().notNull(),
    agentId: uuid("agent_id"),
    userId: text("user_id"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * What a same-status event did (0053), e.g. a payment add or remove on a
     * won lead: `{ op, paymentId, kind }`. Null for a plain status move.
     */
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("lead_events_company_id_at_idx").on(table.companyId, table.at),
    index("lead_events_record_id_at_idx").on(table.recordId, table.at),
    index("lead_events_agent_id_at_idx").on(table.agentId, table.at),
    check(
      "lead_events_one_actor_chk",
      sql`num_nonnulls(agent_id, user_id) = 1`,
    ),
  ],
);
