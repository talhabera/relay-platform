import { describe, expect, it } from "vitest";
import { RESERVATION_TTL_MS, type AdChangeCommand, type AdChangeLogRow, type NewAdChangeLogRow } from "@relay/db";
import { createFakeAdAdapter, type FakeAdAdapter } from "../integrations/ads/fake-adapter";
import type { AdPlatformAdapter } from "../integrations/ads/adapter";
import {
  applyAdChange,
  sanitizeDetail,
  sumReservedMinor,
  type AdChangeStore,
  type ApplyAdChangeInput,
  type ReservationCheckpoint,
} from "./apply-ad-change";

const CO = "co-1";
const T0 = new Date("2026-11-06T09:00:00Z");

/** Store double: rows in an array, the reservation rule from `sumReservedMinor`. */
function fakeStore(capMinor: number | null) {
  const rows: AdChangeLogRow[] = [];
  const checkpoints: ReservationCheckpoint[] = [];
  const events: string[] = [];
  let seq = 0;
  const insert = async (row: NewAdChangeLogRow) => {
    events.push(`${row.phase}:${row.outcome ?? ""}`);
    rows.push({
      id: `row-${++seq}`,
      seq,
      beforeValue: null,
      afterValue: null,
      campaignName: null,
      dailyTotalAfterMinor: null,
      actorAgentId: null,
      actorUserId: null,
      checkpointId: null,
      attempt: null,
      reversesChangeId: null,
      reasonMetric: null,
      reasonValue: null,
      reasonThreshold: null,
      outcome: null,
      outcomeCode: null,
      outcomeDetail: null,
      deltaMinor: 0,
      autonomous: false,
      createdAt: new Date(),
      ...row,
    } as AdChangeLogRow);
  };
  const findByCheckpoint = async (id: string, attempt: number) =>
    rows.filter((r) => r.checkpointId === id && r.attempt === attempt);
  const store: AdChangeStore = {
    findByCheckpoint,
    insert,
    withCapLock: (_companyId, fn) =>
      fn({
        loadCapMinor: async () => capMinor,
        reservedMinor: async (scan) => sumReservedMinor(scan, rows, checkpoints),
        findByCheckpoint,
        insert,
      }),
  };
  return { store, rows, checkpoints, events };
}

function setup(opts: { cap: number | null; budget?: number; status?: "enabled" | "paused"; others?: number }) {
  const fake = createFakeAdAdapter({
    campaigns: {
      "acc-1": [
        { campaignId: "c-1", name: "Arama", status: opts.status ?? "enabled", dailyBudgetMinor: opts.budget ?? 0 },
        { campaignId: "c-2", name: "Diğer", status: "enabled", dailyBudgetMinor: opts.others ?? 0 },
      ],
    },
  });
  const s = fakeStore(opts.cap);
  let clock = T0.getTime();
  const deps = { store: s.store, adapterFor: () => fake as AdPlatformAdapter, now: () => new Date(clock) };
  return { ...s, fake, deps, advance: (ms: number) => (clock += ms) };
}

const raise = (afterMinor: number): AdChangeCommand => ({
  platform: "google",
  accountId: "acc-1",
  campaignId: "c-1",
  action: "set_daily_budget",
  afterMinor,
});

const agentInput = (command: AdChangeCommand, extra: Partial<ApplyAdChangeInput> = {}): ApplyAdChangeInput => ({
  companyId: CO,
  command,
  reason: { text: "CPL düşük, bütçe artışı", metric: "cpl_minor", value: 18_000, threshold: 30_000 },
  actor: { type: "agent", agentId: "agent-1" },
  autonomous: false,
  mode: "apply",
  ...extra,
});

describe("applyAdChange", () => {
  it("applies an increase under the cap: intent, adapter call, applied result, in order", async () => {
    const t = setup({ cap: 100_000, budget: 40_000, others: 20_000 });
    const out = await applyAdChange(agentInput(raise(50_000), { checkpointId: "cp-1", attempt: 1 }), t.deps);
    expect(out).toMatchObject({ outcome: "applied", totalAfterMinor: 70_000 });
    expect(t.events).toEqual(["intent:", "result:applied"]);
    expect(t.fake.writeCount()).toBe(1);
    const [intent, result] = t.rows;
    expect(intent).toMatchObject({ phase: "intent", deltaMinor: 10_000, dailyTotalAfterMinor: 70_000, reasonMetric: "cpl_minor" });
    expect(result).toMatchObject({
      phase: "result",
      changeId: intent.changeId,
      afterValue: { status: "enabled", dailyBudgetMinor: 50_000 },
    });
    // The adapter is called after the intent row and before the result row.
    expect(t.fake.calls.map((c) => c.method)).toEqual(["listCampaigns", "applyChange"]);
  });

  it("rejects 1.001 TL over the cap with intent + rejected rows and no adapter write", async () => {
    const t = setup({ cap: 100_000, budget: 49_000, others: 50_000 });
    const out = await applyAdChange(agentInput(raise(50_100)), t.deps);
    expect(out).toMatchObject({ outcome: "rejected", code: "cap_exceeded", totalAfterMinor: 100_100 });
    expect(t.events).toEqual(["intent:", "result:rejected"]);
    expect(t.rows[1]).toMatchObject({ outcomeCode: "cap_exceeded", dailyTotalAfterMinor: 100_100 });
    expect(t.fake.writeCount()).toBe(0);
  });

  it("rejects every increase when the cap is unset", async () => {
    const t = setup({ cap: null, budget: 0 });
    expect(await applyAdChange(agentInput(raise(1)), t.deps)).toMatchObject({ outcome: "rejected", code: "cap_unset" });
    expect(t.fake.writeCount()).toBe(0);
  });

  it("applies a reduction when the account is already over the cap", async () => {
    const t = setup({ cap: 100_000, budget: 90_000, others: 60_000 });
    const out = await applyAdChange(agentInput(raise(80_000)), t.deps);
    expect(out).toMatchObject({ outcome: "applied", totalAfterMinor: 140_000 });
    expect(t.fake.writeCount()).toBe(1);
  });

  it.each([
    ["returns ok:false", { code: "platform_error" as const, message: "quota hit, access_token=abc123secret" }],
    ["throws", { throws: "fetch failed Authorization: Bearer ya29.a0AfH6SMBxyz" }],
  ])("stores a failed result without secrets and does not retry when the write %s", async (_n, failure) => {
    const t = setup({ cap: 100_000, budget: 10_000 });
    t.fake.failNext("applyChange", failure);
    const out = await applyAdChange(agentInput(raise(20_000), { checkpointId: "cp-f", attempt: 1 }), t.deps);
    expect(out).toMatchObject({ outcome: "failed", code: "platform_error" });
    expect(t.events).toEqual(["intent:", "result:failed"]);
    const detail = t.rows[1].outcomeDetail ?? "";
    expect(detail).not.toMatch(/abc123secret|ya29|a0AfH6/);
    expect(detail).toContain("[redacted]");
    expect(t.fake.writeCount()).toBe(1);
    // A repeat of the same attempt returns the stored failure; no retry.
    await applyAdChange(agentInput(raise(20_000), { checkpointId: "cp-f", attempt: 1 }), t.deps);
    expect(t.fake.writeCount()).toBe(1);
  });

  it("writes no intent and a platform_unreachable result when the read fails", async () => {
    const t = setup({ cap: 100_000, budget: 10_000 });
    t.fake.failNext("listCampaigns", { code: "platform_unreachable", message: "ETIMEDOUT" });
    const out = await applyAdChange(agentInput(raise(20_000)), t.deps);
    expect(out).toMatchObject({ outcome: "failed", code: "platform_unreachable" });
    expect(t.events).toEqual(["result:failed"]);
    expect(t.fake.writeCount()).toBe(0);
  });

  it("returns the stored result for a repeated card attempt without a second write", async () => {
    const t = setup({ cap: 100_000, budget: 10_000 });
    const input = agentInput(raise(20_000), { checkpointId: "cp-r", attempt: 1 });
    const first = await applyAdChange(input, t.deps);
    const second = await applyAdChange(input, t.deps);
    expect(second).toEqual(first);
    expect(t.fake.writeCount()).toBe(1);
    expect(t.rows).toHaveLength(2);
  });

  it("counts an unresolved intent as reserved only within RESERVATION_TTL_MS", async () => {
    const t = setup({ cap: 1_000, budget: 0, others: 300 });
    // A concurrent increase whose platform call has not answered yet.
    await t.store.withCapLock(CO, (tx) =>
      tx.insert({
        companyId: CO, changeId: "pending-1", phase: "intent", platform: "google", accountId: "acc-1",
        campaignId: "c-2", action: "set_daily_budget", deltaMinor: 600, actorType: "human",
        actorUserId: "u-1", reasonText: "x", createdAt: new Date(T0.getTime() - RESERVATION_TTL_MS + 60_000),
      }),
    );
    expect(await applyAdChange(agentInput(raise(600)), t.deps)).toMatchObject({ outcome: "rejected" });
    t.advance(2 * 60_000); // the pending intent is now older than the TTL
    expect(await applyAdChange(agentInput(raise(600)), t.deps)).toMatchObject({ outcome: "applied" });
  });

  describe("approved ad_change cards not yet applied", () => {
    // Live total 400, cap 1000, each card +600. (The dispatch's "current 500"
    // cannot pass 500 + 600 <= 1000; 400 keeps the cards and the cap.)
    const card = (id: string): ReservationCheckpoint => ({
      id, companyId: CO, status: "approved", executeResult: null, payload: { kind: "ad_change", deltaMinor: 600 },
    });

    it("excludes the card being applied from its own reservation (mode apply)", async () => {
      const t = setup({ cap: 1_000, budget: 0, others: 400 });
      t.checkpoints.push(card("cp-a"));
      const out = await applyAdChange(agentInput(raise(600), { checkpointId: "cp-a", attempt: 1 }), t.deps);
      expect(out).toMatchObject({ outcome: "applied", totalAfterMinor: 1_000 });
    });

    it("excludes it on the manual Uygulandı path (human actor, manual adapter)", async () => {
      const t = setup({ cap: 1_000, budget: 0, others: 400 });
      t.checkpoints.push(card("cp-a"));
      const manual = { ...t.fake, mode: "manual" as const };
      const out = await applyAdChange(
        {
          ...agentInput(raise(600), { checkpointId: "cp-a", attempt: 1 }),
          actor: { type: "human", userId: "talha" },
          reason: { text: "Uygulandı" },
        },
        { ...t.deps, adapterFor: () => manual },
      );
      expect(out).toMatchObject({ outcome: "applied", totalAfterMinor: 1_000 });
    });

    it("still rejects a second approved card in the same state", async () => {
      const t = setup({ cap: 1_000, budget: 0, others: 400 });
      t.checkpoints.push(card("cp-a"), card("cp-b"));
      const out = await applyAdChange(agentInput(raise(600), { checkpointId: "cp-a", attempt: 1 }), t.deps);
      expect(out).toMatchObject({ outcome: "rejected", code: "cap_exceeded", totalAfterMinor: 1_600 });
      expect(t.fake.writeCount()).toBe(0);
    });

    it("ignores cards that are not approved, already executed or already logged", () => {
      const scan = { companyId: CO, since: T0, appliedSince: T0, excludeCheckpointId: null };
      const cps: ReservationCheckpoint[] = [
        { ...card("p"), status: "pending" },
        { ...card("e"), executeResult: { ok: true } },
        card("logged"),
        { ...card("other"), payload: { kind: "outreach", deltaMinor: 600 } },
        { ...card("neg"), payload: { kind: "ad_change", deltaMinor: -600 } },
      ];
      const log = [{ companyId: CO, changeId: "x", phase: "intent" as const, outcome: null, deltaMinor: 0, checkpointId: "logged", createdAt: T0 }];
      expect(sumReservedMinor(scan, log, cps)).toBe(0);
    });
  });

  describe("mode reject_only", () => {
    it("logs intent + rejected and never writes when the cap fails", async () => {
      const t = setup({ cap: 1_000, budget: 0, others: 900 });
      const out = await applyAdChange(agentInput(raise(200), { mode: "reject_only" }), t.deps);
      expect(out).toMatchObject({ outcome: "rejected", code: "cap_exceeded" });
      expect(t.events).toEqual(["intent:", "result:rejected"]);
      expect(t.fake.writeCount()).toBe(0);
    });

    it("writes nothing and answers allowed when the cap passes", async () => {
      const t = setup({ cap: 1_000, budget: 0, others: 300 });
      const out = await applyAdChange(agentInput(raise(200), { mode: "reject_only" }), t.deps);
      expect(out).toEqual({ outcome: "allowed", totalAfterMinor: 500 });
      expect(t.rows).toHaveLength(0);
      expect(t.fake.writeCount()).toBe(0);
    });
  });

  it("refuses an agent reason without metric, value and threshold before writing", async () => {
    const t = setup({ cap: 1_000 });
    await expect(applyAdChange({ ...agentInput(raise(1)), reason: { text: "x" } }, t.deps)).rejects.toThrow(/metric/);
    expect(t.rows).toHaveLength(0);
  });
});

describe("sanitizeDetail", () => {
  it("redacts token-like values and caps the length at 300", () => {
    const out = sanitizeDetail(`error api_key=sk_live_123 ${"x".repeat(400)}`);
    expect(out).not.toContain("sk_live_123");
    expect(out.length).toBeLessThanOrEqual(300);
  });
});
