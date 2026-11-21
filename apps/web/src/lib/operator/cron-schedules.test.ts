import { describe, expect, it } from "vitest";
import {
  formatCadence,
  formatRunTime,
  lastRunNote,
  lastRunResult,
  nextRunsLabel,
  promptSummary,
  runHref,
  scheduleHref,
  scheduleSummary,
  timesInLabel,
} from "./cron-schedules";

describe("formatCadence", () => {
  it("formats daily, weekly and interval schedules like the Figma cadence column", () => {
    expect(
      formatCadence({ scheduleKind: "daily", intervalMinutes: null, weekday: null, timeOfDay: 360 }),
    ).toBe("Daily · 06:00");
    expect(
      formatCadence({ scheduleKind: "weekly", intervalMinutes: null, weekday: 1, timeOfDay: 360 }),
    ).toBe("Mondays · 06:00");
    expect(
      formatCadence({ scheduleKind: "interval", intervalMinutes: 30, weekday: null, timeOfDay: null }),
    ).toBe("Every 30 min");
    expect(
      formatCadence({ scheduleKind: "interval", intervalMinutes: 60, weekday: null, timeOfDay: null }),
    ).toBe("Hourly");
    expect(
      formatCadence({ scheduleKind: "interval", intervalMinutes: 120, weekday: null, timeOfDay: null }),
    ).toBe("Every 2 h");
  });
});

describe("formatRunTime", () => {
  it("renders in the schedule timezone", () => {
    // 2026-09-26T04:00Z is 06:00 in Berlin (CEST).
    expect(formatRunTime("2026-09-26T04:00:00.000Z", "Europe/Berlin")).toBe("Sat 26 Sep, 06:00");
    expect(formatRunTime("2026-09-26T04:00:00.000Z", "UTC")).toBe("Sat 26 Sep, 04:00");
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(formatRunTime("2026-09-26T04:00:00.000Z", "Not/AZone")).toBe("Sat 26 Sep, 04:00");
  });
});

describe("lastRunResult", () => {
  it("maps run status to chip tone and label", () => {
    expect(lastRunResult("failed")).toEqual({ result: "error", label: "Failed" });
    expect(lastRunResult("succeeded")).toEqual({ result: "success", label: "Succeeded" });
    expect(lastRunResult("awaiting_input")).toEqual({ result: "needs-you", label: "Needs you" });
    expect(lastRunResult("running")).toEqual({ result: "pending", label: "Running" });
    expect(lastRunResult(null)).toBeNull();
  });
});

describe("lastRunNote", () => {
  it("shows the error for a failed run and the fire time otherwise", () => {
    const base = { id: "r1", fireAt: "2026-09-26T04:00:00.000Z" };
    expect(
      lastRunNote({ ...base, status: "failed", error: "Google Places quota reached\nstack" }, "UTC"),
    ).toBe("Google Places quota reached");
    expect(lastRunNote({ ...base, status: "succeeded", error: null }, "UTC")).toBe("Sat 26 Sep, 04:00");
    expect(lastRunNote(null, "UTC")).toBeUndefined();
  });
});

describe("scheduleHref", () => {
  it("links the Schedules tab and a job's editor; runs open as sessions", () => {
    expect(scheduleHref()).toBe("/operator?tab=cron");
    expect(scheduleHref("j1")).toBe("/operator?tab=cron&jobId=j1");
    expect(runHref("r1")).toBe("/operator?runId=r1");
  });
});

describe("scheduleSummary and timesInLabel", () => {
  it("counts failed, waiting and paused schedules", () => {
    expect(
      scheduleSummary([
        { enabled: true, latestStatus: "failed" },
        { enabled: true, latestStatus: "awaiting_input" },
        { enabled: false, latestStatus: null },
      ]),
    ).toEqual({ total: 3, failed: 1, waiting: 1, paused: 1 });
  });

  it("names the shared zone or falls back to per-schedule zones", () => {
    expect(timesInLabel([{ timezone: "Europe/Berlin" }, { timezone: "Europe/Berlin" }])).toBe(
      "Times in Europe/Berlin",
    );
    expect(timesInLabel([{ timezone: "UTC" }, { timezone: "Europe/Berlin" }])).toBe(
      "Times in each schedule's timezone",
    );
  });
});

describe("promptSummary", () => {
  it("uses the first prompt line, shortened", () => {
    expect(promptSummary("Gather leads\nmore")).toBe("Gather leads");
    expect(promptSummary("   ")).toBe("No instructions");
    expect(promptSummary("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("nextRunsLabel", () => {
  it("collapses a shared clock time", () => {
    expect(
      nextRunsLabel(
        ["2026-09-29T09:00:00.000Z", "2026-09-30T09:00:00.000Z", "2026-10-01T09:00:00.000Z"],
        "UTC",
      ),
    ).toBe("Next runs: Tue 29 Sep, Wed 30 Sep, Thu 1 Oct · 09:00");
    expect(nextRunsLabel([], "UTC")).toBeNull();
  });
});
