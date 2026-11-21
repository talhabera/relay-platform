import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INTERVAL_MINUTES as dbIntervalMinutes } from "@relay/db/cron-schedule";
import { INTERVAL_MINUTES, createCronJobSchema } from "./cron";

const agentId = "660e8400-e29b-41d4-a716-446655440001";
const versionId = "770e8400-e29b-41d4-a716-446655440002";

const base = {
  agentId,
  versionId,
  name: "Daily sync",
  prompt: "Run the sync",
  timezone: "UTC",
  enabled: true,
};

describe("createCronJobSchema", () => {
  it("does not import @relay/db (Next transpilePackages would pull postgres into the client)", () => {
    const src = readFileSync(path.join(import.meta.dirname, "cron.ts"), "utf8");
    expect(src).not.toMatch(/from ["']@relay\/db/);
  });

  it("keeps INTERVAL_MINUTES in sync with the db package", () => {
    expect([...INTERVAL_MINUTES]).toEqual([...dbIntervalMinutes]);
  });

  it("rejects interval minutes not in INTERVAL_MINUTES", () => {
    expect(() =>
      createCronJobSchema.parse({
        ...base,
        scheduleKind: "interval",
        intervalMinutes: 7,
      }),
    ).toThrow(/intervalMinutes/);
  });

  it("accepts a valid interval schedule", () => {
    const result = createCronJobSchema.parse({
      ...base,
      scheduleKind: "interval",
      intervalMinutes: 30,
    });

    expect(result.intervalMinutes).toBe(30);
  });

  it("requires timeOfDay for daily schedules", () => {
    expect(() =>
      createCronJobSchema.parse({
        ...base,
        scheduleKind: "daily",
      }),
    ).toThrow(/timeOfDay/);
  });

  it("requires weekday and timeOfDay for weekly schedules", () => {
    expect(() =>
      createCronJobSchema.parse({
        ...base,
        scheduleKind: "weekly",
        weekday: 1,
      }),
    ).toThrow(/timeOfDay/);
  });

  it("rejects invalid timezones", () => {
    expect(() =>
      createCronJobSchema.parse({
        ...base,
        scheduleKind: "daily",
        timeOfDay: 540,
        timezone: "Not/A/Timezone",
      }),
    ).toThrow(/timezone/);
  });
});
