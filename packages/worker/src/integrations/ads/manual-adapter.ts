import { and, desc, eq } from "drizzle-orm";
import {
  AD_CURRENCY,
  adChangeLog,
  db,
  type AdChangeCommand,
  type AdChangeLogRow,
  type AdPlatform,
} from "@relay/db";
import type {
  AdAdapterContext,
  AdCampaignState,
  AdChangeApplied,
  AdPlatformAdapter,
  Result,
} from "./adapter";

/**
 * 08b2 (RELAY-167): the adapter for an ad account nobody connected an API
 * for. A person makes the change in the ad panel and presses "Uygulandı";
 * this adapter only records what that press means. It makes no network call
 * and reads no credential. Campaign state comes from the company's own
 * `ad_change_log` (newest applied result first) and, for the campaign of the
 * command in hand, from the proposer's `observed` view.
 */

/** `outcome_detail` of a result row written for a manual change. */
export const MANUAL_OUTCOME_DETAIL = "manual: applied by the owner in the ad panel";

export type ManualAdLogRow = Pick<
  AdChangeLogRow,
  "campaignId" | "campaignName" | "beforeValue" | "afterValue"
>;

export interface ManualAdStore {
  /** Applied result rows of one account, newest first. */
  appliedResults(input: {
    companyId: string;
    platform: AdPlatform;
    accountId: string;
  }): Promise<ManualAdLogRow[]>;
}

type PartialState = { name?: string; status?: AdCampaignState["status"]; dailyBudgetMinor?: number };

function stateFields(value: unknown): PartialState {
  if (!value || typeof value !== "object") return {};
  const v = value as { status?: unknown; dailyBudgetMinor?: unknown };
  const out: PartialState = {};
  if (v.status === "enabled" || v.status === "paused") out.status = v.status;
  if (typeof v.dailyBudgetMinor === "number" && Number.isFinite(v.dailyBudgetMinor)) {
    out.dailyBudgetMinor = v.dailyBudgetMinor;
  }
  return out;
}

function fillMissing(into: PartialState, from: PartialState) {
  if (into.name === undefined && from.name) into.name = from.name;
  if (into.status === undefined && from.status) into.status = from.status;
  if (into.dailyBudgetMinor === undefined && from.dailyBudgetMinor !== undefined) {
    into.dailyBudgetMinor = from.dailyBudgetMinor;
  }
}

/**
 * Campaigns known for one account: each field from the newest applied row
 * that carries it (after value first, then before value), then the command's
 * `observed` view for whatever is still missing on its own campaign.
 */
export function knownCampaigns(
  rows: ManualAdLogRow[],
  ctx: AdAdapterContext,
  platform: AdPlatform,
  command: AdChangeCommand | undefined,
): AdCampaignState[] {
  const byId = new Map<string, PartialState>();
  for (const row of rows) {
    const entry = byId.get(row.campaignId) ?? {};
    fillMissing(entry, { ...stateFields(row.afterValue), ...(row.campaignName ? { name: row.campaignName } : {}) });
    fillMissing(entry, stateFields(row.beforeValue));
    byId.set(row.campaignId, entry);
  }
  if (
    command?.observed &&
    command.platform === platform &&
    command.accountId === ctx.accountId
  ) {
    const entry = byId.get(command.campaignId) ?? {};
    fillMissing(entry, {
      name: command.observed.campaignName,
      status: command.observed.status,
      dailyBudgetMinor: command.observed.dailyBudgetMinor,
    });
    byId.set(command.campaignId, entry);
  }
  const out: AdCampaignState[] = [];
  for (const [campaignId, s] of byId) {
    if (s.status === undefined || s.dailyBudgetMinor === undefined) continue;
    out.push({
      campaignId,
      name: s.name ?? campaignId,
      status: s.status,
      dailyBudgetMinor: s.dailyBudgetMinor,
      currency: AD_CURRENCY,
    });
  }
  return out;
}

function manualChange(command: AdChangeCommand, c: AdCampaignState | null): Result<AdChangeApplied> {
  const stamp = { appliedBy: "manual" as const };
  switch (command.action) {
    case "pause":
    case "resume":
    case "set_daily_budget": {
      if (!c) {
        return { ok: false, code: "no_such_campaign", message: `campaign ${command.campaignId} not found` };
      }
      const before = { status: c.status, dailyBudgetMinor: c.dailyBudgetMinor };
      const after =
        command.action === "set_daily_budget"
          ? { ...before, dailyBudgetMinor: command.afterMinor }
          : { ...before, status: command.action === "pause" ? ("paused" as const) : ("enabled" as const) };
      return { ok: true, value: { before, after: { ...after, ...stamp } } };
    }
    case "add_keyword":
      return {
        ok: true,
        value: {
          before: null,
          after: { adGroupId: command.adGroupId, keyword: command.keyword, matchType: command.matchType, ...stamp },
        },
      };
    case "add_negative_keyword":
      return {
        ok: true,
        value: { before: null, after: { keyword: command.keyword, matchType: command.matchType, ...stamp } },
      };
    case "update_ad_copy":
      return {
        ok: true,
        value: {
          before: null,
          after: {
            adGroupId: command.adGroupId,
            headlines: command.headlines,
            descriptions: command.descriptions,
            ...stamp,
          },
        },
      };
  }
}

export function createManualAdAdapter(opts: {
  platform: AdPlatform;
  store: ManualAdStore;
  /** The change being proposed or applied; its `observed` campaign is always known. */
  command?: AdChangeCommand;
}): AdPlatformAdapter {
  const { platform, store, command } = opts;
  const campaigns = async (ctx: AdAdapterContext, cmd: AdChangeCommand | undefined) =>
    knownCampaigns(
      await store.appliedResults({ companyId: ctx.companyId, platform, accountId: ctx.accountId }),
      ctx,
      platform,
      cmd,
    );

  return {
    platform,
    mode: "manual",
    async listCampaigns(ctx) {
      return { ok: true, value: await campaigns(ctx, command) };
    },
    // Spend for a manual account comes from the owner's entry (RL5), not here.
    async getDailySpend() {
      return { ok: false, code: "platform_error", message: "manual" };
    },
    async getPerformance() {
      return { ok: true, value: [] };
    },
    async getSearchTerms() {
      return { ok: true, value: [] };
    },
    async applyChange(ctx, cmd) {
      const list = await campaigns(ctx, cmd);
      return manualChange(cmd, list.find((c) => c.campaignId === cmd.campaignId) ?? null);
    },
  };
}

/** Bounded read: the newest applied rows are enough to know each campaign. */
const MANUAL_HISTORY_LIMIT = 500;

export const pgManualAdStore: ManualAdStore = {
  appliedResults({ companyId, platform, accountId }) {
    return db
      .select({
        campaignId: adChangeLog.campaignId,
        campaignName: adChangeLog.campaignName,
        beforeValue: adChangeLog.beforeValue,
        afterValue: adChangeLog.afterValue,
      })
      .from(adChangeLog)
      .where(
        and(
          eq(adChangeLog.companyId, companyId),
          eq(adChangeLog.platform, platform),
          eq(adChangeLog.accountId, accountId),
          eq(adChangeLog.phase, "result"),
          eq(adChangeLog.outcome, "applied"),
        ),
      )
      .orderBy(desc(adChangeLog.seq))
      .limit(MANUAL_HISTORY_LIMIT);
  },
};
