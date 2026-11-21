import { describe, expect, it } from "vitest";

import { buildMonthGrid, capWarnings, monthDates, monthLimitMinor, monthSpendLabel } from "./spend-grid";

const CHANNELS = ["google", "instagram", "meta"] as const;

describe("monthDates", () => {
  it("lists every civil date of the month and can stop early", () => {
    expect(monthDates("2026-02")).toHaveLength(28);
    expect(monthDates("2026-11", "2026-11-03")).toEqual(["2026-11-01", "2026-11-02", "2026-11-03"]);
  });
});

describe("buildMonthGrid", () => {
  const rows = [
    { spendDate: "2026-11-01", channel: "google" as const, amountMinor: 30000 },
    { spendDate: "2026-11-01", channel: "instagram" as const, amountMinor: 0 },
    { spendDate: "2026-11-01", channel: "meta" as const, amountMinor: 20000 },
    { spendDate: "2026-11-02", channel: "google" as const, amountMinor: 10000 },
    { spendDate: "2026-11-02", channel: "google" as const, amountMinor: 5000 },
  ];
  const grid = buildMonthGrid(rows, "2026-11", CHANNELS, "2026-11-03");

  it("marks missing cells missing, never 0, and a typed 0 entered", () => {
    expect(grid.days).toHaveLength(3);
    expect(grid.days[0].cells.instagram).toEqual({ state: "entered", amountMinor: 0 });
    expect(grid.days[1].cells.meta).toEqual({ state: "missing" });
    expect(grid.days[2].cells.google).toEqual({ state: "missing" });
  });

  it("sums campaigns of one channel and day", () => {
    expect(grid.days[1].cells.google).toEqual({ state: "entered", amountMinor: 15000 });
  });

  it("gives a day total only when every channel is entered", () => {
    expect(grid.days[0]).toMatchObject({ totalMinor: 50000, partial: false });
    expect(grid.days[1]).toMatchObject({ totalMinor: null, partial: true, enteredMinor: 15000 });
    expect(grid.days[2]).toMatchObject({ totalMinor: null, partial: true, enteredMinor: 0 });
  });

  it("labels a month total over gaps with the missing day count", () => {
    expect(grid.enteredMinor).toBe(65000);
    expect(grid.missingDays).toBe(2);
    expect(monthSpendLabel(grid)).toBe("650 TL, eksik gün var (2)");
    expect(monthSpendLabel({ enteredMinor: 65000, missingDays: 0 })).toBe("650 TL");
  });
});

describe("capWarnings", () => {
  const cap = 100000;

  it("fires nothing at exactly the cap", () => {
    expect(
      capWarnings({ configuredDailyMinor: cap, days: [{ date: "2026-11-01", enteredMinor: cap }], capMinor: cap }),
    ).toEqual([]);
  });

  it("warns on configured budgets above the cap", () => {
    expect(capWarnings({ configuredDailyMinor: 100100, days: [], capMinor: cap })).toEqual([
      { kind: "configured-over-cap", configuredMinor: 100100, capMinor: cap },
    ]);
  });

  it("warns for each day whose actual spend is above the cap, independently", () => {
    const warnings = capWarnings({
      configuredDailyMinor: 50000,
      days: [
        { date: "2026-11-01", enteredMinor: 100100 },
        { date: "2026-11-02", enteredMinor: 90000 },
        { date: "2026-11-03", enteredMinor: 120000 },
      ],
      capMinor: cap,
    });
    expect(warnings.map((w) => w.kind)).toEqual(["actual-day-over-cap", "actual-day-over-cap"]);
    expect(warnings.map((w) => ("date" in w ? w.date : null))).toEqual(["2026-11-01", "2026-11-03"]);
  });

  it("fires both kinds together", () => {
    const kinds = capWarnings({
      configuredDailyMinor: 150000,
      days: [{ date: "2026-11-01", enteredMinor: 100100 }],
      capMinor: cap,
    }).map((w) => w.kind);
    expect(kinds).toEqual(["configured-over-cap", "actual-day-over-cap"]);
  });

  it("sets month-over-cap above cap x 30,4 only", () => {
    expect(monthLimitMinor(cap)).toBe(3040000);
    expect(capWarnings({ configuredDailyMinor: null, days: [], capMinor: cap, monthMinor: 3040000 })).toEqual([]);
    expect(capWarnings({ configuredDailyMinor: null, days: [], capMinor: cap, monthMinor: 3040001 })).toEqual([
      { kind: "month-over-cap", monthMinor: 3040001, limitMinor: 3040000 },
    ]);
  });
});
