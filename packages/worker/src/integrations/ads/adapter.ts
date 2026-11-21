import { AD_CURRENCY, type AdChangeCommand, type AdPlatform } from "@relay/db";

/**
 * RL8a: the contract every ad platform adapter implements. RL9 writes the
 * Google and Meta adapters against this file, 08b2 the manual one; the fake
 * is a test double. Credentials are resolved inside each adapter from the
 * company's integration and never cross this interface, a log row or an
 * error message. There is no delete method and no command that deletes.
 */

export type AdAdapterErrorCode = "platform_unreachable" | "platform_error" | "no_such_campaign";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; code: AdAdapterErrorCode; message: string };

/** `api` = RL9 platform APIs, `manual` = a person applies it in the ad panel (b2), `fake` = tests. */
export type AdAdapterMode = "api" | "manual" | "fake";

export type AdAdapterContext = { companyId: string; accountId: string };

/** Inclusive `YYYY-MM-DD` day labels. */
export type AdDateRange = { from: string; to: string };

export type AdCampaignState = {
  campaignId: string;
  name: string;
  status: "enabled" | "paused";
  dailyBudgetMinor: number;
  /** Must be `AD_CURRENCY` (TRY); see `requireTryCampaigns`. */
  currency: string;
};

export type AdDailySpend = {
  rows: { date: string; campaignId: string; spendMinor: number }[];
  /** False when any page or account failed (RL7 completeness rule). */
  complete: boolean;
  currency: string;
};

export type AdPerformanceRow = {
  campaignId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  costMinor: number;
};

export type AdSearchTermRow = {
  campaignId: string;
  term: string;
  clicks: number;
  costMinor: number;
};

export type AdChangeApplied = { before: unknown; after: unknown };

export interface AdPlatformAdapter {
  readonly platform: AdPlatform;
  readonly mode: AdAdapterMode;
  listCampaigns(ctx: AdAdapterContext): Promise<Result<AdCampaignState[]>>;
  getDailySpend(ctx: AdAdapterContext, range: AdDateRange): Promise<Result<AdDailySpend>>;
  getPerformance(ctx: AdAdapterContext, range: AdDateRange): Promise<Result<AdPerformanceRow[]>>;
  getSearchTerms(ctx: AdAdapterContext, range: AdDateRange): Promise<Result<AdSearchTermRow[]>>;
  applyChange(ctx: AdAdapterContext, command: AdChangeCommand): Promise<Result<AdChangeApplied>>;
}

/** A campaign list is only usable when every budget is in TRY minor units. */
export function requireTryCampaigns(result: Result<AdCampaignState[]>): Result<AdCampaignState[]> {
  if (!result.ok) return result;
  const other = result.value.find((c) => c.currency !== AD_CURRENCY);
  if (other) {
    return {
      ok: false,
      code: "platform_error",
      message: `campaign ${other.campaignId} is in ${other.currency}, expected ${AD_CURRENCY}`,
    };
  }
  return result;
}
