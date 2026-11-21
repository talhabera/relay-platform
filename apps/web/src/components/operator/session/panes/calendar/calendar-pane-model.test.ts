import { describe, expect, it } from "vitest";

import { contentCalendarFixture } from "./calendar-fixtures";
import {
  calendarCsv,
  calendarPaneMeta,
  calendarPaneState,
  monthCounts,
  monthGrid,
  monthLabel,
  parseMonth,
  postsByDate,
  shiftMonth,
  type CalendarPostItem,
} from "./calendar-pane-model";

const post = (over: Partial<CalendarPostItem>): CalendarPostItem => ({
  id: "p",
  date: "2026-10-01",
  title: "Post",
  platform: "instagram",
  status: "scheduled",
  ...over,
});

describe("calendarPaneState", () => {
  it("is connect until a social connector is connected", () => {
    expect(calendarPaneState({ socialConnected: false, calendar: contentCalendarFixture })).toBe("connect");
  });
  it("is empty when connected without a calendar or posts", () => {
    expect(calendarPaneState({ socialConnected: true, calendar: null })).toBe("empty");
    expect(calendarPaneState({ socialConnected: true, calendar: { month: "2026-10", posts: [] } })).toBe("empty");
  });
  it("is calendar when connected with posts", () => {
    expect(calendarPaneState({ socialConnected: true, calendar: contentCalendarFixture })).toBe("calendar");
  });
});

describe("months", () => {
  it("parses, labels and shifts months across years", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonth("nope")).toBeNull();
    expect(monthLabel({ year: 2026, month: 10 })).toBe("October 2026");
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("builds a Monday-first grid with leading and trailing days (October 2026 = 5 weeks)", () => {
    const weeks = monthGrid({ year: 2026, month: 10 });
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({ date: "2026-09-28", day: 28, inMonth: false });
    expect(weeks[0][3]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(weeks[4][6]).toEqual({ date: "2026-11-01", day: 1, inMonth: false });
  });

  it("uses 6 weeks when the month needs them", () => {
    // March 2026 starts on a Sunday.
    expect(monthGrid({ year: 2026, month: 3 })).toHaveLength(6);
  });
});

describe("counts and meta", () => {
  it("counts the canon fixture: 12 posts, 9 scheduled, 3 need review", () => {
    const counts = monthCounts(contentCalendarFixture.posts, { year: 2026, month: 10 });
    expect(counts).toEqual({ total: 12, scheduled: 9, needsReview: 3, draft: 0 });
    expect(calendarPaneMeta(counts, { year: 2026, month: 10 })).toBe("October 2026 · 12 posts · 3 need review");
  });

  it("ignores posts outside the month and singularizes", () => {
    const posts = [post({ status: "needs-review" }), post({ id: "q", date: "2026-11-02" })];
    const counts = monthCounts(posts, { year: 2026, month: 10 });
    expect(counts.total).toBe(1);
    expect(calendarPaneMeta(counts, { year: 2026, month: 10 })).toBe("October 2026 · 1 post · 1 needs review");
    expect(calendarPaneMeta(monthCounts([], { year: 2026, month: 10 }), { year: 2026, month: 10 })).toBe(
      "October 2026 · No posts",
    );
  });

  it("groups posts by date in their given order", () => {
    const map = postsByDate([post({ id: "a" }), post({ id: "b", date: "2026-10-02" }), post({ id: "c" })]);
    expect(map.get("2026-10-01")?.map((p) => p.id)).toEqual(["a", "c"]);
  });
});

describe("calendarCsv", () => {
  it("exports the month sorted by date with escaping and formula guard", () => {
    const csv = calendarCsv(
      [post({ id: "b", date: "2026-10-09", title: 'Brandt, "new" office' }), post({ title: "=SUM(A1)" })],
      { year: 2026, month: 10 },
    );
    expect(csv.split("\n")).toEqual([
      "date,platform,status,title",
      "2026-10-01,Instagram,Scheduled,'=SUM(A1)",
      '2026-10-09,Instagram,Scheduled,"Brandt, ""new"" office"',
    ]);
  });
});
