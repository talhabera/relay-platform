import { describe, expect, it } from "vitest";
import {
  addDaysLabel,
  checkSpendBatch,
  evaluateAdState,
  IMMATURE_DAYS,
  isMature,
  liveChannels,
  matureThrough,
  NO_LEAD_WARNING_DAYS,
  STOP_RULE_DAY,
  SUSPICIOUS_DROP_RATIO,
  type AdChannelInput,
  type AdMonitorInput,
  type AdMonitorSettings,
  type SpendBatch,
} from "./ad-monitor";

const TODAY = "2026-11-20";
const day = (offset: number) => addDaysLabel(TODAY, offset);
const settings: AdMonitorSettings = { cplStopMinor: 80_000, monthlyTargetMinor: null, dailyCapMinor: null };

/** Spend every day from `startOffset` to `endOffset` (inclusive, offsets from TODAY). */
function spendDays(startOffset: number, endOffset: number, amountMinor: number) {
  const rows = [];
  for (let o = startOffset; o <= endOffset; o++) rows.push({ date: day(o), amountMinor, complete: true });
  return rows;
}

function channel(overrides: Partial<AdChannelInput> = {}): AdChannelInput {
  return { channel: "google", spend: [], leadsByDay: {}, lastLeadDate: day(-1), ...overrides };
}

function input(channels: AdChannelInput[], s = settings): AdMonitorInput {
  return { today: TODAY, settings: s, channels };
}

// Day 14 starts at TODAY-13; mature days run TODAY-13..TODAY-3 (11 days).
const DAY14 = -(STOP_RULE_DAY - 1);

describe("maturity", () => {
  it("treats today and the two days before it as immature", () => {
    expect(IMMATURE_DAYS).toBe(2);
    expect(matureThrough(TODAY)).toBe(day(-3));
    expect(isMature(day(-3), TODAY)).toBe(true);
    expect(isMature(day(-2), TODAY)).toBe(false);
    expect(isMature(TODAY, TODAY)).toBe(false);
  });

  it("crosses month and year bounds on label math", () => {
    expect(matureThrough("2027-01-02")).toBe("2026-12-30");
  });
});

describe("stop rule", () => {
  // 11 mature days x 49_091 ~ 540_000; use exact totals via one big day.
  const window = (spend: number, leads: number) =>
    channel({
      spend: [...spendDays(DAY14, -3, 0).map((r, i) => ({ ...r, amountMinor: i === 0 ? spend : 0 }))],
      leadsByDay: { [day(-5)]: leads },
    });

  it("gives no stop result before day 14", () => {
    const state = evaluateAdState(
      input([channel({ spend: spendDays(DAY14 + 1, -3, 100_000), leadsByDay: { [day(-5)]: 1 } })]),
    );
    expect(state.channels[0]).toMatchObject({ dayNumber: 13, stop: "too_early" });
    expect(state.proposals).toEqual([]);
  });

  it("proposes pause_channel at day 14 with 6 leads and CPL 90000 over 80000", () => {
    const state = evaluateAdState(input([window(540_000, 6)]));
    expect(state.channels[0]).toMatchObject({ dayNumber: 14, stop: "exceeded" });
    expect(state.proposals).toEqual([
      {
        key: "pause_channel:google",
        kind: "pause_channel",
        channel: "google",
        reason: { metric: "cpl", value: 90_000, thresholdMinor: 80_000, windowDays: 11, leads: 6, spendMinor: 540_000 },
        lowData: false,
        lastLiveChannel: true,
      },
    ]);
  });

  it("marks 4 leads over threshold as low data, still only a proposal", () => {
    const state = evaluateAdState(input([window(360_000, 4)]));
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]).toMatchObject({ kind: "pause_channel", lowData: true });
    expect(state.proposals[0].reason).toMatchObject({ metric: "cpl", value: 90_000, leads: 4 });
    expect(Object.keys(state.proposals[0])).not.toContain("autonomous");
  });

  it("does not exceed when CPL equals the threshold", () => {
    const state = evaluateAdState(input([window(480_000, 6)]));
    expect(state.channels[0].stop).toBe("within");
    expect(state.proposals).toEqual([]);
  });

  it("makes no proposal when the threshold is null", () => {
    const state = evaluateAdState(input([window(540_000, 6)], { ...settings, cplStopMinor: null }));
    expect(state.channels[0].stop).toBe("not_set");
    expect(state.proposals).toEqual([]);
  });

  it("proposes on spend with zero leads, with a null CPL and metric leads", () => {
    const state = evaluateAdState(input([window(200_000, 0)]));
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0].reason).toMatchObject({ metric: "leads", value: null, leads: 0, spendMinor: 200_000 });
    expect(state.proposals[0].lowData).toBe(true);
  });

  it("numbers days from the first positive spend day; a gap day does not shift the count", () => {
    const spend = [
      { date: day(-20), amountMinor: 0, complete: true },
      ...spendDays(DAY14, -3, 50_000).filter((r) => r.date !== day(-10)),
    ];
    const state = evaluateAdState(input([channel({ spend, leadsByDay: { [day(-5)]: 10 } })]));
    expect(state.channels[0]).toMatchObject({ firstSpendDate: day(DAY14), dayNumber: 14 });
    expect(state.channels[0].window).toMatchObject({ days: 10, spendMinor: 500_000, leads: 10 });
  });
});

describe("excluded days and alerts", () => {
  it("leaves missing, incomplete and immature days out of the window and flags the gaps", () => {
    const spend = spendDays(DAY14, 0, 50_000)
      .filter((r) => r.date !== day(-4))
      .map((r) => (r.date === day(-6) ? { ...r, complete: false } : r));
    const leadsByDay = { [day(-4)]: 3, [day(-6)]: 2, [day(-1)]: 4, [day(-8)]: 6 };
    const state = evaluateAdState(input([channel({ spend, leadsByDay })]));
    // 11 mature days minus the missing and the incomplete one.
    expect(state.channels[0].window).toMatchObject({ days: 9, spendMinor: 450_000, leads: 6 });
    expect(state.alerts).toContainEqual({ kind: "missing_spend", channel: "google", dates: [day(-4)] });
    expect(state.alerts).toContainEqual({ kind: "data_incomplete", channel: "google", dates: [day(-6)] });
    expect(state.alerts).toContainEqual({
      kind: "immature_note",
      channel: null,
      dates: [day(-2), day(-1), TODAY],
      matureThrough: day(-3),
    });
    expect(state.completeness).toEqual({ complete: false, missingDays: 1, incompleteDays: 1 });
  });

  it("lists every missing mature day in the last 7", () => {
    const spend = spendDays(-30, -10, 1_000);
    const state = evaluateAdState(input([channel({ spend, lastLeadDate: day(-12) })]));
    expect(state.alerts[0]).toEqual({
      kind: "missing_spend",
      channel: "google",
      dates: [day(-9), day(-8), day(-7), day(-6), day(-5), day(-4), day(-3)],
    });
  });

  it("warns after 9 quiet days on a live channel and not after 5", () => {
    expect(NO_LEAD_WARNING_DAYS).toBe(7);
    const spend = spendDays(-30, -3, 10_000);
    const quiet = evaluateAdState(input([channel({ spend, lastLeadDate: day(-9) })], { ...settings, cplStopMinor: null }));
    expect(quiet.alerts).toContainEqual({
      kind: "no_leads",
      channel: "google",
      days: 9,
      lastLeadDate: day(-9),
      thresholdDays: 7,
    });
    const recent = evaluateAdState(input([channel({ spend, lastLeadDate: day(-5) })], { ...settings, cplStopMinor: null }));
    expect(recent.alerts.some((a) => a.kind === "no_leads")).toBe(false);
  });
});

describe("live channels", () => {
  it("marks the proposal for the only live channel as the last live channel", () => {
    const google = channel({ spend: spendDays(DAY14, -3, 100_000), leadsByDay: { [day(-5)]: 1 } });
    const meta = channel({
      channel: "meta",
      spend: spendDays(-40, -20, 5_000),
      leadsByDay: { [day(-25)]: 10 },
      lastLeadDate: day(-20),
    });
    const i = input([google, meta]);
    expect(liveChannels(i)).toEqual(["google"]);
    const state = evaluateAdState(i);
    expect(state.proposals.map((p) => [p.key, p.lastLiveChannel])).toEqual([["pause_channel:google", true]]);
  });

  it("keeps proposal keys stable and gives two channels two keys", () => {
    const google = channel({ spend: spendDays(DAY14, -3, 100_000), leadsByDay: { [day(-5)]: 1 } });
    const meta = channel({ channel: "meta", spend: spendDays(DAY14, -3, 100_000), leadsByDay: { [day(-5)]: 1 } });
    const a = evaluateAdState(input([google]));
    const b = evaluateAdState(input([google]));
    expect(a.proposals[0].key).toBe("pause_channel:google");
    expect(b.proposals[0].key).toBe(a.proposals[0].key);
    const both = evaluateAdState(input([meta, google]));
    expect(both.proposals.map((p) => p.key)).toEqual(["pause_channel:google", "pause_channel:meta"]);
    expect(both.proposals.every((p) => p.lastLiveChannel === false)).toBe(true);
  });
});

describe("checkSpendBatch", () => {
  const batch = (overrides: Partial<SpendBatch> = {}): SpendBatch => ({
    currency: "TRY",
    paginationComplete: true,
    expectedRows: { min: 1, max: 5 },
    rows: [{ date: day(-1), channel: "google", campaignId: "c1", amountMinor: 70_000 }],
    ...overrides,
  });
  const stored = [{ date: day(-1), channel: "google" as const, amountMinor: 100_000 }];

  it.each([
    ["pagination", batch({ paginationComplete: false })],
    ["currency", batch({ currency: "USD" })],
    ["row_count", batch({ expectedRows: { min: 2, max: 5 } })],
    ["drop", batch({ rows: [{ date: day(-1), channel: "google", campaignId: "c1", amountMinor: 69_999 }] })],
  ])("refuses with reason %s and no row values in the message", (reason, b) => {
    const result = checkSpendBatch(b, stored);
    expect(result).toMatchObject({ ok: false, reason });
    if (!result.ok) expect(result.message).not.toMatch(/\d{3,}/);
  });

  it("accepts a batch at the 70 percent line and when the stored total is 0", () => {
    expect(SUSPICIOUS_DROP_RATIO).toBe(0.7);
    expect(checkSpendBatch(batch(), stored)).toEqual({ ok: true });
    expect(
      checkSpendBatch(batch({ rows: [{ date: day(-1), channel: "google", campaignId: "c1", amountMinor: 0 }] }), [
        { date: day(-1), channel: "google", amountMinor: 0 },
      ]),
    ).toEqual({ ok: true });
  });
});
