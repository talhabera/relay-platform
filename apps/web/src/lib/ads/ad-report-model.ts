import {
  AD_CHANNELS,
  AD_CODE_PREFIX,
  AD_CURRENCY,
  isValidAdCode,
  type AdChannel,
  type SalePackage,
} from "@relay/db";

// Koleva reklam Home tile (RL6, design 6.5). Pure: the query hands in rows,
// this builds the per-channel table, cash, target, capacity and warnings.
// Money is integer TRY minor units (kuruş, KDV hariç) everywhere; only
// `formatTry` turns it into whole TL. Days are company-local `YYYY-MM-DD`
// labels, so span checks are string compares and day math is calendar math.

export const AD_REPORT_CURRENCY = AD_CURRENCY;
export const FIRST_RESPONSE_LIMIT_MS = 60_000;
export const MAX_AD_WARNINGS = 5;
/** Campaign of a Meta lead whose `referral.sourceId` has no mapping row. */
export const UNMAPPED_META_CAMPAIGN = "eslenmemis";

export type AdChannelKey = AdChannel | "unknown";
export const AD_REPORT_CHANNELS: readonly AdChannelKey[] = ["google", "instagram", "meta", "unknown"];
export const AD_CHANNEL_LABEL: Record<AdChannelKey, string> = {
  google: "Google Arama",
  instagram: "Instagram geri",
  meta: "Meta WhatsApp",
  unknown: "bilinmiyor",
};

const MONTHS_TR = [
  "Ocak",
  "Subat",
  "Mart",
  "Nisan",
  "Mayis",
  "Haziran",
  "Temmuz",
  "Agustos",
  "Eylul",
  "Ekim",
  "Kasim",
  "Aralik",
];

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type AdSpendRow = {
  spendDate: string;
  channel: AdChannel;
  campaignId: string;
  campaignName: string | null;
  amountMinor: number;
  complete: boolean;
};

/** Only the fields cash needs; entries come parsed by `readLeadPayments`. */
export type AdPayment = { amountMinor: number; receivedOn: string };

export type AdLeadRow = {
  id: string;
  /** Company-local day the lead was created. */
  createdOn: string;
  payloadKod: string | null;
  /** True when `company_records.referral` is set (click-to-WhatsApp). */
  hasReferral: boolean;
  referralSourceId: string | null;
  linkedClickChannel: AdChannel | null;
  status: string;
  salePackage: SalePackage | null;
  saleAmountMinor: number | null;
  firstResponseMs: number | null;
  payments: readonly AdPayment[];
};

/** A status change. `fromStatus === toStatus` (a payment log entry) is not a transition. */
export type AdStageEvent = { recordId: string; fromStatus: string | null; toStatus: string; on: string };

export type AdMetaMapping = { sourceId: string; code: string; campaignName: string };

export type AdSettings = {
  monthlyTargetMinor: number | null;
  cplStopMinor: number | null;
  dailyCapMinor: number | null;
  capacitySiteMonthly: number | null;
  capacitySocialMonthly: number | null;
};

export type AdReportInput = {
  spend: readonly AdSpendRow[];
  leads: readonly AdLeadRow[];
  events: readonly AdStageEvent[];
  mappings: readonly AdMetaMapping[];
  settings: AdSettings;
  /** Company-local today, `YYYY-MM-DD`. */
  today: string;
  timeZone: string;
  /** First day of today's local month, `YYYY-MM-DD`. */
  monthStart: string;
};

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type AdSpendCell = {
  state: "ok" | "partial" | "missing";
  /** Sum of the known rows; null when no day of the span has a row. */
  minor: number | null;
  missingDays: string[];
  partialDays: string[];
};

export type AdSpan = {
  /** Null for `unknown`: nobody pays for "bilinmiyor". */
  spend: AdSpendCell | null;
  spendMinor: number | null;
  leads: number;
  qualified: number;
  meetings: number;
  proposals: number;
  won: number;
  cplMinor: number | null;
  signedMinor: number;
};

export type AdChannelRow = { channel: AdChannelKey; label: string; yesterday: AdSpan; month: AdSpan };
export type AdTotalSpan = AdSpan & { spendComplete: boolean };

export type AdMetaCampaignRow = {
  campaign: string | null;
  leads: number;
  qualified: number;
  won: number;
  signedMinor: number;
  spend: number | null;
};

export type AdCapacityLine = { won: number; capacity: number | null; full: boolean };
export type AdCapacity = { website: AdCapacityLine; social: AdCapacityLine };

export type AdFirstResponse = { measured: number; late: number; medianMs: number | null };

export type AdTarget = { signedMinor: number; targetMinor: number; percent: number; barPercent: number };

export type AdWarningKind =
  | "cpl"
  | "daily_cap"
  | "capacity"
  | "first_response"
  | "missing_data"
  | "no_leads"
  | "meta_unmapped";
export type AdWarning = { kind: AdWarningKind; channel: AdChannelKey | null; text: string };

export type AdReportModel = {
  currency: typeof AD_CURRENCY;
  today: string;
  yesterday: string;
  monthStart: string;
  rows: AdChannelRow[];
  totals: { yesterday: AdTotalSpan; month: AdTotalSpan };
  metaCampaigns: AdMetaCampaignRow[];
  cashInMinor: number | null;
  cashMinusSpendMinor: number | null;
  capacity: AdCapacity;
  firstResponse: AdFirstResponse;
  target: AdTarget | null;
  immatureDays: [string, string];
  warnings: AdWarning[];
};

// ---------------------------------------------------------------------------
// Day labels
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function labelToUtc(label: string): number {
  const [y, m, d] = label.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(label: string, days: number): string {
  return new Date(labelToUtc(label) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive list of labels from `from` to `to`; empty when `to < from`. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function nextMonthStart(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** `2026-11-03` -> `3 Kasim`. */
export function dayLabelTr(label: string): string {
  const [, m, d] = label.split("-").map(Number);
  return `${d} ${MONTHS_TR[m - 1]}`;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Minor units in, whole TL out with the Turkish thousands dot: `1.234 TL`. `null` is `-`. */
export function formatTry(minor: number | null): string {
  if (minor === null) return "-";
  const whole = Math.round(minor / 100);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole < 0 ? "-" : ""}${digits} TL`;
}

/** A span with no spend row at all reads `girilmedi`, never zero. */
export function formatSpend(cell: AdSpendCell | null): string {
  if (cell === null) return "-";
  if (cell.minor === null) return "girilmedi";
  return formatTry(cell.minor);
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export type AdAttributionVia = "click" | "code" | "meta_mapping" | "referral" | "none";
export type AdAttribution = { channel: AdChannelKey; campaign: string | null; via: AdAttributionVia };

const CHANNEL_BY_PREFIX = new Map<string, AdChannel>(
  AD_CHANNELS.map((channel) => [AD_CODE_PREFIX[channel], channel]),
);

/**
 * Channel of a lead (design 6.3, K13): a linked click wins, then the code's
 * first letter, then a Meta `referral` (click-to-WhatsApp, no code). Anything
 * else is `unknown`, never guessed. `mappings` are this company's rows only.
 */
export function resolveLeadAttribution(
  lead: Pick<AdLeadRow, "payloadKod" | "hasReferral" | "referralSourceId" | "linkedClickChannel">,
  mappings: readonly AdMetaMapping[],
): AdAttribution {
  const kod = isValidAdCode(lead.payloadKod) ? (lead.payloadKod as string) : null;
  const metaCampaignByCode = (channel: AdChannelKey) =>
    channel === "meta" && kod ? (mappings.find((m) => m.code === kod)?.campaignName ?? null) : null;

  if (lead.linkedClickChannel) {
    return { channel: lead.linkedClickChannel, campaign: metaCampaignByCode(lead.linkedClickChannel), via: "click" };
  }
  const byPrefix = kod ? CHANNEL_BY_PREFIX.get(kod[0]) : undefined;
  if (byPrefix) return { channel: byPrefix, campaign: metaCampaignByCode(byPrefix), via: "code" };
  if (lead.hasReferral || lead.referralSourceId) {
    const mapping = lead.referralSourceId
      ? mappings.find((m) => m.sourceId === lead.referralSourceId)
      : undefined;
    return mapping
      ? { channel: "meta", campaign: mapping.campaignName, via: "meta_mapping" }
      : { channel: "meta", campaign: UNMAPPED_META_CAMPAIGN, via: "referral" };
  }
  return { channel: "unknown", campaign: null, via: "none" };
}

// ---------------------------------------------------------------------------
// Cash, first response, capacity
// ---------------------------------------------------------------------------

/** Payments received in `[monthStart, nextMonthStart)`; real entries only, never estimated. */
export function monthCashInMinor(payments: readonly AdPayment[], monthStart: string, nextMonth: string): number {
  let sum = 0;
  for (const p of payments) {
    if (!Number.isInteger(p.amountMinor) || p.amountMinor <= 0 || typeof p.receivedOn !== "string") continue;
    if (p.receivedOn >= monthStart && p.receivedOn < nextMonth) sum += p.amountMinor;
  }
  return sum;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Leads created in the last 7 local days (today included) that have a measured first response. */
export function firstResponseStats(
  rows: readonly Pick<AdLeadRow, "createdOn" | "firstResponseMs">[],
  today: string,
): AdFirstResponse {
  const since = addDays(today, -6);
  const measured = rows
    .filter((r) => r.createdOn >= since && r.createdOn <= today && typeof r.firstResponseMs === "number")
    .map((r) => r.firstResponseMs as number);
  return {
    measured: measured.length,
    late: measured.filter((ms) => ms > FIRST_RESPONSE_LIMIT_MS).length,
    medianMs: median(measured),
  };
}

export function firstResponseWarning(
  rows: readonly Pick<AdLeadRow, "createdOn" | "firstResponseMs">[],
  today: string,
): AdWarning | null {
  const stats = firstResponseStats(rows, today);
  if (stats.measured === 0 || stats.late === 0) return null;
  const medianSec = Math.round((stats.medianMs ?? 0) / 1000);
  return {
    kind: "first_response",
    channel: null,
    text: `Ilk yanit 60 sn ustu: ${stats.late} / ${stats.measured} basvuru, ortanca ${medianSec} sn`,
  };
}

const CAPACITY_NAME: Record<SalePackage, string> = { website: "Site", social: "Sosyal" };

export function capacityStatus(
  wonByPackage: Record<SalePackage, number>,
  settings: Pick<AdSettings, "capacitySiteMonthly" | "capacitySocialMonthly">,
): { capacity: AdCapacity; warnings: AdWarning[] } {
  const line = (won: number, capacity: number | null): AdCapacityLine => ({
    won,
    capacity,
    full: capacity !== null && won >= capacity,
  });
  const capacity: AdCapacity = {
    website: line(wonByPackage.website, settings.capacitySiteMonthly),
    social: line(wonByPackage.social, settings.capacitySocialMonthly),
  };
  const warnings: AdWarning[] = [];
  for (const pkg of ["website", "social"] as const) {
    const c = capacity[pkg];
    if (!c.full || c.capacity === null) continue;
    warnings.push({
      kind: "capacity",
      channel: null,
      text:
        c.capacity === 0
          ? `${CAPACITY_NAME[pkg]} bu ay alinmiyor`
          : `${CAPACITY_NAME[pkg]} kapasitesi dolu: ${c.won} / ${c.capacity}`,
    });
  }
  return { capacity, warnings };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

type Stage = "qualified" | "meeting" | "proposal" | "won";
const STAGES: readonly Stage[] = ["qualified", "meeting", "proposal", "won"];

/**
 * Local-day bounds the query reads: `monthStart`, `windowStart` (events and
 * spend; reaches back over the month start for yesterday and the last 7 days)
 * and `leadSince` (leads; 30 days so "N gundur basvuru yok" can name N).
 */
export function adReportWindow(today: string): { monthStart: string; windowStart: string; leadSince: string } {
  const monthStart = `${today.slice(0, 7)}-01`;
  const sevenBack = addDays(today, -7);
  const thirtyBack = addDays(today, -30);
  return {
    monthStart,
    windowStart: sevenBack < monthStart ? sevenBack : monthStart,
    leadSince: thirtyBack < monthStart ? thirtyBack : monthStart,
  };
}

/** True when the company has anything ad-related to show; otherwise the tile shows its empty state. */
export function hasAdData(input: Pick<AdReportInput, "spend" | "leads" | "mappings" | "settings">): boolean {
  if (input.spend.length > 0 || input.mappings.length > 0) return true;
  if (Object.values(input.settings).some((v) => v !== null)) return true;
  return input.leads.some((l) => resolveLeadAttribution(l, []).channel !== "unknown");
}

export function buildAdReport(input: AdReportInput): AdReportModel {
  const { today, monthStart, settings } = input;
  const yesterday = addDays(today, -1);
  const dayBefore = addDays(today, -2);
  const nextMonth = nextMonthStart(monthStart);
  // Completed days of the month; on the 1st the month span is today alone.
  const monthDays = today === monthStart ? [today] : dayRange(monthStart, yesterday);
  const lastSeven = dayRange(addDays(today, -7), yesterday);

  const attribution = new Map(input.leads.map((l) => [l.id, resolveLeadAttribution(l, input.mappings)]));
  const leadById = new Map(input.leads.map((l) => [l.id, l]));
  const channelOf = (id: string): AdChannelKey => attribution.get(id)?.channel ?? "unknown";

  // Spend: (day, channel) -> summed once over campaigns, partial if any row is partial.
  const spendByDay = new Map<string, { minor: number; partial: boolean }>();
  for (const row of input.spend) {
    const key = `${row.spendDate}|${row.channel}`;
    const cur = spendByDay.get(key) ?? { minor: 0, partial: false };
    spendByDay.set(key, { minor: cur.minor + row.amountMinor, partial: cur.partial || !row.complete });
  }
  const spendCell = (channel: AdChannel, days: readonly string[]): AdSpendCell => {
    let minor: number | null = null;
    const missingDays: string[] = [];
    const partialDays: string[] = [];
    for (const day of days) {
      const cell = spendByDay.get(`${day}|${channel}`);
      if (!cell) {
        missingDays.push(day);
        continue;
      }
      minor = (minor ?? 0) + cell.minor;
      if (cell.partial) partialDays.push(day);
    }
    const state = missingDays.length ? "missing" : partialDays.length ? "partial" : "ok";
    return { state, minor, missingDays, partialDays };
  };

  // Stage transitions in the month, distinct per record. `won` counts only
  // while the record is still won (a lost deal is no sale).
  const { windowStart } = adReportWindow(today);
  const transitions = input.events.filter(
    (e) => e.fromStatus !== e.toStatus && e.on >= windowStart && e.on <= today,
  );
  const stageDays = (stage: Stage) => {
    const byRecord = new Map<string, string[]>();
    for (const e of transitions) {
      if (e.toStatus !== stage) continue;
      if (stage === "won" && leadById.get(e.recordId)?.status !== "won") continue;
      byRecord.set(e.recordId, [...(byRecord.get(e.recordId) ?? []), e.on]);
    }
    return byRecord;
  };
  const stageMaps = Object.fromEntries(STAGES.map((s) => [s, stageDays(s)])) as Record<Stage, Map<string, string[]>>;

  const inSpan = (day: string, span: readonly string[]) => span.includes(day);
  const countStage = (stage: Stage, span: readonly string[], match: (id: string) => boolean) => {
    const ids: string[] = [];
    for (const [id, days] of stageMaps[stage]) if (match(id) && days.some((d) => inSpan(d, span))) ids.push(id);
    return ids;
  };

  const leadSpan = (span: readonly string[]) => (span === monthDays ? dayRange(monthStart, today) : span);
  const funnel = (span: readonly string[], match: (id: string) => boolean) => {
    const leadDays = leadSpan(span);
    const wonIds = countStage("won", leadDays, match);
    return {
      leads: input.leads.filter((l) => match(l.id) && inSpan(l.createdOn, leadDays)).length,
      qualified: countStage("qualified", leadDays, match).length,
      meetings: countStage("meeting", leadDays, match).length,
      proposals: countStage("proposal", leadDays, match).length,
      won: wonIds.length,
      signedMinor: wonIds.reduce((sum, id) => sum + (leadById.get(id)?.saleAmountMinor ?? 0), 0),
    };
  };
  const cpl = (spend: AdSpendCell | null, leads: number) =>
    spend && spend.minor !== null && spend.state !== "missing" && leads > 0 ? Math.round(spend.minor / leads) : null;

  const span = (channel: AdChannelKey, days: readonly string[]): AdSpan => {
    const counts = funnel(days, (id) => channelOf(id) === channel);
    const spend = channel === "unknown" ? null : spendCell(channel, days);
    return { ...counts, spend, spendMinor: spend?.minor ?? null, cplMinor: cpl(spend, counts.leads) };
  };

  const rows: AdChannelRow[] = AD_REPORT_CHANNELS.map((channel) => ({
    channel,
    label: AD_CHANNEL_LABEL[channel],
    yesterday: span(channel, [yesterday]),
    month: span(channel, monthDays),
  }));

  const total = (key: "yesterday" | "month"): AdTotalSpan => {
    const spans = rows.map((r) => r[key]);
    const sum = (f: (s: AdSpan) => number) => spans.reduce((acc, s) => acc + f(s), 0);
    const known = spans.filter((s) => s.spend && s.spend.minor !== null);
    const spendMinor = known.length ? known.reduce((acc, s) => acc + (s.spend!.minor ?? 0), 0) : null;
    const spendComplete = spans.every((s) => !s.spend || s.spend.state !== "missing");
    const anyPartial = spans.some((s) => s.spend?.state === "partial");
    const leads = sum((s) => s.leads);
    const spend: AdSpendCell = {
      state: !spendComplete ? "missing" : anyPartial ? "partial" : "ok",
      minor: spendMinor,
      missingDays: [...new Set(spans.flatMap((s) => s.spend?.missingDays ?? []))].sort(),
      partialDays: [...new Set(spans.flatMap((s) => s.spend?.partialDays ?? []))].sort(),
    };
    return {
      spend,
      spendMinor,
      spendComplete,
      leads,
      qualified: sum((s) => s.qualified),
      meetings: sum((s) => s.meetings),
      proposals: sum((s) => s.proposals),
      won: sum((s) => s.won),
      signedMinor: sum((s) => s.signedMinor),
      cplMinor: cpl(spend, leads),
    };
  };
  const totals = { yesterday: total("yesterday"), month: total("month") };

  // Meta campaign sub-rows (month). Only Meta leads arrive without a code.
  const metaSpendByCampaign = new Map<string, number>();
  for (const row of input.spend) {
    if (row.channel !== "meta" || !row.campaignName || !monthDays.includes(row.spendDate)) continue;
    metaSpendByCampaign.set(row.campaignName, (metaSpendByCampaign.get(row.campaignName) ?? 0) + row.amountMinor);
  }
  const metaCampaignKeys = new Set<string | null>();
  for (const id of attribution.keys()) {
    const a = attribution.get(id)!;
    if (a.channel !== "meta") continue;
    const touched =
      inSpan(leadById.get(id)!.createdOn, dayRange(monthStart, today)) ||
      STAGES.some((s) => stageMaps[s].has(id));
    if (touched) metaCampaignKeys.add(a.campaign);
  }
  const metaCampaigns: AdMetaCampaignRow[] = [...metaCampaignKeys]
    .map((campaign) => {
      const counts = funnel(monthDays, (id) => {
        const a = attribution.get(id);
        return a?.channel === "meta" && a.campaign === campaign;
      });
      return {
        campaign,
        leads: counts.leads,
        qualified: counts.qualified,
        won: counts.won,
        signedMinor: counts.signedMinor,
        spend: campaign && campaign !== UNMAPPED_META_CAMPAIGN ? (metaSpendByCampaign.get(campaign) ?? null) : null,
      };
    })
    .sort((a, b) => campaignRank(a.campaign) - campaignRank(b.campaign) || b.leads - a.leads || (a.campaign ?? "").localeCompare(b.campaign ?? ""));

  // Cash in: recorded payments on won records, dated in the local month.
  const wonRecords = input.leads.filter((l) => l.status === "won");
  const cashInMinor = wonRecords.length
    ? wonRecords.reduce((sum, l) => sum + monthCashInMinor(l.payments, monthStart, nextMonth), 0)
    : null;
  const monthSpend = totals.month.spendMinor;
  const cashMinusSpendMinor = monthSpend === null ? null : (cashInMinor ?? 0) - monthSpend;

  // Capacity: won this month, still won, per package.
  const wonByPackage: Record<SalePackage, number> = { website: 0, social: 0 };
  for (const id of countStage("won", dayRange(monthStart, today), () => true)) {
    const pkg = leadById.get(id)?.salePackage;
    if (pkg) wonByPackage[pkg] += 1;
  }
  const capacity = capacityStatus(wonByPackage, settings);

  const signedMinor = totals.month.signedMinor;
  const target: AdTarget | null =
    settings.monthlyTargetMinor !== null && settings.monthlyTargetMinor > 0
      ? (() => {
          const percent = Math.round((signedMinor / settings.monthlyTargetMinor!) * 100);
          return { signedMinor, targetMinor: settings.monthlyTargetMinor!, percent, barPercent: Math.min(100, percent) };
        })()
      : null;

  // Warnings, most severe first.
  const warnings: AdWarning[] = [];
  if (settings.cplStopMinor !== null) {
    for (const row of rows) {
      if (row.channel === "unknown") continue;
      const m = row.month;
      if (m.leads >= 1 && m.cplMinor !== null && m.cplMinor > settings.cplStopMinor) {
        warnings.push({
          kind: "cpl",
          channel: row.channel,
          text: `${row.label}: basvuru basi maliyet ${formatTry(m.cplMinor)}, esik ${formatTry(settings.cplStopMinor)}`,
        });
      }
    }
  }
  if (settings.dailyCapMinor !== null) {
    const over = lastSeven
      .map((day) => {
        const cells = AD_CHANNELS.map((c) => spendByDay.get(`${day}|${c}`)).filter(Boolean);
        return { day, has: cells.length > 0, minor: cells.reduce((s, c) => s + c!.minor, 0) };
      })
      .filter((d) => d.has && d.minor > settings.dailyCapMinor!);
    const latest = over.at(-1);
    if (latest) {
      warnings.push({
        kind: "daily_cap",
        channel: null,
        text: `${dayLabelTr(latest.day)}: gunluk harcama ${formatTry(latest.minor)}, tavan ${formatTry(settings.dailyCapMinor)}`,
      });
    }
  }
  warnings.push(...capacity.warnings);
  const late = firstResponseWarning(input.leads, today);
  if (late) warnings.push(late);

  const activeChannels = AD_CHANNELS.filter((c) => input.spend.some((r) => r.channel === c));
  const missing = lastSeven.filter((day) =>
    activeChannels.length
      ? activeChannels.some((c) => !spendByDay.has(`${day}|${c}`))
      : !AD_CHANNELS.some((c) => spendByDay.has(`${day}|${c}`)),
  );
  if (missing.length && (activeChannels.length || Object.values(settings).some((v) => v !== null))) {
    const latest = dayLabelTr(missing.at(-1)!);
    warnings.push({
      kind: "missing_data",
      channel: null,
      text:
        missing.length === 1
          ? `${latest} icin harcama girilmedi`
          : `${latest} icin harcama girilmedi, son 7 gunde ${missing.length} gun eksik`,
    });
  }

  for (const channel of AD_CHANNELS) {
    const spent = lastSeven.some((day) => (spendByDay.get(`${day}|${channel}`)?.minor ?? 0) > 0);
    if (!spent) continue;
    const last = input.leads
      .filter((l) => channelOf(l.id) === channel && l.createdOn <= today)
      .map((l) => l.createdOn)
      .sort()
      .at(-1);
    const days = last ? Math.round((labelToUtc(today) - labelToUtc(last)) / DAY_MS) : null;
    if (days !== null && days < 7) continue;
    warnings.push({
      kind: "no_leads",
      channel,
      text: `${AD_CHANNEL_LABEL[channel]}: ${days === null ? "7+" : days} gundur basvuru yok`,
    });
  }

  const unmapped = input.leads.filter((l) => {
    const a = attribution.get(l.id);
    return a?.channel === "meta" && a.campaign === UNMAPPED_META_CAMPAIGN && l.createdOn >= monthStart && l.createdOn <= today;
  }).length;
  if (unmapped > 0) {
    warnings.push({ kind: "meta_unmapped", channel: "meta", text: `Meta: ${unmapped} basvuru kampanyaya eslenmedi` });
  }

  return {
    currency: AD_CURRENCY,
    today,
    yesterday,
    monthStart,
    rows,
    totals,
    metaCampaigns,
    cashInMinor,
    cashMinusSpendMinor,
    capacity: capacity.capacity,
    firstResponse: firstResponseStats(input.leads, today),
    target,
    immatureDays: [yesterday, dayBefore],
    warnings: warnings.slice(0, MAX_AD_WARNINGS),
  };
}

function campaignRank(campaign: string | null): number {
  if (campaign === UNMAPPED_META_CAMPAIGN) return 2;
  return campaign === null ? 1 : 0;
}
