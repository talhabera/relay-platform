import type { ReportPeriod } from "./schema/report-snapshots";

// Report periods in company time (report snapshot spec, decision 2; lead
// attribution spec, decision 6). A day closes at the next local 00:00, a week
// at Monday 00:00, a month on the 1st. Ranges are half-open `[from, to)` UTC
// instants. DST days and weeks are 23/25 h and 167/169 h long, so every end is
// the next boundary's wall clock, never `from + n * 24h`.
//
// Same arithmetic as `apps/web/src/lib/time/iso-week.ts`; it lives here too
// because the cron service cannot import the web app.

export type PeriodRange = { from: Date; to: Date };

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

type Civil = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function civilAt(instant: number, timeZone: string): Civil {
  const parts = formatter(timeZone).formatToParts(new Date(instant));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function civilMs(c: Civil): number {
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
}

function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return civilMs(civilAt(whole, timeZone)) - whole;
}

/** The instant of local midnight; in a DST gap, the first instant of the day. */
function localMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day);
  const before = wall - offsetAt(wall - DAY_MS, timeZone);
  const after = wall - offsetAt(wall + DAY_MS, timeZone);
  const exact = [before, after]
    .filter((t) => civilMs(civilAt(t, timeZone)) === wall)
    .sort((a, b) => a - b);
  return new Date(exact[0] ?? before);
}

/** `timeZone` if Intl knows it, else UTC: a bad stored zone must not stop the freeze. */
export function reportTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    formatter(timeZone);
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Local calendar date of `at` (y, m 1-12, d). */
function localDate(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const c = civilAt(at.getTime(), timeZone);
  return { y: c.year, m: c.month, d: c.day };
}

/** The `period` containing `at`, in `timeZone`. */
export function reportPeriodRange(
  period: ReportPeriod,
  at: Date,
  timeZone: string,
): PeriodRange {
  const { y, m, d } = localDate(at, timeZone);
  if (period === "daily") {
    const next = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
    return {
      from: localMidnight(y, m, d, timeZone),
      to: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
    };
  }
  if (period === "weekly") {
    const dayUtc = Date.UTC(y, m - 1, d);
    const sinceMonday = (new Date(dayUtc).getUTCDay() + 6) % 7;
    const monday = new Date(dayUtc - sinceMonday * DAY_MS);
    const next = new Date(monday.getTime() + 7 * DAY_MS);
    return {
      from: localMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone),
      to: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
    };
  }
  const nextMonth = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return {
    from: localMidnight(y, m, 1, timeZone),
    to: localMidnight(nextMonth.y, nextMonth.m, 1, timeZone),
  };
}

/** The period just before `range` (same kind). */
export function previousReportPeriod(
  period: ReportPeriod,
  range: PeriodRange,
  timeZone: string,
): PeriodRange {
  return reportPeriodRange(period, new Date(range.from.getTime() - 1), timeZone);
}

/** The most recent closed `period` at `now`: the one before the current one. */
export function lastClosedReportPeriod(
  period: ReportPeriod,
  now: Date,
  timeZone: string,
): PeriodRange {
  return previousReportPeriod(period, reportPeriodRange(period, now, timeZone), timeZone);
}

/** Local date of `at` as `YYYY-MM-DD`. */
export function localDateLabel(at: Date, timeZone: string): string {
  const { y, m, d } = localDate(at, timeZone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** ISO week label of `at` in `timeZone`, e.g. `2026-W35`. */
export function isoWeekLabel(at: Date, timeZone: string): string {
  const { y, m, d } = localDate(at, timeZone);
  const day = Date.UTC(y, m - 1, d);
  const thursday = new Date(day + (3 - ((new Date(day).getUTCDay() + 6) % 7)) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const week = Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/**
 * Buckets for the delivered series: the local days of a week, the ISO weeks
 * of a month (clipped to the month), none for a day.
 */
export function deliveredSeriesBuckets(
  period: ReportPeriod,
  range: PeriodRange,
  timeZone: string,
): { label: string; range: PeriodRange }[] {
  if (period === "daily") return [];
  const unit: ReportPeriod = period === "weekly" ? "daily" : "weekly";
  const buckets: { label: string; range: PeriodRange }[] = [];
  let cursor = range.from;
  while (cursor.getTime() < range.to.getTime()) {
    const r = reportPeriodRange(unit, cursor, timeZone);
    const from = new Date(Math.max(r.from.getTime(), range.from.getTime()));
    const to = new Date(Math.min(r.to.getTime(), range.to.getTime()));
    buckets.push({
      label: unit === "daily" ? localDateLabel(from, timeZone) : isoWeekLabel(from, timeZone),
      range: { from, to },
    });
    cursor = to;
  }
  return buckets;
}
