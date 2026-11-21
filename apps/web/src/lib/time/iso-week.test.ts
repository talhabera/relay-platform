import { describe, expect, it } from "vitest";
import { isoWeekId, isoWeekRange, isoWeekStart, localDayRange, shiftIsoWeek } from ".";

const d = (iso: string) => new Date(iso);
const hours = (r: { from: Date; to: Date }) =>
  (r.to.getTime() - r.from.getTime()) / 3_600_000;

describe("isoWeekRange", () => {
  it("runs Monday 00:00 to next Monday 00:00 in UTC", () => {
    const r = isoWeekRange(d("2026-10-07T12:00:00Z"), "UTC");
    expect(r.from.toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("puts Monday 00:00 in the new week and the instant before in the old one", () => {
    const tz = "Europe/Istanbul"; // UTC+3, no DST
    const monday = d("2026-10-04T21:00:00Z");
    expect(isoWeekStart(monday, tz).toISOString()).toBe(monday.toISOString());
    const before = isoWeekRange(new Date(monday.getTime() - 1), tz);
    expect(before.to.toISOString()).toBe(monday.toISOString());
    expect(before.from.toISOString()).toBe("2026-09-27T21:00:00.000Z");
  });

  it("reads the day in company time, not UTC", () => {
    const at = d("2026-10-04T22:30:00Z"); // Sunday in UTC, Monday 00:30 in Berlin
    expect(isoWeekStart(at, "UTC").toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(isoWeekStart(at, "Europe/Berlin").toISOString()).toBe(
      "2026-10-04T22:00:00.000Z",
    );
  });

  it("is 167 hours long across spring-forward (Berlin, 29 Mar 2026)", () => {
    const r = isoWeekRange(d("2026-03-29T12:00:00Z"), "Europe/Berlin");
    expect(r.from.toISOString()).toBe("2026-03-22T23:00:00.000Z"); // CET
    expect(r.to.toISOString()).toBe("2026-03-29T22:00:00.000Z"); // CEST
    expect(hours(r)).toBe(167);
  });

  it("is 169 hours long across fall-back (Berlin, 25 Oct 2026)", () => {
    const r = isoWeekRange(d("2026-10-25T01:30:00Z"), "Europe/Berlin");
    expect(r.from.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(hours(r)).toBe(169);
  });

  it("handles a US DST week (New York, 8 Mar 2026)", () => {
    const r = isoWeekRange(d("2026-03-08T07:30:00Z"), "America/New_York");
    expect(r.from.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("weeks on either side of a DST change tile with no gap or overlap", () => {
    const tz = "Europe/Berlin";
    const a = isoWeekRange(d("2026-10-21T12:00:00Z"), tz);
    const b = isoWeekRange(a.to, tz);
    expect(b.from.toISOString()).toBe(a.to.toISOString());
    expect(hours(b)).toBe(168);
  });

  it("starts at the first instant of Monday when midnight is skipped (Tehran, 22 Mar 2021)", () => {
    const tz = "Asia/Tehran"; // 00:00 -> 01:00, +03:30 -> +04:30
    const r = isoWeekRange(d("2021-03-24T12:00:00Z"), tz);
    expect(r.from.toISOString()).toBe("2021-03-21T20:30:00.000Z");
    expect(isoWeekRange(new Date(r.from.getTime() - 1), tz).to.toISOString()).toBe(
      r.from.toISOString(),
    );
  });

  it("refuses an invalid timezone", () => {
    expect(() => isoWeekRange(new Date(), "Not/AZone")).toThrow(RangeError);
  });
});

describe("shiftIsoWeek", () => {
  it("steps back across a DST change", () => {
    const tz = "Europe/Berlin";
    const last = shiftIsoWeek(d("2026-04-01T12:00:00Z"), tz, -1);
    expect(last.from.toISOString()).toBe("2026-03-22T23:00:00.000Z");
    expect(last.to.toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });

  it("steps forward and returns the same week for 0", () => {
    const at = d("2026-10-07T12:00:00Z");
    expect(shiftIsoWeek(at, "UTC", 0)).toEqual(isoWeekRange(at, "UTC"));
    expect(shiftIsoWeek(at, "UTC", 2).from.toISOString()).toBe(
      "2026-10-19T00:00:00.000Z",
    );
  });
});

describe("isoWeekId", () => {
  it("labels weeks by ISO year", () => {
    expect(isoWeekId(d("2026-10-07T12:00:00Z"), "UTC")).toBe("2026-W41");
    expect(isoWeekId(d("2027-01-01T12:00:00Z"), "UTC")).toBe("2026-W53");
    expect(isoWeekId(d("2025-12-29T12:00:00Z"), "UTC")).toBe("2026-W01");
  });

  it("uses the company's local date", () => {
    // Sunday 4 Oct in UTC, Monday 5 Oct in Berlin.
    const at = d("2026-10-04T22:30:00Z");
    expect(isoWeekId(at, "UTC")).toBe("2026-W40");
    expect(isoWeekId(at, "Europe/Berlin")).toBe("2026-W41");
  });
});

describe("localDayRange", () => {
  it("cuts the local day in company time", () => {
    const r = localDayRange(d("2026-09-25T05:00:00Z"), "Europe/Berlin");
    expect(r.from.toISOString()).toBe("2026-09-24T22:00:00.000Z");
    expect(r.to.toISOString()).toBe("2026-09-25T22:00:00.000Z");
  });

  it("is 25 hours on the autumn DST day", () => {
    const r = localDayRange(d("2026-10-25T12:00:00Z"), "Europe/Berlin");
    expect(hours(r)).toBe(25);
  });
});
