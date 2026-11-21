// Content calendar work pane (05 session-calendar/default): pure model,
// client-safe. The content calendar data model is phase 2 (map #31), so the
// pane runs on fixtures (`calendar-fixtures.ts`) and shows a Connect empty
// state until a social connector (Meta or LinkedIn) is connected.

import type { CalendarPostPlatform, CalendarPostStatus } from "@/components/v2/work/calendar-post";

export type CalendarPostItem = {
  id: string;
  /** Local publish date, `YYYY-MM-DD` (no time zone math in the grid). */
  date: string;
  title: string;
  platform: CalendarPostPlatform;
  status: CalendarPostStatus;
};

export type ContentCalendar = {
  /** Month the agent is planning, `YYYY-MM`; the pane opens on it. */
  month: string;
  posts: CalendarPostItem[];
};

export type CalendarPaneState = "connect" | "empty" | "calendar";

export type CalendarMonth = { year: number; month: number };

export type CalendarDay = { date: string; day: number; inMonth: boolean };

export type MonthCounts = { total: number; scheduled: number; needsReview: number; draft: number };

export function calendarPaneState(args: {
  socialConnected: boolean;
  calendar: ContentCalendar | null;
}): CalendarPaneState {
  if (!args.socialConnected) return "connect";
  if (!args.calendar || args.calendar.posts.length === 0) return "empty";
  return "calendar";
}

export function parseMonth(value: string): CalendarMonth | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(m[1]), month };
}

export function shiftMonth({ year, month }: CalendarMonth, delta: number): CalendarMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthLabel({ year, month }: CalendarMonth): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Monday-first weeks covering the month, padded with the neighbouring months' days. */
export function monthGrid({ year, month }: CalendarMonth): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weekCount = Math.ceil((lead + daysInMonth) / 7);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(Date.UTC(year, month - 1, 1 - lead + w * 7 + d));
      week.push({
        date: isoDate(date),
        day: date.getUTCDate(),
        inMonth: date.getUTCMonth() === month - 1,
      });
    }
    weeks.push(week);
  }
  return weeks;
}

const monthPrefix = ({ year, month }: CalendarMonth) => `${year}-${pad(month)}-`;

export function postsInMonth(posts: CalendarPostItem[], m: CalendarMonth): CalendarPostItem[] {
  const prefix = monthPrefix(m);
  return posts.filter((p) => p.date.startsWith(prefix));
}

export function monthCounts(posts: CalendarPostItem[], m: CalendarMonth): MonthCounts {
  const counts: MonthCounts = { total: 0, scheduled: 0, needsReview: 0, draft: 0 };
  for (const p of postsInMonth(posts, m)) {
    counts.total++;
    if (p.status === "scheduled") counts.scheduled++;
    else if (p.status === "needs-review") counts.needsReview++;
    else counts.draft++;
  }
  return counts;
}

/** Header meta, e.g. "October 2026 · 12 posts · 3 need review". */
export function calendarPaneMeta(counts: MonthCounts, m: CalendarMonth): string {
  const parts = [monthLabel(m)];
  if (counts.total === 0) parts.push("No posts");
  else parts.push(`${counts.total} ${counts.total === 1 ? "post" : "posts"}`);
  if (counts.needsReview > 0) {
    parts.push(`${counts.needsReview} ${counts.needsReview === 1 ? "needs" : "need"} review`);
  }
  return parts.join(" · ");
}

export function postsByDate(posts: CalendarPostItem[]): Map<string, CalendarPostItem[]> {
  const map = new Map<string, CalendarPostItem[]>();
  for (const p of posts) {
    const list = map.get(p.date);
    if (list) list.push(p);
    else map.set(p.date, [p]);
  }
  return map;
}

export const PLATFORM_LABEL: Record<CalendarPostPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

export const STATUS_LABEL: Record<CalendarPostStatus, string> = {
  scheduled: "Scheduled",
  "needs-review": "Needs review",
  draft: "Draft",
};

function csvCell(value: string): string {
  // Formula-prefix escape: spreadsheets must not evaluate post titles.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/** CSV of the month's posts, sorted by date (the "Export" action). */
export function calendarCsv(posts: CalendarPostItem[], m: CalendarMonth): string {
  const rows = postsInMonth(posts, m)
    .toSorted((a, b) => a.date.localeCompare(b.date))
    .map((p) => [p.date, PLATFORM_LABEL[p.platform], STATUS_LABEL[p.status], p.title].map(csvCell).join(","));
  return ["date,platform,status,title", ...rows].join("\n");
}

/** Readable date for steering prompts, e.g. "Fri 9 Oct". */
export function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
  return `${weekday} ${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}
