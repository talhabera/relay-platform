import { describe, expect, it } from "vitest";
import { computeNextFireAt, isValidTimeZone } from "./cron-schedule";

describe("computeNextFireAt", () => {
  it("aligns 10-min and 30-min UTC jobs on :00 and :30", () => {
    const from = new Date("2026-08-28T12:00:00.001Z");
    const ten = computeNextFireAt(
      { kind: "interval", intervalMinutes: 10, timezone: "UTC" },
      from,
    );
    const thirty = computeNextFireAt(
      { kind: "interval", intervalMinutes: 30, timezone: "UTC" },
      from,
    );
    expect(ten.toISOString()).toBe("2026-08-28T12:10:00.000Z");
    expect(thirty.toISOString()).toBe("2026-08-28T12:30:00.000Z");
  });

  it("uses live (non-shared) slot at :10 for 10-min only", () => {
    const from = new Date("2026-08-28T12:09:00.000Z");
    const ten = computeNextFireAt(
      { kind: "interval", intervalMinutes: 10, timezone: "UTC" },
      from,
    );
    expect(ten.toISOString()).toBe("2026-08-28T12:10:00.000Z");
  });

  it("does not backfill: overdue 10-min jumps to next future slot", () => {
    const from = new Date("2026-08-28T13:07:00.000Z");
    const ten = computeNextFireAt(
      { kind: "interval", intervalMinutes: 10, timezone: "UTC" },
      from,
    );
    expect(ten.toISOString()).toBe("2026-08-28T13:10:00.000Z");
  });

  it("fires 2-hour interval on even UTC hours", () => {
    const from = new Date("2026-08-28T01:00:00.001Z");
    const next = computeNextFireAt(
      { kind: "interval", intervalMinutes: 120, timezone: "UTC" },
      from,
    );
    expect(next.toISOString()).toBe("2026-08-28T02:00:00.000Z");
  });

  it("schedules daily at 09:00 America/New_York", () => {
    const from = new Date("2026-08-28T16:00:00.000Z");
    const next = computeNextFireAt(
      { kind: "daily", timeOfDay: 9 * 60, timezone: "America/New_York" },
      from,
    );
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(next);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    expect(hour).toBe(9);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("rejects invalid timezones", () => {
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
  });
});
