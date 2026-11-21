import { reportPeriodRange } from "@relay/db/report-snapshots";

import type { ReportPeriod } from "@/lib/fixtures/interfaces";

import type { ReportArchiveEntry } from "./read";
import { reportRangeLabels, reportsHref } from "./view";

// View model of the report archive (S71, Figma 11a `11/reports/archive`).
// Pure. "Delivered" lists closed snapshots; until report email delivery lands
// (S88) a row is dated by when it was frozen, not when it was emailed.
// "Scheduled" is the open period of each kind and when it closes. Recipients
// and send times are agency settings that arrive with S88.

const PERIODS: readonly ReportPeriod[] = ["daily", "weekly", "monthly"];

export const REPORT_TITLE: Record<ReportPeriod, string> = {
  daily: "Daily report",
  weekly: "Weekly report",
  monthly: "Monthly report",
};

const CADENCE: Record<ReportPeriod, string> = {
  daily: "Every day",
  weekly: "Mondays",
  monthly: "On the 1st",
};

export type ArchiveFilter = ReportPeriod | null;

export type ArchiveDeliveredRow = {
  id: string;
  period: ReportPeriod;
  title: string;
  rangeLabel: string;
  /** When the report was frozen, e.g. "Fri 25 Sep, 08:00". */
  readyLabel: string;
  href: string;
};

export type ArchiveScheduledRow = {
  period: ReportPeriod;
  title: string;
  rangeLabel: string;
  /** When the open period closes, e.g. "Mon 28 Sep, 00:00". */
  closesLabel: string;
};

export type ArchiveView = {
  filter: ArchiveFilter;
  delivered: ArchiveDeliveredRow[];
  scheduled: ArchiveScheduledRow[];
  schedule: { period: ReportPeriod; title: string; cadence: string }[];
};

/** `?period=all|daily|weekly|monthly`; anything else is All (null). */
export function parseArchiveFilter(params: Record<string, string | string[] | undefined>): ArchiveFilter {
  const raw = Array.isArray(params.period) ? params.period[0] : params.period;
  return PERIODS.includes(raw as ReportPeriod) ? (raw as ReportPeriod) : null;
}

export function archiveHref(filter: ArchiveFilter): string {
  return filter ? `/client/reports/archive?period=${filter}` : "/client/reports/archive";
}

/** "Fri 25 Sep, 08:00" in company time. */
export function dayTimeLabel(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${read("weekday")} ${read("day")} ${read("month")}, ${read("hour")}:${read("minute")}`;
}

export function buildArchiveView(input: {
  entries: ReportArchiveEntry[];
  filter: ArchiveFilter;
  now: Date;
  timeZone: string;
}): ArchiveView {
  const { entries, filter, now, timeZone } = input;
  const periods = filter ? [filter] : PERIODS;

  const delivered = entries
    .filter((e) => periods.includes(e.period))
    .map((e) => ({
      id: e.id,
      period: e.period,
      title: REPORT_TITLE[e.period],
      rangeLabel: reportRangeLabels(e.period, e.start, e.end, timeZone).rangeLabel,
      readyLabel: dayTimeLabel(e.frozenAt, timeZone),
      href: reportsHref(e.period, e.id),
    }));

  const scheduled = periods.map((period) => {
    const open = reportPeriodRange(period, now, timeZone);
    return {
      period,
      title: REPORT_TITLE[period],
      rangeLabel: reportRangeLabels(period, open.from, open.to, timeZone).rangeLabel,
      closesLabel: dayTimeLabel(open.to, timeZone),
    };
  });

  return {
    filter,
    delivered,
    scheduled,
    schedule: PERIODS.map((period) => ({ period, title: REPORT_TITLE[period], cadence: CADENCE[period] })),
  };
}
