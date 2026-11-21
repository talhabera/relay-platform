// Pure aggregation for the Live page (S90, spec 2026-10-02-report-snapshots-
// and-live-feed, Figma 11b "Conversations by hour" and "Sources today"). Hours
// are local to the company timezone; the series runs from 00:00 to the hour
// containing `now`, so a page opened at 11:52 shows 12 bars.

export type HourlyPoint = {
  /** Local hour of day, 0-23. */
  hour: number;
  /** e.g. `"09:00"`. */
  label: string;
  value: number;
};

export type HourlySeries = {
  points: HourlyPoint[];
  total: number;
  /** Local hour with the most conversations (earliest on a tie); null when empty. */
  busiestHour: number | null;
};

const hourFormatters = new Map<string, Intl.DateTimeFormat>();

function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = hourFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", hour: "2-digit" });
    hourFormatters.set(timeZone, f);
  }
  return f;
}

/** Local hour of day (0-23) of `at` in `timeZone`. */
export function localHour(at: Date, timeZone: string): number {
  const part = hourFormatter(timeZone)
    .formatToParts(at)
    .find((p) => p.type === "hour");
  return Number(part?.value ?? 0) % 24;
}

function label(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/**
 * Buckets `instants` that fall in `[day.from, now]` by local hour. On a DST
 * fall-back day the repeated hour shares one bar; on a spring-forward day the
 * skipped hour shows zero.
 */
export function hourlySeries(
  instants: readonly Date[],
  day: { from: Date; to: Date },
  now: Date,
  timeZone: string,
): HourlySeries {
  const end = Math.min(now.getTime(), day.to.getTime() - 1);
  const lastHour = end < day.from.getTime() ? -1 : localHour(new Date(end), timeZone);
  const counts = new Array<number>(lastHour + 1).fill(0);
  let total = 0;
  for (const at of instants) {
    const t = at.getTime();
    if (t < day.from.getTime() || t > end) continue;
    const h = localHour(at, timeZone);
    if (h > lastHour) continue;
    counts[h] += 1;
    total += 1;
  }
  let busiestHour: number | null = null;
  counts.forEach((n, h) => {
    if (n > 0 && (busiestHour === null || n > counts[busiestHour])) busiestHour = h;
  });
  return {
    points: counts.map((value, hour) => ({ hour, label: label(hour), value })),
    total,
    busiestHour,
  };
}

export type SourceCount = { channel: string; value: number };

/** Conversations per channel, largest first (ties by channel name). */
export function countBySource(channels: readonly string[]): SourceCount[] {
  const counts = new Map<string, number>();
  for (const c of channels) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts]
    .map(([channel, value]) => ({ channel, value }))
    .sort((a, b) => b.value - a.value || a.channel.localeCompare(b.channel));
}
