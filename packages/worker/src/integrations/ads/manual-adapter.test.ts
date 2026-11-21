import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdChangeCommand } from "@relay/db";
import { defaultAdapterFor } from "../../ads/apply-ad-change";
import { createManualAdAdapter, type ManualAdLogRow, type ManualAdStore } from "./manual-adapter";

const ctx = { companyId: "co-1", accountId: "acc-1" };
const observed = { campaignName: "Villa", status: "enabled" as const, dailyBudgetMinor: 50_000 };
const budget: AdChangeCommand = {
  platform: "google",
  accountId: "acc-1",
  campaignId: "cmp-1",
  action: "set_daily_budget",
  afterMinor: 60_000,
  observed,
};

function storeOf(rows: ManualAdLogRow[]): ManualAdStore & { reads: number } {
  const store = {
    reads: 0,
    async appliedResults() {
      store.reads++;
      return rows;
    },
  };
  return store;
}

const fetchMock = vi.fn(() => {
  throw new Error("the manual adapter must not call fetch");
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("manual ad adapter", () => {
  it("is mode manual with no spend, performance or search terms of its own", async () => {
    const adapter = createManualAdAdapter({ platform: "google", store: storeOf([]) });
    expect(adapter.mode).toBe("manual");
    expect(await adapter.getDailySpend(ctx, { from: "2026-11-01", to: "2026-11-05" })).toEqual({
      ok: false,
      code: "platform_error",
      message: "manual",
    });
    expect(await adapter.getPerformance(ctx, { from: "2026-11-01", to: "2026-11-05" })).toEqual({ ok: true, value: [] });
    expect(await adapter.getSearchTerms(ctx, { from: "2026-11-01", to: "2026-11-05" })).toEqual({ ok: true, value: [] });
  });

  it("set_daily_budget: before from observed when nothing was applied, after from the command", async () => {
    const adapter = createManualAdAdapter({ platform: "google", store: storeOf([]), command: budget });
    expect(await adapter.applyChange(ctx, budget)).toEqual({
      ok: true,
      value: {
        before: { status: "enabled", dailyBudgetMinor: 50_000 },
        after: { status: "enabled", dailyBudgetMinor: 60_000, appliedBy: "manual" },
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("set_daily_budget: before from the last applied row over observed", async () => {
    const rows: ManualAdLogRow[] = [
      { campaignId: "cmp-1", campaignName: "Villa", beforeValue: { dailyBudgetMinor: 40_000 }, afterValue: { status: "enabled", dailyBudgetMinor: 55_000, appliedBy: "manual" } },
      { campaignId: "cmp-1", campaignName: "Villa", beforeValue: null, afterValue: { status: "enabled", dailyBudgetMinor: 40_000 } },
    ];
    const adapter = createManualAdAdapter({ platform: "google", store: storeOf(rows), command: budget });
    const applied = await adapter.applyChange(ctx, budget);
    expect(applied.ok && applied.value.before).toEqual({ status: "enabled", dailyBudgetMinor: 55_000 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pause flips status and keeps the budget", async () => {
    const pause: AdChangeCommand = { ...budget, action: "pause" } as AdChangeCommand;
    const adapter = createManualAdAdapter({ platform: "google", store: storeOf([]) });
    expect(await adapter.applyChange(ctx, pause)).toEqual({
      ok: true,
      value: {
        before: { status: "enabled", dailyBudgetMinor: 50_000 },
        after: { status: "paused", dailyBudgetMinor: 50_000, appliedBy: "manual" },
      },
    });
  });

  it("listCampaigns merges the last applied rows with the command's observed campaign", async () => {
    const rows: ManualAdLogRow[] = [
      { campaignId: "cmp-2", campaignName: "Daire", beforeValue: null, afterValue: { status: "paused", dailyBudgetMinor: 30_000 } },
    ];
    const adapter = createManualAdAdapter({ platform: "google", store: storeOf(rows), command: budget });
    const listed = await adapter.listCampaigns(ctx);
    expect(listed.ok && [...listed.value].sort((a, b) => a.campaignId.localeCompare(b.campaignId))).toEqual([
      { campaignId: "cmp-1", name: "Villa", status: "enabled", dailyBudgetMinor: 50_000, currency: "TRY" },
      { campaignId: "cmp-2", name: "Daire", status: "paused", dailyBudgetMinor: 30_000, currency: "TRY" },
    ]);
    const other = await adapter.listCampaigns({ ...ctx, accountId: "acc-9" });
    expect(other.ok && other.value.map((c) => c.campaignId)).toEqual(["cmp-2"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("defaultAdapterFor", () => {
  it("is the manual adapter outside tests when no ad integration is connected", () => {
    vi.stubEnv("NODE_ENV", "production");
    const adapter = defaultAdapterFor("google", "co-1", { command: budget });
    expect(adapter.mode).toBe("manual");
    expect(adapter.platform).toBe("google");
  });

  it("is the fake under NODE_ENV=test", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(defaultAdapterFor("meta", "co-1").mode).toBe("fake");
  });
});
