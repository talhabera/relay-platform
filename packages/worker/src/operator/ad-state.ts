import { and, eq, gte, lte } from "drizzle-orm";
import {
  AD_CHANNELS,
  AD_CURRENCY,
  adSpendDaily,
  addDaysLabel,
  companies,
  dayLabels,
  db,
  evaluateAdState,
  formatTryMinor,
  type AdAlert,
  type AdChannel,
  type AdMonitorSettings,
  type AdState,
} from "@relay/db";
import { localDateLabel, reportTimeZone } from "@relay/db/report-snapshots";
import {
  loadLeadsByChannelDay,
  loadWonByPackageThisMonth,
  type AdCapacityLimits,
  type AdCapacityState,
  type AdChannelKey,
  type LeadsByChannelDay,
} from "./ad-leads";

/**
 * `readAdState` (RL7): the deterministic ad state the Ad Monitor writes its
 * brief from. Every figure is computed here; money goes out as `_minor`
 * integers plus a preformatted TL string so the model never formats or
 * computes money. Company-scoped reads only, no config column, no
 * integration row, no credential (AGENTS.md invariants 5 and 9). Read only.
 */

export const READ_AD_STATE_TOOL = "readAdState";
/** RL5's spend entry page. */
export const AD_SPEND_PAGE_PATH = "/analytics/spend";

export const AD_CHANNEL_LABELS: Record<AdChannelKey, string> = {
  google: "Google",
  instagram: "Instagram",
  meta: "Meta",
  unknown: "bilinmiyor",
};

export type AdCompanyRow = {
  timezone: string | null;
  cplStopMinor: number | null;
  monthlyTargetMinor: number | null;
  dailyCapMinor: number | null;
  capacitySiteMonthly: number | null;
  capacitySocialMonthly: number | null;
};

export type AdSpendRow = { spendDate: string; channel: AdChannel; amountMinor: number; complete: boolean };

export type AdStateDeps = {
  loadCompany(companyId: string): Promise<AdCompanyRow | null>;
  loadSpendRows(companyId: string, from: string, to: string): Promise<AdSpendRow[]>;
  loadLeadsByChannelDay(companyId: string, from: Date, to: Date, timeZone: string): Promise<LeadsByChannelDay>;
  loadWonByPackageThisMonth(
    companyId: string,
    monthStart: string,
    timeZone: string,
    limits: AdCapacityLimits,
  ): Promise<AdCapacityState>;
};

export const defaultAdStateDeps: AdStateDeps = {
  loadCompany: async (companyId) => {
    const [row] = await db
      .select({
        timezone: companies.timezone,
        cplStopMinor: companies.adCplStopMinor,
        monthlyTargetMinor: companies.adMonthlyTargetMinor,
        dailyCapMinor: companies.adDailyCapMinor,
        capacitySiteMonthly: companies.adCapacitySiteMonthly,
        capacitySocialMonthly: companies.adCapacitySocialMonthly,
      })
      .from(companies)
      .where(eq(companies.id, companyId))
      .limit(1);
    return row ?? null;
  },
  loadSpendRows: (companyId, from, to) =>
    db
      .select({
        spendDate: adSpendDaily.spendDate,
        channel: adSpendDaily.channel,
        amountMinor: adSpendDaily.amountMinor,
        complete: adSpendDaily.complete,
      })
      .from(adSpendDaily)
      .where(
        and(
          eq(adSpendDaily.companyId, companyId),
          gte(adSpendDaily.spendDate, from),
          lte(adSpendDaily.spendDate, to),
        ),
      ),
  loadLeadsByChannelDay: (companyId, from, to, timeZone) =>
    loadLeadsByChannelDay(companyId, from, to, { timeZone }),
  loadWonByPackageThisMonth: (companyId, monthStart, timeZone, limits) =>
    loadWonByPackageThisMonth(companyId, monthStart, { timeZone, limits }),
};

type Money = { minor: number | null; text: string };
const money = (minor: number | null): Money => ({ minor, text: formatTryMinor(minor) });

/** A spend span; `null` minor means no row was entered ("girilmedi"). */
type SpendSpan = Money & { complete: boolean; missingDays: number };

export type AdTableSpan = {
  from: string;
  to: string;
  /** Null for `bilinmiyor`: nobody pays for it. */
  spend: SpendSpan | null;
  leads: number;
  cpl: Money;
};

export type AdTableRow = { channel: AdChannelKey; label: string; yesterday: AdTableSpan; month: AdTableSpan };

export type AdStateView = {
  currency: typeof AD_CURRENCY;
  todayLocal: string;
  matureThrough: string;
  immatureDays: string[];
  table: AdTableRow[];
  settings: { cplStop: Money | null; monthlyTarget: Money | null; dailyCap: Money | null };
  channels: AdState["channels"];
  alerts: Array<AdAlert & { label: string | null }>;
  proposals: Array<{
    key: string;
    kind: "pause_channel";
    channel: AdChannel;
    label: string;
    metric: "cpl" | "leads";
    cpl: Money;
    threshold: Money;
    spend: Money;
    leads: number;
    windowDays: number;
    lowData: boolean;
    lastLiveChannel: boolean;
  }>;
  completeness: AdState["completeness"];
  capacity: AdCapacityState;
  hrefs: { home: string; spendEntry: string };
};

function previousMonthStart(today: string): string {
  const [y, m] = today.split("-").map(Number);
  return m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
}

const optionalMoney = (minor: number | null): Money | null => (minor === null ? null : money(minor));

/**
 * Builds the ad state for one company at `now`. Spend covers the current and
 * previous local month; leads are bucketed by local creation day. Every
 * loader receives the run's `companyId`.
 */
export async function loadAdState(
  companyId: string,
  now: Date = new Date(),
  deps: AdStateDeps = defaultAdStateDeps,
): Promise<AdStateView> {
  const company = await deps.loadCompany(companyId);
  const timeZone = reportTimeZone(company?.timezone);
  const today = localDateLabel(now, timeZone);
  const yesterday = addDaysLabel(today, -1);
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = previousMonthStart(today);
  const settings: AdMonitorSettings = {
    cplStopMinor: company?.cplStopMinor ?? null,
    monthlyTargetMinor: company?.monthlyTargetMinor ?? null,
    dailyCapMinor: company?.dailyCapMinor ?? null,
  };

  // One day of slack on each side; leads are filtered by local day below.
  const leadsFrom = new Date(Date.parse(`${from}T00:00:00Z`) - 86_400_000);
  const leadsTo = new Date(Date.parse(`${today}T00:00:00Z`) + 2 * 86_400_000);
  const [spendRows, leadsRaw, capacity] = await Promise.all([
    deps.loadSpendRows(companyId, from, today),
    deps.loadLeadsByChannelDay(companyId, leadsFrom, leadsTo, timeZone),
    deps.loadWonByPackageThisMonth(companyId, monthStart, timeZone, {
      site: company?.capacitySiteMonthly ?? null,
      social: company?.capacitySocialMonthly ?? null,
    }),
  ]);

  const inRange = (day: string) => day >= from && day <= today;
  const leads = {} as LeadsByChannelDay;
  for (const key of [...AD_CHANNELS, "unknown"] as const) {
    leads[key] = Object.fromEntries(Object.entries(leadsRaw[key] ?? {}).filter(([d]) => inRange(d)));
  }
  const lastLeadDate = (key: AdChannelKey): string | null => {
    const days = Object.keys(leads[key]).filter((d) => leads[key][d] > 0).sort();
    return days.length ? days[days.length - 1] : null;
  };

  const state = evaluateAdState({
    today,
    settings,
    channels: AD_CHANNELS.map((channel) => ({
      channel,
      spend: spendRows
        .filter((r) => r.channel === channel)
        .map((r) => ({ date: r.spendDate, amountMinor: r.amountMinor, complete: r.complete })),
      leadsByDay: leads[channel],
      lastLeadDate: lastLeadDate(channel),
    })),
  });

  const spanOf = (key: AdChannelKey, spanFrom: string, spanTo: string): AdTableSpan => {
    const days = dayLabels(spanFrom, spanTo);
    const leadCount = days.reduce((sum, d) => sum + (leads[key][d] ?? 0), 0);
    if (key === "unknown") return { from: spanFrom, to: spanTo, spend: null, leads: leadCount, cpl: money(null) };
    const rows = spendRows.filter((r) => r.channel === key && r.spendDate >= spanFrom && r.spendDate <= spanTo);
    const entered = new Set(rows.map((r) => r.spendDate));
    const minor = rows.length ? rows.reduce((sum, r) => sum + r.amountMinor, 0) : null;
    const spend: SpendSpan = {
      ...money(minor),
      text: minor === null ? "girilmedi" : formatTryMinor(minor),
      complete: rows.every((r) => r.complete) && entered.size === days.length,
      missingDays: days.length - entered.size,
    };
    const cpl = minor !== null && leadCount > 0 ? Math.round(minor / leadCount) : null;
    return { from: spanFrom, to: spanTo, spend, leads: leadCount, cpl: money(cpl) };
  };

  // Month to date runs through yesterday for both spend and leads, so the
  // month CPL never divides yesterday's spend by today's leads.
  const monthTo = yesterday < monthStart ? monthStart : yesterday;
  const table: AdTableRow[] = (["google", "instagram", "meta", "unknown"] as const).map((key) => ({
    channel: key,
    label: AD_CHANNEL_LABELS[key],
    yesterday: spanOf(key, yesterday, yesterday),
    month: spanOf(key, monthStart, monthTo),
  }));

  return {
    currency: AD_CURRENCY,
    todayLocal: state.todayLocal,
    matureThrough: state.matureThrough,
    immatureDays: state.immatureDays,
    table,
    settings: {
      cplStop: optionalMoney(settings.cplStopMinor),
      monthlyTarget: optionalMoney(settings.monthlyTargetMinor),
      dailyCap: optionalMoney(settings.dailyCapMinor),
    },
    channels: state.channels,
    alerts: state.alerts.map((alert) => ({
      ...alert,
      label: alert.channel === null ? null : AD_CHANNEL_LABELS[alert.channel],
    })),
    proposals: state.proposals.map((p) => ({
      key: p.key,
      kind: p.kind,
      channel: p.channel,
      label: AD_CHANNEL_LABELS[p.channel],
      metric: p.reason.metric,
      cpl: money(p.reason.value),
      threshold: money(p.reason.thresholdMinor),
      spend: money(p.reason.spendMinor),
      leads: p.reason.leads,
      windowDays: p.reason.windowDays,
      lowData: p.lowData,
      lastLiveChannel: p.lastLiveChannel,
    })),
    completeness: state.completeness,
    capacity,
    hrefs: { home: "/home", spendEntry: AD_SPEND_PAGE_PATH },
  };
}
