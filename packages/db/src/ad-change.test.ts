import { describe, expect, it } from "vitest";
import {
  AD_CHANGE_ACTIONS,
  adChangeReasonSchema,
  budgetDelta,
  checkCap,
  decideAutonomy,
  RESERVATION_TTL_MS,
  AD_CHANGE_CARD_TTL_MS,
  type AdChangeCommand,
  type DecideAutonomyInput,
} from "./ad-change";

const target = { platform: "google" as const, accountId: "acc-1", campaignId: "c-1" };
const enabled = { status: "enabled" as const, dailyBudgetMinor: 40_000 };
const paused = { status: "paused" as const, dailyBudgetMinor: 25_000 };

describe("AD_CHANGE_ACTIONS", () => {
  it("is exactly the six allowed actions and none deletes", () => {
    expect([...AD_CHANGE_ACTIONS]).toEqual([
      "pause",
      "resume",
      "set_daily_budget",
      "add_keyword",
      "add_negative_keyword",
      "update_ad_copy",
    ]);
    for (const a of AD_CHANGE_ACTIONS) expect(a).not.toMatch(/delete|remove/);
  });

  it("fixes the reservation and card windows", () => {
    expect(RESERVATION_TTL_MS).toBe(600_000);
    expect(AD_CHANGE_CARD_TTL_MS).toBe(86_400_000);
  });
});

describe("budgetDelta", () => {
  it("pause takes the current budget off the live total", () => {
    expect(budgetDelta({ ...target, action: "pause" }, enabled)).toBe(-40_000);
    expect(budgetDelta({ ...target, action: "pause" }, paused)).toBe(0);
  });

  it("resume adds the paused budget back", () => {
    expect(budgetDelta({ ...target, action: "resume" }, paused)).toBe(25_000);
    expect(budgetDelta({ ...target, action: "resume" }, enabled)).toBe(0);
  });

  it("set_daily_budget is after minus before", () => {
    expect(budgetDelta({ ...target, action: "set_daily_budget", afterMinor: 55_000 }, enabled)).toBe(15_000);
    expect(budgetDelta({ ...target, action: "set_daily_budget", afterMinor: 10_000 }, enabled)).toBe(-30_000);
    // A paused campaign is not in the live total; its resume carries the budget.
    expect(budgetDelta({ ...target, action: "set_daily_budget", afterMinor: 90_000 }, paused)).toBe(0);
  });

  it("keyword and copy actions move no budget", () => {
    const commands: AdChangeCommand[] = [
      { ...target, action: "add_keyword", adGroupId: "g", keyword: "x", matchType: "exact" },
      { ...target, action: "add_negative_keyword", keyword: "bedava", matchType: "phrase" },
      { ...target, action: "update_ad_copy", adGroupId: "g", headlines: ["a"], descriptions: ["b"] },
    ];
    for (const c of commands) expect(budgetDelta(c, enabled)).toBe(0);
  });
});

describe("checkCap", () => {
  it("rejects 1.001 TL over a 1.000 TL cap", () => {
    expect(
      checkCap({ currentTotalMinor: 99_000, reservedMinor: 0, deltaMinor: 1_100, capMinor: 100_000 }),
    ).toEqual({ ok: false, code: "cap_exceeded", totalAfterMinor: 100_100 });
  });

  it("passes exactly at the cap", () => {
    expect(
      checkCap({ currentTotalMinor: 99_000, reservedMinor: 0, deltaMinor: 1_000, capMinor: 100_000 }),
    ).toEqual({ ok: true, totalAfterMinor: 100_000 });
  });

  it("counts reserved increases", () => {
    expect(
      checkCap({ currentTotalMinor: 50_000, reservedMinor: 60_000, deltaMinor: 1, capMinor: 100_000 }),
    ).toMatchObject({ ok: false, code: "cap_exceeded" });
  });

  it("allows any reduction even when the account is already over the cap", () => {
    expect(
      checkCap({ currentTotalMinor: 150_000, reservedMinor: 10_000, deltaMinor: -5_000, capMinor: 100_000 }),
    ).toEqual({ ok: true, totalAfterMinor: 155_000 });
    expect(
      checkCap({ currentTotalMinor: 150_000, reservedMinor: 0, deltaMinor: 0, capMinor: 100_000 }).ok,
    ).toBe(true);
    expect(checkCap({ currentTotalMinor: 0, reservedMinor: 0, deltaMinor: -1, capMinor: null }).ok).toBe(true);
  });

  it("rejects every increase when no cap is set", () => {
    expect(checkCap({ currentTotalMinor: 0, reservedMinor: 0, deltaMinor: 1, capMinor: null })).toEqual({
      ok: false,
      code: "cap_unset",
      totalAfterMinor: 1,
    });
  });
});

describe("adChangeReasonSchema", () => {
  const full = { text: "CPL 3 gündür eşiğin üstünde", metric: "cpl_minor", value: 41_000, threshold: 30_000 };

  it("needs metric, finite value and finite threshold from an agent", () => {
    expect(adChangeReasonSchema("agent").safeParse(full).success).toBe(true);
    expect(adChangeReasonSchema("agent").safeParse({ text: "x" }).success).toBe(false);
    expect(adChangeReasonSchema("agent").safeParse({ ...full, metric: "" }).success).toBe(false);
    expect(adChangeReasonSchema("agent").safeParse({ ...full, value: Number.NaN }).success).toBe(false);
    expect(adChangeReasonSchema("agent").safeParse({ ...full, threshold: Infinity }).success).toBe(false);
    expect(adChangeReasonSchema("agent").safeParse({ ...full, value: "41000" }).success).toBe(false);
  });

  it("needs only text from a person", () => {
    expect(adChangeReasonSchema("human").safeParse({ text: "Talha istedi" })).toEqual({
      success: true,
      data: { text: "Talha istedi", metric: null, value: null, threshold: null },
    });
    expect(adChangeReasonSchema("human").safeParse({ text: "  " }).success).toBe(false);
    expect(adChangeReasonSchema("human").safeParse({ text: "x", value: Number.NaN }).success).toBe(false);
    expect(() => adChangeReasonSchema("human").parse({})).toThrow(/text/);
  });
});

describe("decideAutonomy", () => {
  const base: DecideAutonomyInput = {
    action: "pause",
    deltaMinor: -40_000,
    autonomousReductionsToday: 0,
    liveChannelCount: 2,
    channelLeadCount: 12,
    dataMature: true,
  };
  const cases: [string, Partial<DecideAutonomyInput>, "autonomous" | "card", RegExp][] = [
    ["pause with every guardrail passing", {}, "autonomous", /pass/],
    ["budget decrease", { action: "set_daily_budget", deltaMinor: -10_000 }, "autonomous", /pass/],
    ["budget increase", { action: "set_daily_budget", deltaMinor: 10_000 }, "card", /only a pause/],
    ["resume", { action: "resume", deltaMinor: 25_000 }, "card", /only a pause/],
    ["keyword", { action: "add_negative_keyword", deltaMinor: 0 }, "card", /only a pause/],
    ["guardrail 1: one already today", { autonomousReductionsToday: 1 }, "card", /guardrail 1/],
    ["guardrail 2: only live channel", { liveChannelCount: 1 }, "card", /guardrail 2/],
    ["guardrail 3: pause with < 5 leads", { channelLeadCount: 4 }, "card", /guardrail 3/],
    ["guardrail 3 does not apply to a decrease", { action: "set_daily_budget", deltaMinor: -1, channelLeadCount: 0 }, "autonomous", /pass/],
    ["guardrail 4: immature data", { dataMature: false }, "card", /guardrail 4/],
  ];
  it.each(cases)("%s", (_name, patch, decision, reason) => {
    const out = decideAutonomy({ ...base, ...patch });
    expect(out.decision).toBe(decision);
    expect(out.reason).toMatch(reason);
  });
});
