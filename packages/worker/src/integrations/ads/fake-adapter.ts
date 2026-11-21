import { AD_CURRENCY, type AdChangeCommand, type AdPlatform } from "@relay/db";
import type {
  AdAdapterContext,
  AdAdapterErrorCode,
  AdCampaignState,
  AdChangeApplied,
  AdDateRange,
  AdDailySpend,
  AdPerformanceRow,
  AdPlatformAdapter,
  AdSearchTermRow,
  Result,
} from "./adapter";

/**
 * In-memory `AdPlatformAdapter` for tests: seeded campaigns and report rows,
 * scripted failures, every call recorded. Never a production default; see
 * `defaultAdapterFor` in `ads/apply-ad-change.ts`.
 */

export type FakeAdCall = {
  method: "listCampaigns" | "getDailySpend" | "getPerformance" | "getSearchTerms" | "applyChange";
  ctx: AdAdapterContext;
  arg?: unknown;
};

export type FakeFailure = { code: AdAdapterErrorCode; message: string } | { throws: string };

export type FakeAdSeed = {
  platform?: AdPlatform;
  /** Campaigns per account id. */
  campaigns?: Record<string, (Omit<AdCampaignState, "currency"> & { currency?: string })[]>;
  dailySpend?: AdDailySpend["rows"];
  performance?: AdPerformanceRow[];
  searchTerms?: AdSearchTermRow[];
};

export type FakeAdAdapter = AdPlatformAdapter & {
  calls: FakeAdCall[];
  /** Scripts the next call(s) of `method` to fail. */
  failNext(method: FakeAdCall["method"], failure: FakeFailure, times?: number): void;
  /** Makes `getDailySpend` report an incomplete read (a page failed). */
  failSpendPage(): void;
  campaignsOf(accountId: string): AdCampaignState[];
  writeCount(): number;
};

export function createFakeAdAdapter(seed: FakeAdSeed = {}): FakeAdAdapter {
  const platform = seed.platform ?? "google";
  const campaigns = new Map<string, AdCampaignState[]>();
  for (const [accountId, rows] of Object.entries(seed.campaigns ?? {})) {
    campaigns.set(
      accountId,
      rows.map((c) => ({ ...c, currency: c.currency ?? AD_CURRENCY })),
    );
  }
  const calls: FakeAdCall[] = [];
  const failures = new Map<FakeAdCall["method"], FakeFailure[]>();
  let spendPageFailed = false;

  const run = async <T>(
    method: FakeAdCall["method"],
    ctx: AdAdapterContext,
    arg: unknown,
    body: () => Result<T>,
  ): Promise<Result<T>> => {
    calls.push({ method, ctx, arg });
    const failure = failures.get(method)?.shift();
    if (failure) {
      if ("throws" in failure) throw new Error(failure.throws);
      return { ok: false, code: failure.code, message: failure.message };
    }
    return body();
  };

  const inRange = (date: string, range: AdDateRange) => date >= range.from && date <= range.to;
  const accountCampaigns = (accountId: string) => campaigns.get(accountId) ?? [];
  const ownIds = (accountId: string) => new Set(accountCampaigns(accountId).map((c) => c.campaignId));

  const applyTo = (command: AdChangeCommand): Result<AdChangeApplied> => {
    const list = accountCampaigns(command.accountId);
    const campaign = list.find((c) => c.campaignId === command.campaignId);
    if (!campaign) {
      return { ok: false, code: "no_such_campaign", message: `no campaign ${command.campaignId}` };
    }
    const before = { status: campaign.status, dailyBudgetMinor: campaign.dailyBudgetMinor };
    switch (command.action) {
      case "pause":
        campaign.status = "paused";
        break;
      case "resume":
        campaign.status = "enabled";
        break;
      case "set_daily_budget":
        campaign.dailyBudgetMinor = command.afterMinor;
        break;
      case "add_keyword":
      case "add_negative_keyword":
        return {
          ok: true,
          value: { before: null, after: { keyword: command.keyword, matchType: command.matchType } },
        };
      case "update_ad_copy":
        return {
          ok: true,
          value: {
            before: null,
            after: { headlines: command.headlines, descriptions: command.descriptions },
          },
        };
    }
    return {
      ok: true,
      value: { before, after: { status: campaign.status, dailyBudgetMinor: campaign.dailyBudgetMinor } },
    };
  };

  return {
    platform,
    mode: "fake",
    calls,
    listCampaigns: (ctx) =>
      run("listCampaigns", ctx, undefined, () => ({
        ok: true,
        value: accountCampaigns(ctx.accountId).map((c) => ({ ...c })),
      })),
    getDailySpend: (ctx, range) =>
      run("getDailySpend", ctx, range, () => {
        const ids = ownIds(ctx.accountId);
        return {
          ok: true,
          value: {
            rows: (seed.dailySpend ?? []).filter((r) => ids.has(r.campaignId) && inRange(r.date, range)),
            complete: !spendPageFailed,
            currency: AD_CURRENCY,
          },
        };
      }),
    getPerformance: (ctx, range) =>
      run("getPerformance", ctx, range, () => {
        const ids = ownIds(ctx.accountId);
        return { ok: true, value: (seed.performance ?? []).filter((r) => ids.has(r.campaignId)) };
      }),
    getSearchTerms: (ctx, range) =>
      run("getSearchTerms", ctx, range, () => {
        const ids = ownIds(ctx.accountId);
        return { ok: true, value: (seed.searchTerms ?? []).filter((r) => ids.has(r.campaignId)) };
      }),
    applyChange: (ctx, command) => run("applyChange", ctx, command, () => applyTo(command)),
    failNext(method, failure, times = 1) {
      const list = failures.get(method) ?? [];
      for (let i = 0; i < times; i++) list.push(failure);
      failures.set(method, list);
    },
    failSpendPage() {
      spendPageFailed = true;
    },
    campaignsOf: (accountId) => accountCampaigns(accountId).map((c) => ({ ...c })),
    writeCount: () => calls.filter((c) => c.method === "applyChange").length,
  };
}
