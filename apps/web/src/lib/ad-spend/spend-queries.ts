import { and, eq, gte, inArray, like, lte, sql } from "drizzle-orm";

import { AD_CODE_PREFIX, type AdChannel } from "@relay/db";
import { db } from "@/db";
import { adMetaMappings, adSpendDaily, companies, type AdSpendDaily } from "@/db/schema";

import { monthDates } from "./spend-grid";

/** Used only when the company has never set `ad_daily_cap_minor` (1.000 TL). */
export const DEFAULT_DAILY_CAP_MINOR = 100000;

const INSERT_CHUNK = 500;

export type SpendWriteSource = "manual" | "csv";

export type SpendWriteRow = {
  date: string;
  channel: AdChannel;
  /** `""` is the channel total for the day (manual entry). */
  campaignId?: string;
  campaignName?: string;
  amountMinor: number;
  impressions?: number;
  clicks?: number;
};

export type SpendKey = { date: string; channel: AdChannel; campaignId: string };

export type UpsertSpendResult = {
  written: number;
  /** Rows that replaced an existing row for the same key. */
  overwritten: number;
  /** Rows not written because an `api` row holds the key. */
  skippedApi: number;
  apiConflicts: SpendKey[];
};

export type SpendMonthRow = Pick<
  AdSpendDaily,
  "spendDate" | "channel" | "campaignId" | "campaignName" | "amountMinor" | "source"
>;

/** All spend rows of one company for `YYYY-MM`. */
export async function listSpendForMonth(companyId: string, month: string): Promise<SpendMonthRow[]> {
  const dates = monthDates(month);
  return db
    .select({
      spendDate: adSpendDaily.spendDate,
      channel: adSpendDaily.channel,
      campaignId: adSpendDaily.campaignId,
      campaignName: adSpendDaily.campaignName,
      amountMinor: adSpendDaily.amountMinor,
      source: adSpendDaily.source,
    })
    .from(adSpendDaily)
    .where(
      and(
        eq(adSpendDaily.companyId, companyId),
        gte(adSpendDaily.spendDate, dates[0]),
        lte(adSpendDaily.spendDate, dates[dates.length - 1]),
      ),
    );
}

/** The company's daily cap (RL4 setting); the default only when unset. */
export async function getDailyCap(companyId: string): Promise<number> {
  const [row] = await db
    .select({ capMinor: companies.adDailyCapMinor })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  return row?.capMinor ?? DEFAULT_DAILY_CAP_MINOR;
}

/** Meta campaign names mapped to an Instagram code (`R...`) in the RL4 mapping. */
export async function listInstagramCampaignNames(companyId: string): Promise<string[]> {
  const rows = await db
    .select({ campaignName: adMetaMappings.campaignName })
    .from(adMetaMappings)
    .where(and(eq(adMetaMappings.companyId, companyId), like(adMetaMappings.code, `${AD_CODE_PREFIX.instagram}%`)));
  return rows.map((r) => r.campaignName);
}

function keyOf(row: { date: string; channel: string; campaignId: string }): string {
  return `${row.date}|${row.channel}|${row.campaignId}`;
}

/**
 * One transaction: upserts on (company, date, channel, campaign), so re-entry
 * overwrites and never adds. An existing `api` row is left alone unless
 * `allowOverApi`; those keys come back as `apiConflicts` for the UI to confirm.
 */
export async function upsertSpendRows(input: {
  companyId: string;
  rows: readonly SpendWriteRow[];
  source: SpendWriteSource;
  allowOverApi?: boolean;
}): Promise<UpsertSpendResult> {
  const { companyId, source, allowOverApi = false } = input;
  const rows = input.rows.map((row) => ({ ...row, campaignId: row.campaignId ?? "" }));
  if (rows.length === 0) return { written: 0, overwritten: 0, skippedApi: 0, apiConflicts: [] };

  return db.transaction(async (tx) => {
    const dates = [...new Set(rows.map((r) => r.date))];
    const existing = await tx
      .select({
        date: adSpendDaily.spendDate,
        channel: adSpendDaily.channel,
        campaignId: adSpendDaily.campaignId,
        source: adSpendDaily.source,
      })
      .from(adSpendDaily)
      .where(and(eq(adSpendDaily.companyId, companyId), inArray(adSpendDaily.spendDate, dates)));
    const existingSource = new Map(existing.map((e) => [keyOf(e), e.source]));

    const apiConflicts: SpendKey[] = [];
    const toWrite = rows.filter((row) => {
      if (!allowOverApi && existingSource.get(keyOf(row)) === "api") {
        apiConflicts.push({ date: row.date, channel: row.channel, campaignId: row.campaignId });
        return false;
      }
      return true;
    });
    const overwritten = toWrite.filter((row) => existingSource.has(keyOf(row))).length;

    for (let start = 0; start < toWrite.length; start += INSERT_CHUNK) {
      const chunk = toWrite.slice(start, start + INSERT_CHUNK);
      await tx
        .insert(adSpendDaily)
        .values(
          chunk.map((row) => ({
            companyId,
            spendDate: row.date,
            channel: row.channel,
            campaignId: row.campaignId,
            campaignName: row.campaignName ?? null,
            amountMinor: row.amountMinor,
            impressions: row.impressions ?? null,
            clicks: row.clicks ?? null,
            source,
          })),
        )
        .onConflictDoUpdate({
          target: [adSpendDaily.companyId, adSpendDaily.spendDate, adSpendDaily.channel, adSpendDaily.campaignId],
          set: {
            amountMinor: sql`excluded.amount_minor`,
            campaignName: sql`excluded.campaign_name`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            source: sql`excluded.source`,
            updatedAt: sql`now()`,
          },
          // A concurrent API pull between the read and this write still wins.
          ...(allowOverApi ? {} : { setWhere: sql`${adSpendDaily.source} <> 'api'` }),
        });
    }

    return { written: toWrite.length, overwritten, skippedApi: apiConflicts.length, apiConflicts };
  });
}
