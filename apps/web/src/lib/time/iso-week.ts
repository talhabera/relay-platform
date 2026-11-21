// ISO weeks in company time (lead attribution spec, decision 6): a week starts
// Monday 00:00 in `companies.timezone`. Weekly targets, stage metrics and
// report periods all cut their ranges here, as half-open `[from, to)` UTC
// instants. A DST week is 167 or 169 hours long, so the end is computed from
// the next Monday's wall clock, never as `from + 7 days`.

export type IsoWeekRange = { from: Date; to: Date };

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

/** Wall clock as if it were UTC, in ms. */
function civilMs(c: Civil): number {
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
}

/** UTC offset of `timeZone` at `instant`, in ms (whole seconds). */
function offsetAt(instant: number, timeZone: string): number {
  const whole = Math.floor(instant / 1000) * 1000;
  return civilMs(civilAt(whole, timeZone)) - whole;
}

const DAY_MS = 86_400_000;

/**
 * The instant a local midnight happens. If that midnight falls in a DST gap,
 * the first instant of the day (the wall clock after the jump).
 */
function localMidnightToUtc(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number {
  const wall = Date.UTC(year, month - 1, day);
  const before = wall - offsetAt(wall - DAY_MS, timeZone);
  const after = wall - offsetAt(wall + DAY_MS, timeZone);
  const exact = [before, after]
    .filter((t) => civilMs(civilAt(t, timeZone)) === wall)
    .sort((a, b) => a - b);
  // Overlap: the earlier instant. Gap: neither matches; `before` (the
  // pre-transition offset) lands just after the jump.
  return exact[0] ?? before;
}

// Local check rather than `@relay/db/cron-schedule`: Next rewrites that
// import to the postgres barrel, and these helpers must stay client-safe.
function assertTimeZone(timeZone: string): void {
  try {
    formatter(timeZone);
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }
}

/** The ISO week containing `at`, as `[Monday 00:00, next Monday 00:00)` in `timeZone`. */
export function isoWeekRange(at: Date, timeZone: string): IsoWeekRange {
  assertTimeZone(timeZone);
  const local = civilAt(at.getTime(), timeZone);
  const dayUtc = Date.UTC(local.year, local.month - 1, local.day);
  const sinceMonday = (new Date(dayUtc).getUTCDay() + 6) % 7;
  const monday = new Date(dayUtc - sinceMonday * DAY_MS);
  const next = new Date(monday.getTime() + 7 * DAY_MS);
  const from = localMidnightToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    timeZone,
  );
  const to = localMidnightToUtc(
    next.getUTCFullYear(),
    next.getUTCMonth() + 1,
    next.getUTCDate(),
    timeZone,
  );
  return { from: new Date(from), to: new Date(to) };
}

/** Start of the ISO week containing `at`, in `timeZone`. */
export function isoWeekStart(at: Date, timeZone: string): Date {
  return isoWeekRange(at, timeZone).from;
}

/** The week `offset` weeks from the one containing `at` (-1 = last week). */
export function shiftIsoWeek(
  at: Date,
  timeZone: string,
  offset: number,
): IsoWeekRange {
  let range = isoWeekRange(at, timeZone);
  for (let i = 0; i < Math.abs(offset); i++) {
    // Step from inside the neighbouring week: 3.5 days clears any DST shift.
    const probe =
      offset > 0
        ? range.to.getTime() + DAY_MS / 2
        : range.from.getTime() - DAY_MS / 2;
    range = isoWeekRange(new Date(probe), timeZone);
  }
  return range;
}

/** ISO week label of `at` in `timeZone`, e.g. `2026-W41`. */
export function isoWeekId(at: Date, timeZone: string): string {
  assertTimeZone(timeZone);
  const local = civilAt(at.getTime(), timeZone);
  const day = new Date(Date.UTC(local.year, local.month - 1, local.day));
  // The ISO year is the year of this week's Thursday.
  const thursday = new Date(
    day.getTime() + (3 - ((day.getUTCDay() + 6) % 7)) * DAY_MS,
  );
  const isoYear = thursday.getUTCFullYear();
  const jan1 = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday.getTime() - jan1) / DAY_MS / 7) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

/** The local day containing `at`, as `[00:00, next 00:00)` in `timeZone` (23 or 25 h on DST days). */
export function localDayRange(at: Date, timeZone: string): IsoWeekRange {
  assertTimeZone(timeZone);
  const local = civilAt(at.getTime(), timeZone);
  const next = new Date(Date.UTC(local.year, local.month - 1, local.day) + DAY_MS);
  return {
    from: new Date(localMidnightToUtc(local.year, local.month, local.day, timeZone)),
    to: new Date(
      localMidnightToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
    ),
  };
}
