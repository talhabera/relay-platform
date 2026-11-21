import { describe, expect, it } from "vitest";
import { createFakeAdAdapter } from "./fake-adapter";
import { requireTryCampaigns } from "./adapter";

const ctx = { companyId: "co-1", accountId: "acc-1" };
const range = { from: "2026-11-01", to: "2026-11-03" };

function seeded() {
  return createFakeAdAdapter({
    campaigns: {
      "acc-1": [{ campaignId: "c-1", name: "Arama", status: "enabled", dailyBudgetMinor: 50_000 }],
      "acc-2": [{ campaignId: "c-9", name: "Other", status: "enabled", dailyBudgetMinor: 1 }],
    },
    dailySpend: [
      { date: "2026-11-01", campaignId: "c-1", spendMinor: 41_000 },
      { date: "2026-11-02", campaignId: "c-1", spendMinor: 39_500 },
      { date: "2026-11-05", campaignId: "c-1", spendMinor: 1 },
      { date: "2026-11-01", campaignId: "c-9", spendMinor: 7 },
    ],
    performance: [{ campaignId: "c-1", impressions: 900, clicks: 40, conversions: 3, costMinor: 80_500 }],
    searchTerms: [{ campaignId: "c-1", term: "diş beyazlatma", clicks: 12, costMinor: 24_000 }],
  });
}

describe("fake ad adapter", () => {
  it("returns scripted daily spend for the account and range, complete", async () => {
    const out = await seeded().getDailySpend(ctx, range);
    expect(out).toEqual({
      ok: true,
      value: {
        rows: [
          { date: "2026-11-01", campaignId: "c-1", spendMinor: 41_000 },
          { date: "2026-11-02", campaignId: "c-1", spendMinor: 39_500 },
        ],
        complete: true,
        currency: "TRY",
      },
    });
  });

  it("reports an incomplete read when a page failure is scripted", async () => {
    const fake = seeded();
    fake.failSpendPage();
    const out = await fake.getDailySpend(ctx, range);
    expect(out.ok && out.value.complete).toBe(false);
  });

  it("serves performance and search terms from seeded rows", async () => {
    const fake = seeded();
    expect(await fake.getPerformance(ctx, range)).toEqual({
      ok: true,
      value: [{ campaignId: "c-1", impressions: 900, clicks: 40, conversions: 3, costMinor: 80_500 }],
    });
    expect(await fake.getSearchTerms(ctx, range)).toEqual({
      ok: true,
      value: [{ campaignId: "c-1", term: "diş beyazlatma", clicks: 12, costMinor: 24_000 }],
    });
  });

  it("records every call and applies budget changes in memory", async () => {
    const fake = seeded();
    await fake.listCampaigns(ctx);
    const applied = await fake.applyChange(ctx, {
      platform: "google",
      accountId: "acc-1",
      campaignId: "c-1",
      action: "set_daily_budget",
      afterMinor: 60_000,
    });
    expect(applied).toEqual({
      ok: true,
      value: {
        before: { status: "enabled", dailyBudgetMinor: 50_000 },
        after: { status: "enabled", dailyBudgetMinor: 60_000 },
      },
    });
    expect(fake.calls.map((c) => c.method)).toEqual(["listCampaigns", "applyChange"]);
    expect(fake.writeCount()).toBe(1);
    expect(fake.campaignsOf("acc-1")[0].dailyBudgetMinor).toBe(60_000);
  });

  it("returns scripted failures and throws when scripted to", async () => {
    const fake = seeded();
    fake.failNext("listCampaigns", { code: "platform_unreachable", message: "timeout" });
    expect(await fake.listCampaigns(ctx)).toEqual({ ok: false, code: "platform_unreachable", message: "timeout" });
    expect((await fake.listCampaigns(ctx)).ok).toBe(true);
    fake.failNext("applyChange", { throws: "socket hang up" });
    await expect(
      fake.applyChange(ctx, { platform: "google", accountId: "acc-1", campaignId: "c-1", action: "pause" }),
    ).rejects.toThrow("socket hang up");
  });

  it("answers no_such_campaign for an unknown campaign", async () => {
    const out = await seeded().applyChange(ctx, {
      platform: "google",
      accountId: "acc-1",
      campaignId: "nope",
      action: "pause",
    });
    expect(out).toMatchObject({ ok: false, code: "no_such_campaign" });
  });

  it("exposes no delete method", () => {
    const fake = seeded() as unknown as Record<string, unknown>;
    const methods = Object.keys(fake).filter((k) => typeof fake[k] === "function");
    expect(methods.some((m) => /delete|remove/i.test(m))).toBe(false);
  });

  it("refuses a campaign list that is not in TRY", async () => {
    const fake = createFakeAdAdapter({
      campaigns: { "acc-1": [{ campaignId: "c-1", name: "x", status: "enabled", dailyBudgetMinor: 1, currency: "USD" }] },
    });
    expect(requireTryCampaigns(await fake.listCampaigns(ctx))).toMatchObject({ ok: false, code: "platform_error" });
  });
});
