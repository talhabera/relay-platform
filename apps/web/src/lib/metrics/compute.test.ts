import { describe, expect, it } from "vitest";
import { isoWeekRange } from "@/lib/time";
import {
  costPerQualifiedLead,
  countLeadMetrics,
  firstDeliveredInRange,
  leadQualityScore,
  leadsPerAgent,
  type LeadEventFact,
} from "./compute";

const CUSTOMER = "agent-widget";
const GATHERER = "agent-gatherer";
const QUALIFIER = "agent-qualifier";
const customers = new Set([CUSTOMER]);

function ev(
  over: Partial<Omit<LeadEventFact, "at">> & { at: string },
): LeadEventFact {
  return {
    recordId: "rec-1",
    fromStatus: "pending",
    toStatus: "qualified",
    agentId: QUALIFIER,
    userId: null,
    ...over,
    at: new Date(over.at),
  };
}

describe("ISO-week boundary in company time", () => {
  // Istanbul is UTC+3 all year: Monday 5 Oct 00:00 local = 4 Oct 21:00 UTC.
  const istanbul = isoWeekRange(new Date("2026-10-07T12:00:00Z"), "Europe/Istanbul");

  it("cuts the week at local Monday midnight, not UTC", () => {
    expect(istanbul.from.toISOString()).toBe("2026-10-04T21:00:00.000Z");
    const events = [
      // Sunday 23:59:59 local: last week.
      ev({ recordId: "sun", at: "2026-10-04T20:59:59Z" }),
      // Monday 00:00 local: this week, although it is still Sunday in UTC.
      ev({ recordId: "mon", at: "2026-10-04T21:00:00Z" }),
      // Next Monday 00:00 local: excluded (half-open).
      ev({ recordId: "next", at: "2026-10-11T21:00:00Z" }),
      ev({ recordId: "last", at: "2026-10-11T20:59:59Z" }),
    ];
    expect(countLeadMetrics(events, istanbul, customers).qualified).toBe(2);
  });

  it("keeps the DST week 169 hours long (New York, fall back 1 Nov 2026)", () => {
    const ny = isoWeekRange(new Date("2026-10-28T12:00:00Z"), "America/New_York");
    expect(ny.from.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(ny.to.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    const events = [
      // Sunday 1 Nov 23:30 EST: still this week; `from + 7 days` would drop it.
      ev({ recordId: "late-sunday", toStatus: "delivered", at: "2026-11-02T04:30:00Z" }),
      ev({ recordId: "next-week", toStatus: "delivered", at: "2026-11-02T05:00:00Z" }),
    ];
    const counts = countLeadMetrics(events, ny, customers);
    expect(counts.delivered).toBe(1);
    expect(counts.deliveredRecordIds).toEqual(["late-sunday"]);
  });
});

describe("weekly target: qualified leads delivered", () => {
  const week = isoWeekRange(new Date("2026-10-07T12:00:00Z"), "UTC");

  it("counts a lead once, on its first delivery", () => {
    const events = [
      ev({ recordId: "a", toStatus: "delivered", at: "2026-10-05T09:00:00Z" }),
      // Re-delivery in the same week (known number back inbound).
      ev({ recordId: "a", fromStatus: "delivered", toStatus: "delivered", at: "2026-10-06T09:00:00Z" }),
      // First delivered last week, re-delivered this week: does not count.
      ev({ recordId: "b", toStatus: "delivered", at: "2026-09-30T09:00:00Z" }),
      ev({ recordId: "b", toStatus: "delivered", at: "2026-10-06T10:00:00Z" }),
      ev({ recordId: "c", toStatus: "delivered", at: "2026-10-08T10:00:00Z" }),
    ];
    const first = firstDeliveredInRange(events, week);
    expect([...first.keys()].sort()).toEqual(["a", "c"]);
    expect(first.get("a")?.at.toISOString()).toBe("2026-10-05T09:00:00.000Z");
    expect(countLeadMetrics(events, week, customers).delivered).toBe(2);
  });

  it("ignores events at or after the end of the week", () => {
    const events = [
      ev({ recordId: "a", toStatus: "delivered", at: "2026-10-12T00:00:00Z" }),
    ];
    expect(firstDeliveredInRange(events, week).size).toBe(0);
  });
});

describe("stage buckets", () => {
  const week = isoWeekRange(new Date("2026-10-07T12:00:00Z"), "UTC");

  it("splits creations into gathered and inbound, and counts distinct leads", () => {
    const events = [
      ev({ recordId: "g1", fromStatus: null, toStatus: "pending", agentId: GATHERER, at: "2026-10-05T08:00:00Z" }),
      ev({ recordId: "g2", fromStatus: "pending", toStatus: "gathered", agentId: GATHERER, at: "2026-10-05T08:00:00Z" }),
      ev({ recordId: "i1", fromStatus: null, toStatus: "pending", agentId: CUSTOMER, at: "2026-10-05T09:00:00Z" }),
      ev({ recordId: "q1", toStatus: "qualified", at: "2026-10-06T08:00:00Z" }),
      // Accepted borderline lead: a person's override still counts as qualified.
      ev({ recordId: "q2", toStatus: "qualified", agentId: null, userId: "owner", at: "2026-10-06T09:00:00Z" }),
      ev({ recordId: "c1", toStatus: "outreach_approved", at: "2026-10-07T08:00:00Z" }),
      ev({ recordId: "c1", fromStatus: "outreach_approved", toStatus: "replied", at: "2026-10-07T09:00:00Z" }),
      ev({ recordId: "c2", toStatus: "contacted", at: "2026-10-07T10:00:00Z" }),
    ];
    const counts = countLeadMetrics(events, week, customers);
    expect(counts).toMatchObject({
      gathered: 2,
      inbound: 1,
      qualified: 2,
      contactedReplied: 2,
      delivered: 0,
    });
  });

  it("credits leads per agent from the agent's own transitions", () => {
    const events = [
      ev({ recordId: "a", agentId: GATHERER, at: "2026-10-05T08:00:00Z" }),
      ev({ recordId: "b", agentId: GATHERER, at: "2026-10-05T09:00:00Z" }),
      ev({ recordId: "a", agentId: QUALIFIER, at: "2026-10-06T08:00:00Z" }),
      ev({ recordId: "a", agentId: QUALIFIER, toStatus: "delivered", at: "2026-10-06T09:00:00Z" }),
      ev({ recordId: "c", agentId: null, userId: "owner", at: "2026-10-06T10:00:00Z" }),
      ev({ recordId: "old", agentId: GATHERER, at: "2026-09-30T08:00:00Z" }),
    ];
    expect(Object.fromEntries(leadsPerAgent(events, week))).toEqual({
      [GATHERER]: 2,
      [QUALIFIER]: 1,
    });
  });
});

describe("KPIs", () => {
  it("averages the fit score of delivered leads, skipping unscored ones", () => {
    const scores = new Map<string, number | null>([
      ["a", 80],
      ["b", 75],
      ["c", null],
    ]);
    expect(leadQualityScore(["a", "b", "c"], scores)).toBe(78);
    expect(leadQualityScore(["c"], scores)).toBeNull();
    expect(leadQualityScore([], scores)).toBeNull();
  });

  it("divides tokens by qualified leads delivered", () => {
    expect(costPerQualifiedLead(3_000_000, 4)).toEqual({
      tokens: 3_000_000,
      tokensPerLead: 750_000,
      estimatedUsdPerLead: 4.5,
    });
    expect(costPerQualifiedLead(1_000, 0)).toBeNull();
  });
});
