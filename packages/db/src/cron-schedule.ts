export const INTERVAL_MINUTES = [5, 10, 15, 30, 60, 120, 180, 360, 720] as const;
export type IntervalMinutes = (typeof INTERVAL_MINUTES)[number];

export type CronSchedule =
  | { kind: "interval"; intervalMinutes: IntervalMinutes; timezone: string }
  | { kind: "daily"; timeOfDay: number; timezone: string }
  | { kind: "weekly"; weekday: number; timeOfDay: number; timezone: string };

const WEEKDAY_SHORT: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
};

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedFormatter(timezone: string): Intl.DateTimeFormat {
  let formatter = zonedFormatterCache.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    });
    zonedFormatterCache.set(timezone, formatter);
  }
  return formatter;
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const parts = getZonedFormatter(timezone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  const weekdayShort = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
    weekday: WEEKDAY_SHORT[weekdayShort] ?? 0,
  };
}

function compareCivil(
  parts: ZonedParts,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  if (parts.year !== year) return parts.year - year;
  if (parts.month !== month) return parts.month - month;
  if (parts.day !== day) return parts.day - day;
  if (parts.hour !== hour) return parts.hour - hour;
  return parts.minute - minute;
}

function zonedCivilToUtc(
  timezone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  let low = naive - 26 * 60 * 60 * 1000;
  let high = naive + 26 * 60 * 60 * 1000;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const parts = getZonedParts(new Date(mid), timezone);
    const cmp = compareCivil(parts, year, month, day, hour, minute);
    if (cmp < 0) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return new Date(low);
}

function addLocalDays(
  timezone: string,
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const noonUtc = zonedCivilToUtc(timezone, year, month, day, 12, 0);
  const shifted = new Date(noonUtc.getTime() + days * 24 * 60 * 60 * 1000);
  const parts = getZonedParts(shifted, timezone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

function nextIntervalFireAt(
  intervalMinutes: IntervalMinutes,
  timezone: string,
  from: Date,
): Date {
  const instant = new Date(from.getTime() + 1);
  const parts = getZonedParts(instant, timezone);
  const minutesFromMidnight = parts.hour * 60 + parts.minute;
  let alignedMinutes =
    Math.floor(minutesFromMidnight / intervalMinutes) * intervalMinutes;

  let candidate = zonedCivilToUtc(
    timezone,
    parts.year,
    parts.month,
    parts.day,
    Math.floor(alignedMinutes / 60),
    alignedMinutes % 60,
  );

  if (candidate <= from) {
    alignedMinutes += intervalMinutes;
    let year = parts.year;
    let month = parts.month;
    let day = parts.day;

    if (alignedMinutes >= 24 * 60) {
      alignedMinutes -= 24 * 60;
      ({ year, month, day } = addLocalDays(timezone, year, month, day, 1));
    }

    candidate = zonedCivilToUtc(
      timezone,
      year,
      month,
      day,
      Math.floor(alignedMinutes / 60),
      alignedMinutes % 60,
    );
  }

  return candidate;
}

function nextDailyFireAt(timeOfDay: number, timezone: string, from: Date): Date {
  const instant = new Date(from.getTime() + 1);
  const parts = getZonedParts(instant, timezone);
  const hour = Math.floor(timeOfDay / 60);
  const minute = timeOfDay % 60;

  let candidate = zonedCivilToUtc(
    timezone,
    parts.year,
    parts.month,
    parts.day,
    hour,
    minute,
  );

  if (candidate <= from) {
    const nextDay = addLocalDays(timezone, parts.year, parts.month, parts.day, 1);
    candidate = zonedCivilToUtc(
      timezone,
      nextDay.year,
      nextDay.month,
      nextDay.day,
      hour,
      minute,
    );
  }

  return candidate;
}

function nextWeeklyFireAt(
  weekday: number,
  timeOfDay: number,
  timezone: string,
  from: Date,
): Date {
  const instant = new Date(from.getTime() + 1);
  const parts = getZonedParts(instant, timezone);
  const hour = Math.floor(timeOfDay / 60);
  const minute = timeOfDay % 60;

  let year = parts.year;
  let month = parts.month;
  let day = parts.day;
  let currentWeekday = parts.weekday;

  let daysAhead = (weekday - currentWeekday + 7) % 7;
  if (daysAhead === 0) {
    const todayCandidate = zonedCivilToUtc(timezone, year, month, day, hour, minute);
    if (todayCandidate > from) {
      return todayCandidate;
    }
    daysAhead = 7;
  }

  const target = addLocalDays(timezone, year, month, day, daysAhead);
  return zonedCivilToUtc(
    timezone,
    target.year,
    target.month,
    target.day,
    hour,
    minute,
  );
}

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function computeNextFireAt(schedule: CronSchedule, from: Date): Date {
  if (!isValidTimeZone(schedule.timezone)) {
    throw new Error(`Invalid timezone: ${schedule.timezone}`);
  }

  switch (schedule.kind) {
    case "interval":
      return nextIntervalFireAt(schedule.intervalMinutes, schedule.timezone, from);
    case "daily":
      return nextDailyFireAt(schedule.timeOfDay, schedule.timezone, from);
    case "weekly":
      return nextWeeklyFireAt(
        schedule.weekday,
        schedule.timeOfDay,
        schedule.timezone,
        from,
      );
  }
}
