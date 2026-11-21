import { describe, expect, it } from "vitest";
import {
  deliveredSeriesBuckets,
  isoWeekLabel,
  lastClosedReportPeriod,
  previousReportPeriod,
  reportPeriodRange,
  reportTimeZone,
} from "./report-periods";

const BERLIN = "Europe/Berlin";
const ISTANBUL = "Europe/Istanbul";
const iso = (d: Date) => d.toISOString();

describe("reportPeriodRange in company time", () => {
  it("cuts a day at local midnight", () => {
    // 2026-09-24 23:30 UTC is already Fri 25 Sep 02:30 in Istanbul (UTC+3).
    const r = reportPeriodRange("daily", new Date("2026-09-24T23:30:00Z"), ISTANBUL);
    expect(iso(r.from)).toBe("2026-09-24T21:00:00.000Z");
    expect(iso(r.to)).toBe("2026-09-25T21:00:00.000Z");
  });

  it("makes the DST spring-forward day 23 hours long", () => {
    const r = reportPeriodRange("daily", new Date("2026-03-29T12:00:00Z"), BERLIN);
    expect(iso(r.from)).toBe("2026-03-28T23:00:00.000Z");
    expect(iso(r.to)).toBe("2026-03-29T22:00:00.000Z");
  });

  it("starts a week Monday 00:00 and spans 169 h across the fall-back", () => {
    const r = reportPeriodRange("weekly", new Date("2026-10-28T12:00:00Z"), BERLIN);
    expect(iso(r.from)).toBe("2026-10-25T23:00:00.000Z"); // Mon 26 Oct 00:00 CET
    const sunday = reportPeriodRange("weekly", new Date("2026-10-25T12:00:00Z"), BERLIN);
    expect(iso(sunday.from)).toBe("2026-10-18T22:00:00.000Z"); // Mon 19 Oct 00:00 CEST
    expect((sunday.to.getTime() - sunday.from.getTime()) / 3_600_000).toBe(169);
  });

  it("starts a month on the 1st and rolls December into January", () => {
    const aug = reportPeriodRange("monthly", new Date("2026-08-15T00:00:00Z"), BERLIN);
    expect(iso(aug.from)).toBe("2026-07-31T22:00:00.000Z");
    expect(iso(aug.to)).toBe("2026-08-31T22:00:00.000Z");
    const dec = reportPeriodRange("monthly", new Date("2026-12-20T00:00:00Z"), "UTC");
    expect(iso(dec.to)).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("closed periods", () => {
  const now = new Date("2026-10-05T06:00:00Z"); // Mon 5 Oct 08:00 Berlin

  it("the last closed day, week and month at now", () => {
    expect(iso(lastClosedReportPeriod("daily", now, BERLIN).from)).toBe(
      "2026-10-03T22:00:00.000Z",
    );
    const week = lastClosedReportPeriod("weekly", now, BERLIN);
    expect(iso(week.from)).toBe("2026-09-27T22:00:00.000Z");
    expect(iso(week.to)).toBe("2026-10-04T22:00:00.000Z");
    const month = lastClosedReportPeriod("monthly", now, BERLIN);
    expect(iso(month.from)).toBe("2026-08-31T22:00:00.000Z");
    expect(iso(month.to)).toBe("2026-09-30T22:00:00.000Z");
  });

  it("the previous period is adjacent", () => {
    const month = lastClosedReportPeriod("monthly", now, BERLIN);
    const prev = previousReportPeriod("monthly", month, BERLIN);
    expect(prev.to.getTime()).toBe(month.from.getTime());
    expect(iso(prev.from)).toBe("2026-07-31T22:00:00.000Z");
  });
});

describe("deliveredSeriesBuckets", () => {
  it("weekly: seven local days", () => {
    const week = reportPeriodRange("weekly", new Date("2026-09-16T12:00:00Z"), BERLIN);
    const b = deliveredSeriesBuckets("weekly", week, BERLIN);
    expect(b.map((x) => x.label)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
      "2026-09-19",
      "2026-09-20",
    ]);
    expect(b[0].range.from.getTime()).toBe(week.from.getTime());
    expect(b[6].range.to.getTime()).toBe(week.to.getTime());
  });

  it("monthly: ISO weeks clipped to the month (August 2026 = W31-W36)", () => {
    const aug = reportPeriodRange("monthly", new Date("2026-08-15T00:00:00Z"), BERLIN);
    const b = deliveredSeriesBuckets("monthly", aug, BERLIN);
    expect(b.map((x) => x.label)).toEqual([
      "2026-W31",
      "2026-W32",
      "2026-W33",
      "2026-W34",
      "2026-W35",
      "2026-W36",
    ]);
    expect(b[0].range.from.getTime()).toBe(aug.from.getTime());
    expect(b.at(-1)!.range.to.getTime()).toBe(aug.to.getTime());
  });

  it("daily: none", () => {
    const day = reportPeriodRange("daily", new Date("2026-09-16T12:00:00Z"), BERLIN);
    expect(deliveredSeriesBuckets("daily", day, BERLIN)).toEqual([]);
  });
});

describe("helpers", () => {
  it("isoWeekLabel uses the ISO year", () => {
    expect(isoWeekLabel(new Date("2027-01-01T12:00:00Z"), "UTC")).toBe("2026-W53");
  });

  it("reportTimeZone falls back to UTC for a bad zone", () => {
    expect(reportTimeZone("Mars/Olympus")).toBe("UTC");
    expect(reportTimeZone(null)).toBe("UTC");
    expect(reportTimeZone(BERLIN)).toBe(BERLIN);
  });
});
