import { pgTable, text, uuid, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/**
 * Live feed event types (spec 2026-10-02-report-snapshots-and-live-feed).
 * Phase 1 emits the first four; `site_visit_booked` and `review_new` are typed
 * now and emitted once their connectors exist. There is deliberately no
 * per-message "agent answered" type: one `conversation_started` row per
 * conversation, the transcript holds the detail.
 */
export const PORTAL_EVENT_TYPES = [
  "lead_inbound_qualified",
  "lead_delivered",
  "handoff_sent",
  "conversation_started",
  "site_visit_booked",
  "review_new",
] as const;

export type PortalEventType = (typeof PORTAL_EVENT_TYPES)[number];

/** Channel a feed row came through; matches the fixture `LeadSource`. */
export const PORTAL_EVENT_CHANNELS = [
  "outbound",
  "whatsapp",
  "instagram",
  "widget",
  "shopify",
] as const;

export type PortalEventChannel = (typeof PORTAL_EVENT_CHANNELS)[number];

/**
 * Append-only: rows are inserted where each event happens (`emitPortalEvent`)
 * and tailed by the Live SSE. Nothing updates a row. `ref_id` points at the
 * lead, handoff request or chat behind the event; it is untyped text because
 * the target table depends on `type`, so it carries no foreign key.
 */
export const portalEvents = pgTable(
  "portal_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    type: text("type", { enum: PORTAL_EVENT_TYPES }).notNull(),
    at: timestamp("at").notNull().defaultNow(),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    channel: text("channel", { enum: PORTAL_EVENT_CHANNELS }),
    refId: text("ref_id"),
  },
  (table) => [
    index("portal_events_company_id_at_idx").on(table.companyId, table.at.desc()),
    check(
      "portal_events_type_chk",
      sql`type IN ('lead_inbound_qualified', 'lead_delivered', 'handoff_sent', 'conversation_started', 'site_visit_booked', 'review_new')`,
    ),
  ],
);
