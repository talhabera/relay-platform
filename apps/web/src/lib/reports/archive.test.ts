import { describe, expect, it } from "vitest";

import { fixtureData } from "@/lib/fixtures/data";

import { buildArchiveView, parseArchiveFilter } from "./archive";

const TZ = "Europe/Berlin";
// Sat 26 Sep 2026, 10:00 in Berlin: the frame's "today".
const NOW = new Date("2026-09-26T08:00:00Z");
const entries = [...fixtureData.reportSnapshots]
  .sort((a, b) => b.end.getTime() - a.end.getTime())
  .map(({ id, period, start, end, frozenAt }) => ({ id, period, start, end, frozenAt }));

describe("parseArchiveFilter", () => {
  it("defaults to all and ignores unknown periods", () => {
    expect(parseArchiveFilter({})).toBeNull();
    expect(parseArchiveFilter({ period: "all" })).toBeNull();
    expect(parseArchiveFilter({ period: "yearly" })).toBeNull();
    expect(parseArchiveFilter({ period: "weekly" })).toBe("weekly");
    expect(parseArchiveFilter({ period: ["monthly", "daily"] })).toBe("monthly");
  });
});

describe("buildArchiveView (Figma 11a reports/archive)", () => {
  it("lists closed reports newest first with their range, ready time and report link", () => {
    const view = buildArchiveView({ entries, filter: null, now: NOW, timeZone: TZ });
    expect(view.delivered.map((r) => [r.title, r.rangeLabel, r.readyLabel])).toEqual([
      ["Daily report", "Thu 24 Sep 2026", "Fri 25 Sep, 08:00"],
      ["Daily report", "Wed 23 Sep 2026", "Thu 24 Sep, 08:00"],
      ["Daily report", "Tue 22 Sep 2026", "Wed 23 Sep, 08:00"],
      ["Weekly report", "14–20 Sep 2026", "Mon 21 Sep, 08:00"],
      ["Weekly report", "7–13 Sep 2026", "Mon 14 Sep, 08:00"],
      ["Monthly report", "August 2026", "Tue 1 Sep, 08:00"],
    ]);
    expect(view.delivered[0].href).toBe("/client/reports?period=daily&id=fx-report-d0924");
    expect(view.delivered[5].href).toBe("/client/reports?period=monthly&id=fx-report-m2608");
  });

  it("schedules the open period of each kind, closing at its end in company time", () => {
    const view = buildArchiveView({ entries, filter: null, now: NOW, timeZone: TZ });
    expect(view.scheduled.map((r) => [r.title, r.rangeLabel, r.closesLabel])).toEqual([
      ["Daily report", "Sat 26 Sep 2026", "Sun 27 Sep, 00:00"],
      ["Weekly report", "21–27 Sep 2026", "Mon 28 Sep, 00:00"],
      ["Monthly report", "September 2026", "Thu 1 Oct, 00:00"],
    ]);
  });

  it("filters both lists by period", () => {
    const view = buildArchiveView({ entries, filter: "weekly", now: NOW, timeZone: TZ });
    expect(view.delivered.every((r) => r.period === "weekly")).toBe(true);
    expect(view.scheduled.map((r) => r.period)).toEqual(["weekly"]);
    expect(view.filter).toBe("weekly");
  });

  it("shows the agency-set cadence for every period", () => {
    const view = buildArchiveView({ entries: [], filter: "daily", now: NOW, timeZone: TZ });
    expect(view.delivered).toEqual([]);
    expect(view.schedule.map((s) => [s.title, s.cadence])).toEqual([
      ["Daily report", "Every day"],
      ["Weekly report", "Mondays"],
      ["Monthly report", "On the 1st"],
    ]);
  });
});
