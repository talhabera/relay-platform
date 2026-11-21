import { describe, expect, it, vi } from "vitest";
import {
  dueReportPeriods,
  freezeDueReportSnapshots,
  frozenKey,
  type FreezeDeps,
} from "./freeze";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return { ...actual, db: {} };
});

const BERLIN = "Europe/Berlin";
// Mon 5 Oct 2026 00:30 Berlin: Sunday, the week and September all just closed.
const now = new Date("2026-10-04T22:30:00Z");
const company = { id: "c1", timezone: BERLIN, createdAt: new Date("2026-01-01T00:00:00Z") };

describe("dueReportPeriods", () => {
  it("freezes the closed day, week and month in company time", () => {
    const due = dueReportPeriods(company, now, new Set());
    expect(due.map((d) => [d.period, d.range.from.toISOString(), d.range.to.toISOString()])).toEqual([
      ["daily", "2026-10-03T22:00:00.000Z", "2026-10-04T22:00:00.000Z"],
      ["weekly", "2026-09-27T22:00:00.000Z", "2026-10-04T22:00:00.000Z"],
      ["monthly", "2026-08-31T22:00:00.000Z", "2026-09-30T22:00:00.000Z"],
    ]);
  });

  it("does not freeze before close: 23:30 Sunday in Berlin is still Sunday", () => {
    const before = new Date("2026-10-04T21:30:00Z");
    const weekly = dueReportPeriods(company, before, new Set()).find((d) => d.period === "weekly");
    expect(weekly?.range.to.toISOString()).toBe("2026-09-27T22:00:00.000Z");
  });

  it("skips periods already frozen and periods before the company existed", () => {
    const frozen = new Set([frozenKey("c1", "daily", new Date("2026-10-03T22:00:00Z"))]);
    expect(dueReportPeriods(company, now, frozen).map((d) => d.period)).toEqual([
      "weekly",
      "monthly",
    ]);
    const fresh = { ...company, createdAt: new Date("2026-10-02T00:00:00Z") };
    expect(dueReportPeriods(fresh, now, new Set()).map((d) => d.period)).toEqual([
      "daily",
      "weekly",
    ]);
  });

  it("falls back to UTC for a bad timezone", () => {
    const due = dueReportPeriods({ ...company, timezone: "Nope/Nowhere" }, now, new Set());
    expect(due[0].timeZone).toBe("UTC");
  });
});

describe("freezeDueReportSnapshots", () => {
  it("freezes every due period and keeps going after a failure", async () => {
    const freeze = vi.fn<FreezeDeps["freeze"]>(async (input) => {
      if (input.companyId === "bad") throw new Error("boom");
      return `${input.companyId}-${input.period}`;
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await freezeDueReportSnapshots(now, {
      listCompanies: async () => [company, { ...company, id: "bad" }],
      listFrozenKeys: async () => new Set(),
      freeze,
    });
    expect(result).toEqual({ frozen: 3, failed: 3 });
    expect(freeze).toHaveBeenCalledTimes(6);
    expect(freeze.mock.calls[0][0]).toMatchObject({ companyId: "c1", period: "daily", now });
    error.mockRestore();
  });
});
