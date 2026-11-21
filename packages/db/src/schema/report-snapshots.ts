import {
  pgTable,
  text,
  uuid,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companies } from "./companies";

/** Report periods (report snapshot spec, decision 2). */
export const REPORT_PERIODS = ["daily", "weekly", "monthly"] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

/** Periods Insights may write a narrative onto (decision 1). */
export const NARRATIVE_REPORT_PERIODS = ["weekly", "monthly"] as const;
export type NarrativeReportPeriod = (typeof NARRATIVE_REPORT_PERIODS)[number];

/**
 * One number of a snapshot. `metricKey` comes from the metric-key catalog;
 * `previous` is the same metric over the period before (decision 6), null when
 * that period has no value (e.g. no scored lead was delivered).
 */
export type ReportSnapshotMetric = {
  metricKey: string;
  value: number;
  previous: number | null;
};

export type ReportSeriesPoint = { label: string; value: number };

export const REPORT_FUNNEL_STAGES = [
  "gathered",
  "qualified",
  "contacted",
  "delivered",
] as const;
export type ReportFunnelStage = (typeof REPORT_FUNNEL_STAGES)[number];

export type ReportFunnelStep = { stage: ReportFunnelStage; value: number };

/**
 * Delivered per day (weekly) or per ISO week (monthly; daily has none), and
 * the lead engine funnel Gathered > Qualified > Contacted > Delivered.
 */
export type ReportSnapshotSeries = {
  delivered: ReportSeriesPoint[];
  funnel: ReportFunnelStep[];
};

/** Written by the Insights Market Analyst; null without Insights. */
export type ReportNarrative = { summary: string; highlights: string[] };

/**
 * Frozen numbers of one closed day, week or month in company time (spec
 * 2026-10-02-report-snapshots-and-live-feed). The cron service inserts a row
 * once the period closes; afterwards only `narrative` may change, which a
 * trigger enforces (migration 0039). `[period_start, period_end)` is half-open.
 * A metric without a data source is absent from `metrics`: its card is hidden.
 */
export const reportSnapshots = pgTable(
  "report_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    period: text("period", { enum: REPORT_PERIODS }).notNull(),
    start: timestamp("period_start", { withTimezone: true }).notNull(),
    end: timestamp("period_end", { withTimezone: true }).notNull(),
    metrics: jsonb("metrics").$type<ReportSnapshotMetric[]>().notNull(),
    series: jsonb("series")
      .$type<ReportSnapshotSeries>()
      .notNull()
      .default({ delivered: [], funnel: [] }),
    narrative: jsonb("narrative").$type<ReportNarrative>(),
    frozenAt: timestamp("frozen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("report_snapshots_company_period_start_uidx").on(
      table.companyId,
      table.period,
      table.start,
    ),
    index("report_snapshots_period_start_idx").on(table.period, table.start),
    check(
      "report_snapshots_period_chk",
      sql`period IN ('daily', 'weekly', 'monthly')`,
    ),
    check("report_snapshots_range_chk", sql`period_end > period_start`),
  ],
);
