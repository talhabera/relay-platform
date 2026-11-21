import { AD_CHANNELS, AD_CURRENCY, type AdChannel } from "./ad-click";
import { DAILY_BRIEF_MAX_ITEMS } from "./schema/daily-briefs";

/**
 * Pure ad-monitor rules (RL7). The morning ad brief reads the state built
 * here; the model only writes words onto it. Days are company-local
 * (Europe/Istanbul) `YYYY-MM-DD` labels and every date step is label math in
 * UTC, never a local-time `Date` call. Money is integer minor units (kuruş).
 * Thresholds come from company settings; a null setting means "no rule".
 * Nothing here acts: a stop result is a proposal handed to RL8.
 */

/** Today and the `IMMATURE_DAYS` days before it are still settling. */
export const IMMATURE_DAYS = 2;
/** The stop rule judges a channel from its 14th day on. */
export const STOP_RULE_DAY = 14;
/** Fewer leads than this in the window marks a stop proposal as low data. */
export const LOW_DATA_LEADS = 5;
/** A live channel this many days without a lead gets a `no_leads` alert. */
export const NO_LEAD_WARNING_DAYS = 7;
/** A refreshed day total below this share of the stored total is suspicious. */
export const SUSPICIOUS_DROP_RATIO = 0.7;
export const MAX_AD_BRIEF_ITEMS = DAILY_BRIEF_MAX_ITEMS;
/** Mature days the completeness and liveness checks look back over. */
export const RECENT_MATURE_DAYS = 7;

const DAY_MS = 86_400_000;

function labelUtc(label: string): number {
  const [y, m, d] = label.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDaysLabel(label: string, days: number): string {
  return new Date(labelUtc(label) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (`to` later is positive). */
export function daysBetween(from: string, to: string): number {
  return Math.round((labelUtc(to) - labelUtc(from)) / DAY_MS);
}

/** Inclusive list of day labels; empty when `from` is after `to`. */
export function dayLabels(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysLabel(d, 1)) out.push(d);
  return out;
}

/** The last mature day: `today` minus `IMMATURE_DAYS + 1`. */
export function matureThrough(today: string): string {
  return addDaysLabel(today, -(IMMATURE_DAYS + 1));
}

export function isMature(date: string, today: string): boolean {
  return date <= matureThrough(today);
}

/** Minor units in, whole TL out with the Turkish thousands dot: `1.234 TL`. */
export function formatTryMinor(minor: number | null): string {
  if (minor === null) return "-";
  const whole = Math.round(minor / 100);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${whole < 0 ? "-" : ""}${digits} TL`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AdMonitorSettings = {
  cplStopMinor: number | null;
  monthlyTargetMinor: number | null;
  dailyCapMinor: number | null;
};

/** One spend row (a campaign or a channel total) for one local day. */
export type AdSpendDayRow = { date: string; amountMinor: number; complete: boolean };

export type AdChannelInput = {
  channel: AdChannel;
  spend: readonly AdSpendDayRow[];
  /** Leads attributed to this channel per local creation day. */
  leadsByDay: Readonly<Record<string, number>>;
  /** Local day of the channel's latest lead, if any is known. */
  lastLeadDate: string | null;
};

export type AdMonitorInput = {
  today: string;
  settings: AdMonitorSettings;
  channels: readonly AdChannelInput[];
};

export type AdAlert =
  | { kind: "missing_spend"; channel: AdChannel; dates: string[] }
  | { kind: "data_incomplete"; channel: AdChannel; dates: string[] }
  | {
      kind: "no_leads";
      channel: AdChannel;
      days: number;
      lastLeadDate: string | null;
      thresholdDays: number;
    }
  | { kind: "immature_note"; channel: null; dates: string[]; matureThrough: string };

export type AdActionProposal = {
  /** Stable per kind and channel, e.g. `pause_channel:google`. */
  key: string;
  kind: "pause_channel";
  channel: AdChannel;
  reason: {
    metric: "cpl" | "leads";
    /** CPL in minor units for `cpl`; null for `leads` (no lead, no CPL). */
    value: number | null;
    thresholdMinor: number;
    windowDays: number;
    leads: number;
    spendMinor: number;
  };
  lowData: boolean;
  lastLiveChannel: boolean;
};

export type AdStopStatus = "not_set" | "not_started" | "too_early" | "no_spend" | "within" | "exceeded";

export type AdChannelState = {
  channel: AdChannel;
  /** First local day with positive spend: day 1 of the channel. */
  firstSpendDate: string | null;
  dayNumber: number | null;
  /** Positive spend on a mature complete day in the last 7 mature days. */
  live: boolean;
  /** The stop-rule window: mature complete days from day 1 on. */
  window: {
    from: string;
    to: string;
    days: number;
    spendMinor: number;
    leads: number;
    cplMinor: number | null;
  } | null;
  stop: AdStopStatus;
};

export type AdState = {
  todayLocal: string;
  matureThrough: string;
  immatureDays: string[];
  channels: AdChannelState[];
  alerts: AdAlert[];
  proposals: AdActionProposal[];
  completeness: { complete: boolean; missingDays: number; incompleteDays: number };
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type DayCell = { minor: number; complete: boolean };

/** Sums campaign rows per day; a day is complete only if every row is. */
function spendByDay(rows: readonly AdSpendDayRow[]): Map<string, DayCell> {
  const out = new Map<string, DayCell>();
  for (const row of rows) {
    const cur = out.get(row.date) ?? { minor: 0, complete: true };
    out.set(row.date, { minor: cur.minor + row.amountMinor, complete: cur.complete && row.complete });
  }
  return out;
}

function firstSpendDate(days: Map<string, DayCell>): string | null {
  let first: string | null = null;
  days.forEach((cell, date) => {
    if (cell.minor > 0 && (first === null || date < first)) first = date;
  });
  return first;
}

function recentMatureDays(today: string): string[] {
  const to = matureThrough(today);
  return dayLabels(addDaysLabel(to, -(RECENT_MATURE_DAYS - 1)), to);
}

/** Channels with positive spend on a mature complete day in the last 7 mature days. */
export function liveChannels(input: Pick<AdMonitorInput, "today" | "channels">): AdChannel[] {
  const recent = recentMatureDays(input.today);
  return input.channels
    .filter((c) => {
      const days = spendByDay(c.spend);
      return recent.some((d) => {
        const cell = days.get(d);
        return cell !== undefined && cell.complete && cell.minor > 0;
      });
    })
    .map((c) => c.channel);
}

function channelOrder(channel: AdChannel): number {
  return AD_CHANNELS.indexOf(channel);
}

export function evaluateAdState(input: AdMonitorInput): AdState {
  const { today, settings } = input;
  const mature = matureThrough(today);
  const recent = recentMatureDays(today);
  const live = new Set(liveChannels(input));
  const channels = [...input.channels].sort((a, b) => channelOrder(a.channel) - channelOrder(b.channel));

  const states: AdChannelState[] = [];
  const gapAlerts: AdAlert[] = [];
  const leadAlerts: AdAlert[] = [];
  const proposals: AdActionProposal[] = [];
  let missingDays = 0;
  let incompleteDays = 0;

  for (const c of channels) {
    const days = spendByDay(c.spend);
    const first = firstSpendDate(days);
    const isLive = live.has(c.channel);

    if (first === null) {
      states.push({ channel: c.channel, firstSpendDate: null, dayNumber: null, live: false, window: null, stop: "not_started" });
      continue;
    }

    // Data gaps over the last 7 mature days since the channel started.
    const missing = recent.filter((d) => d >= first && !days.has(d));
    const incomplete = recent.filter((d) => d >= first && days.get(d)?.complete === false);
    missingDays += missing.length;
    incompleteDays += incomplete.length;
    if (missing.length > 0) gapAlerts.push({ kind: "missing_spend", channel: c.channel, dates: missing });
    if (incomplete.length > 0) gapAlerts.push({ kind: "data_incomplete", channel: c.channel, dates: incomplete });

    // No leads for too long on a channel that is still spending.
    if (isLive) {
      const since = c.lastLeadDate ?? first;
      const quietDays = daysBetween(since, today);
      if (quietDays >= NO_LEAD_WARNING_DAYS) {
        leadAlerts.push({
          kind: "no_leads",
          channel: c.channel,
          days: quietDays,
          lastLeadDate: c.lastLeadDate,
          thresholdDays: NO_LEAD_WARNING_DAYS,
        });
      }
    }

    // Stop-rule window: mature days from day 1 that have a complete row.
    const included = dayLabels(first, mature).filter((d) => days.get(d)?.complete === true);
    const spendMinor = included.reduce((sum, d) => sum + (days.get(d)?.minor ?? 0), 0);
    const leads = included.reduce((sum, d) => sum + (c.leadsByDay[d] ?? 0), 0);
    const window = {
      from: first,
      to: mature,
      days: included.length,
      spendMinor,
      leads,
      cplMinor: leads > 0 ? Math.round(spendMinor / leads) : null,
    };
    const dayNumber = daysBetween(first, today) + 1;
    const threshold = settings.cplStopMinor;

    let stop: AdStopStatus;
    if (threshold === null) stop = "not_set";
    else if (dayNumber < STOP_RULE_DAY) stop = "too_early";
    else if (spendMinor <= 0) stop = "no_spend";
    else if (leads === 0 || (window.cplMinor as number) > threshold) stop = "exceeded";
    else stop = "within";

    if (stop === "exceeded" && threshold !== null) {
      proposals.push({
        key: `pause_channel:${c.channel}`,
        kind: "pause_channel",
        channel: c.channel,
        reason: {
          metric: leads === 0 ? "leads" : "cpl",
          value: window.cplMinor,
          thresholdMinor: threshold,
          windowDays: window.days,
          leads,
          spendMinor,
        },
        lowData: leads < LOW_DATA_LEADS,
        lastLiveChannel: Array.from(live).every((other) => other === c.channel),
      });
    }

    states.push({ channel: c.channel, firstSpendDate: first, dayNumber, live: isLive, window, stop });
  }

  const immatureDays = dayLabels(addDaysLabel(mature, 1), today);
  const alerts: AdAlert[] = [...gapAlerts, ...leadAlerts];
  if (states.some((s) => s.firstSpendDate !== null)) {
    alerts.push({ kind: "immature_note", channel: null, dates: immatureDays, matureThrough: mature });
  }

  return {
    todayLocal: today,
    matureThrough: mature,
    immatureDays,
    channels: states,
    alerts,
    proposals,
    completeness: { complete: missingDays === 0 && incompleteDays === 0, missingDays, incompleteDays },
  };
}

// ---------------------------------------------------------------------------
// Spend batch guard (RL9 calls this before it stores fetched spend)
// ---------------------------------------------------------------------------

export type SpendBatchRow = { date: string; channel: AdChannel; campaignId: string; amountMinor: number };

export type SpendBatch = {
  currency: string;
  paginationComplete: boolean;
  /** Row count the caller expects, inclusive bounds. */
  expectedRows: { min: number; max: number };
  rows: readonly SpendBatchRow[];
};

/** What is already stored, per row; summed per channel and day. */
export type StoredSpendRow = { date: string; channel: AdChannel; amountMinor: number };

export type SpendBatchRefusal = "pagination" | "currency" | "row_count" | "drop";

export type SpendBatchCheck = { ok: true } | { ok: false; reason: SpendBatchRefusal; message: string };

const REFUSAL_MESSAGE: Record<SpendBatchRefusal, string> = {
  pagination: "The platform did not return every page; the batch is incomplete.",
  currency: `The batch is not in ${AD_CURRENCY}.`,
  row_count: "The batch row count is outside the expected range.",
  drop: "A day total fell well below the stored total for the same channel and day.",
};

function refuse(reason: SpendBatchRefusal): SpendBatchCheck {
  return { ok: false, reason, message: REFUSAL_MESSAGE[reason] };
}

function totalsByKey(rows: readonly { date: string; channel: AdChannel; amountMinor: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.channel}|${row.date}`;
    out.set(key, (out.get(key) ?? 0) + row.amountMinor);
  }
  return out;
}

/**
 * Refuses a fetched spend batch before it is stored: missing pages, a foreign
 * currency, an unexpected row count, or a channel-day total that dropped
 * below `SUSPICIOUS_DROP_RATIO` of the stored total (a stored 0 never counts).
 * Messages are fixed text and carry no row values.
 */
export function checkSpendBatch(batch: SpendBatch, stored: readonly StoredSpendRow[]): SpendBatchCheck {
  if (!batch.paginationComplete) return refuse("pagination");
  if (batch.currency !== AD_CURRENCY) return refuse("currency");
  const count = batch.rows.length;
  if (count < batch.expectedRows.min || count > batch.expectedRows.max) return refuse("row_count");
  const before = totalsByKey(stored);
  const dropped = Array.from(totalsByKey(batch.rows)).some(([key, total]) => {
    const old = before.get(key) ?? 0;
    return old > 0 && total < old * SUSPICIOUS_DROP_RATIO;
  });
  return dropped ? refuse("drop") : { ok: true };
}
