import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  AD_CHANNELS,
  AD_CODE_PREFIX,
  adClicks,
  companyRecords,
  db,
  isValidAdCode,
  leadEvents,
  type AdChannel,
  type SalePackage,
} from "@relay/db";
import { localDateLabel } from "@relay/db/report-snapshots";

// Worker-side lead counts for the ad monitor (RL7). `@relay/worker` never
// imports from `apps/web`, so this repeats RL6's channel attribution
// (`apps/web/src/lib/ads/ad-report-model.ts` `resolveLeadAttribution`): a
// linked click wins, then the ad code's first letter, then a Meta referral
// (click-to-WhatsApp, mapped or not), else `unknown` ("bilinmiyor"). If RL6
// changes that order, change it here too. Every read filters by company.

export type AdChannelKey = AdChannel | "unknown";
export const AD_CHANNEL_KEYS: readonly AdChannelKey[] = [...AD_CHANNELS, "unknown"];

export type AdLeadRawRow = {
  id: string;
  createdAt: Date;
  /** `payload.intake.kod`; `organik` or junk is never a channel. */
  kod: string | null;
  referral: unknown;
  /** Channel of the click linked to this record, if any. */
  clickChannel: AdChannel | null;
};

export type AdWonEventRow = {
  recordId: string;
  /** The record's current status. */
  status: string;
  salePackage: SalePackage | null;
  at: Date;
};

export type AdLeadStore = {
  leadRows(companyId: string, from: Date, to: Date): Promise<AdLeadRawRow[]>;
  wonEvents(companyId: string, since: Date): Promise<AdWonEventRow[]>;
};

export const dbAdLeadStore: AdLeadStore = {
  leadRows: (companyId, from, to) =>
    db
      .select({
        id: companyRecords.id,
        createdAt: companyRecords.createdAt,
        kod: sql<string | null>`${companyRecords.payload} #>> '{intake,kod}'`,
        referral: companyRecords.referral,
        clickChannel: adClicks.channel,
      })
      .from(companyRecords)
      .leftJoin(
        adClicks,
        and(eq(adClicks.linkedRecordId, companyRecords.id), eq(adClicks.companyId, companyId)),
      )
      .where(
        and(
          eq(companyRecords.companyId, companyId),
          gte(companyRecords.createdAt, from),
          lt(companyRecords.createdAt, to),
        ),
      ),
  wonEvents: (companyId, since) =>
    db
      .select({
        recordId: leadEvents.recordId,
        status: companyRecords.status,
        salePackage: companyRecords.salePackage,
        at: leadEvents.at,
      })
      .from(leadEvents)
      .innerJoin(
        companyRecords,
        and(eq(companyRecords.id, leadEvents.recordId), eq(companyRecords.companyId, companyId)),
      )
      .where(
        and(
          eq(leadEvents.companyId, companyId),
          eq(leadEvents.toStatus, "won"),
          gte(leadEvents.at, since),
        ),
      ),
};

const CHANNEL_BY_PREFIX = new Map<string, AdChannel>(
  AD_CHANNELS.map((channel) => [AD_CODE_PREFIX[channel], channel]),
);

/** RL6's attribution order, channel only. */
export function attributeLeadChannel(row: Pick<AdLeadRawRow, "kod" | "referral" | "clickChannel">): AdChannelKey {
  if (row.clickChannel) return row.clickChannel;
  const kod = isValidAdCode(row.kod) ? (row.kod as string) : null;
  const byPrefix = kod ? CHANNEL_BY_PREFIX.get(kod[0]) : undefined;
  if (byPrefix) return byPrefix;
  if (row.referral !== null && typeof row.referral === "object") return "meta";
  return "unknown";
}

/** Lead counts per channel and company-local creation day. */
export type LeadsByChannelDay = Record<AdChannelKey, Record<string, number>>;

export function emptyLeadsByChannelDay(): LeadsByChannelDay {
  return { google: {}, instagram: {}, meta: {}, unknown: {} };
}

/**
 * Counts this company's leads created in `[from, to)` per channel and per
 * company-local day (a lead at 22:30 UTC is the next Istanbul day).
 */
export async function loadLeadsByChannelDay(
  companyId: string,
  from: Date,
  to: Date,
  options: { timeZone: string; store?: AdLeadStore },
): Promise<LeadsByChannelDay> {
  const store = options.store ?? dbAdLeadStore;
  const rows = await store.leadRows(companyId, from, to);
  const out = emptyLeadsByChannelDay();
  for (const row of rows) {
    const bucket = out[attributeLeadChannel(row)];
    const day = localDateLabel(row.createdAt, options.timeZone);
    bucket[day] = (bucket[day] ?? 0) + 1;
  }
  return out;
}

export type AdCapacityLine = { won: number; limit: number | null; full: boolean };
export type AdCapacityState = { site: AdCapacityLine; social: AdCapacityLine };
export type AdCapacityLimits = { site: number | null; social: number | null };

/**
 * Records won this month per sale package, counted once each, and whether a
 * package's monthly capacity is full. A record whose latest `won` event is in
 * the month counts only while it is still `won` (re-opened deals drop out).
 * `monthStart` is the company-local `YYYY-MM-01`. A null limit is no rule.
 */
export async function loadWonByPackageThisMonth(
  companyId: string,
  monthStart: string,
  options: { timeZone: string; limits: AdCapacityLimits; store?: AdLeadStore },
): Promise<AdCapacityState> {
  const store = options.store ?? dbAdLeadStore;
  // One day of slack before the local month start; filtered by local day below.
  const since = new Date(Date.parse(`${monthStart}T00:00:00Z`) - 86_400_000);
  const rows = await store.wonEvents(companyId, since);
  const counted = new Map<string, SalePackage>();
  for (const row of rows) {
    if (row.status !== "won" || row.salePackage === null) continue;
    if (localDateLabel(row.at, options.timeZone) < monthStart) continue;
    counted.set(row.recordId, row.salePackage);
  }
  const won = { website: 0, social: 0 };
  for (const pkg of counted.values()) won[pkg] += 1;
  const line = (count: number, limit: number | null): AdCapacityLine => ({
    won: count,
    limit,
    full: limit !== null && count >= limit,
  });
  return { site: line(won.website, options.limits.site), social: line(won.social, options.limits.social) };
}
