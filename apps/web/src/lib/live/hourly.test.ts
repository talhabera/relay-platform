import { describe, expect, it } from "vitest";
import { localDayRange } from "@/lib/time";
import { countBySource, hourlySeries, localHour } from "./hourly";

const TZ = "Europe/Berlin";

describe("hourlySeries", () => {
  it("buckets today's conversations by local hour up to now (Figma 11b)", () => {
    // Fri 25 Sep 2026, 11:52 CEST (UTC+2).
    const now = new Date("2026-09-25T09:52:00Z");
    const day = localDayRange(now, TZ);
    const local = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00+02:00`);
    const instants = [
      local("06:10"),
      local("07:30"),
      local("08:01"), local("08:59"),
      local("09:00"), local("09:15"), local("09:45"),
      local("10:05"), local("10:20"), local("10:40"),
      local("11:01"), local("11:10"), local("11:30"), local("11:50"),
      // Yesterday and after now are ignored.
      new Date("2026-09-24T23:30:00+02:00"),
      local("11:55"),
    ];
    const s = hourlySeries(instants, day, now, TZ);
    expect(s.points).toHaveLength(12);
    expect(s.points.map((p) => p.value)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 2, 3, 3, 4]);
    expect(s.points[11]).toEqual({ hour: 11, label: "11:00", value: 4 });
    expect(s.total).toBe(14);
    expect(s.busiestHour).toBe(11);
  });

  it("is empty with no busiest hour when nothing happened", () => {
    const now = new Date("2026-09-25T00:30:00Z"); // 02:30 local
    const s = hourlySeries([], localDayRange(now, TZ), now, TZ);
    expect(s.points.map((p) => p.hour)).toEqual([0, 1, 2]);
    expect(s.total).toBe(0);
    expect(s.busiestHour).toBeNull();
  });

  it("picks the earliest hour on a tie", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    const s = hourlySeries(
      [new Date("2026-09-25T08:00:00+02:00"), new Date("2026-09-25T10:00:00+02:00")],
      localDayRange(now, TZ),
      now,
      TZ,
    );
    expect(s.busiestHour).toBe(8);
  });

  it("uses local hours across a DST change (spring forward skips 02:00)", () => {
    // 29 Mar 2026: 02:00 CET jumps to 03:00 CEST.
    const now = new Date("2026-03-29T02:30:00Z"); // 04:30 CEST
    const s = hourlySeries([new Date("2026-03-29T01:10:00Z")], localDayRange(now, TZ), now, TZ);
    expect(localHour(new Date("2026-03-29T01:10:00Z"), TZ)).toBe(3);
    expect(s.points.map((p) => p.value)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe("countBySource", () => {
  it("counts per channel, largest first", () => {
    expect(
      countBySource(["widget", "whatsapp", "widget", "instagram", "widget", "whatsapp"]),
    ).toEqual([
      { channel: "widget", value: 3 },
      { channel: "whatsapp", value: 2 },
      { channel: "instagram", value: 1 },
    ]);
  });
});
