import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import type { CompanyKpis } from "@/lib/metrics";
import { buildLiveSummary, type LiveSources } from "./summary";

const COMPANY = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-09-25T09:52:00Z"); // Fri 11:52 CEST
const WEEK = {
  from: new Date("2026-09-20T22:00:00Z"),
  to: new Date("2026-09-27T22:00:00Z"),
};

const kpis: CompanyKpis = {
  weekId: "2026-W39",
  range: WEEK,
  timeZone: "Europe/Berlin",
  qualifiedDelivered: 6,
  inbound: 3,
  qualityScore: 82,
  costPerQualifiedLead: { tokens: 600_000, tokensPerLead: 100_000, estimatedUsdPerLead: 1.2 },
};

function sources(overrides: Partial<LiveSources> = {}): LiveSources {
  return {
    timeZone: async () => "Europe/Berlin",
    kpis: async () => kpis,
    weeklyTarget: async () => ({ metricKey: "leads.qualified_delivered", weeklyTarget: 10 }),
    metricValue: vi.fn(async () => 99),
    conversationsStarted: async () => [
      { at: new Date("2026-09-25T09:10:00+02:00"), channel: "widget" },
      { at: new Date("2026-09-25T11:05:00+02:00"), channel: "whatsapp" },
      { at: new Date("2026-09-25T11:30:00+02:00"), channel: "widget" },
    ],
    countFeedEvents: async () => 3,
    openHandoffs: async () => ({ count: 1, oldestAt: new Date("2026-09-25T09:46:00Z") }),
    ...overrides,
  };
}

describe("buildLiveSummary", () => {
  it("assembles week-to-date KPIs and today's strip in company time", async () => {
    const s = await buildLiveSummary(sources(), COMPANY, NOW);
    expect(s).not.toBeNull();
    expect(s!.timeZone).toBe("Europe/Berlin");
    expect(s!.week).toEqual({
      weekId: "2026-W39",
      range: WEEK,
      qualifiedDelivered: 6,
      inbound: 3,
      qualityScore: 82,
      costPerQualifiedLead: kpis.costPerQualifiedLead,
      target: { metricKey: "leads.qualified_delivered", weeklyTarget: 10, value: 6 },
    });
    expect(s!.today.range.from).toEqual(new Date("2026-09-24T22:00:00Z"));
    expect(s!.today.conversations).toBe(3);
    expect(s!.today.inboundQualified).toBe(3);
    expect(s!.today.waitingForStaff.count).toBe(1);
    expect(s!.today.hourly.points).toHaveLength(12);
    expect(s!.today.hourly.busiestHour).toBe(11);
    expect(s!.today.sources).toEqual([
      { channel: "widget", value: 2 },
      { channel: "whatsapp", value: 1 },
    ]);
  });

  it("reads other target keys through the metric source", async () => {
    const src = sources({
      weeklyTarget: async () => ({ metricKey: "records.qualified", weeklyTarget: 40 }),
    });
    const s = await buildLiveSummary(src, COMPANY, NOW);
    expect(s!.week.target).toEqual({ metricKey: "records.qualified", weeklyTarget: 40, value: 99 });
    expect(src.metricValue).toHaveBeenCalledWith(COMPANY, "records.qualified", NOW);
  });

  it("has no target without one and null for an unknown company", async () => {
    const s = await buildLiveSummary(sources({ weeklyTarget: async () => null }), COMPANY, NOW);
    expect(s!.week.target).toBeNull();
    expect(await buildLiveSummary(sources({ timeZone: async () => null }), COMPANY, NOW)).toBeNull();
  });

  it("falls back to UTC days for a bad stored timezone", async () => {
    const s = await buildLiveSummary(sources({ timeZone: async () => "Mars/Base" }), COMPANY, NOW);
    expect(s!.timeZone).toBe("UTC");
    expect(s!.today.range.from).toEqual(new Date("2026-09-25T00:00:00Z"));
  });
});
