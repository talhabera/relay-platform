import type { AdChannel } from "@relay/db";

import { minorToTryLabel } from "./money";

/**
 * Month view of daily spend (design 6.5). A day with no row for a channel is
 * `missing` ("girilmedi") and is never counted as 0; a typed 0 is `entered`.
 * Dates are Europe/Istanbul civil dates (`YYYY-MM-DD`), so no UTC math.
 */

export type SpendRowLike = { spendDate: string; channel: AdChannel; amountMinor: number };

export type SpendCell = { state: "entered"; amountMinor: number } | { state: "missing" };

export type SpendDay = {
  date: string;
  cells: Record<AdChannel, SpendCell>;
  /** Sum of entered cells (a lower bound when `partial`). */
  enteredMinor: number;
  /** Day total, or null when any channel is missing. */
  totalMinor: number | null;
  partial: boolean;
};

export type MonthGrid = {
  month: string;
  channels: readonly AdChannel[];
  days: SpendDay[];
  /** Sum of all entered cells in the month. */
  enteredMinor: number;
  /** Days with at least one missing channel. */
  missingDays: number;
};

/** Every civil date of `YYYY-MM`, optionally stopping at `upTo` (inclusive). */
export function monthDates(month: string, upTo?: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const dates: string[] = [];
  for (let day = 1; day <= count; day += 1) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    if (upTo && date > upTo) break;
    dates.push(date);
  }
  return dates;
}

export function buildMonthGrid(
  rows: readonly SpendRowLike[],
  month: string,
  channels: readonly AdChannel[],
  upTo?: string,
): MonthGrid {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.spendDate}|${row.channel}`;
    sums.set(key, (sums.get(key) ?? 0) + row.amountMinor);
  }

  const days = monthDates(month, upTo).map((date): SpendDay => {
    const cells = {} as Record<AdChannel, SpendCell>;
    let enteredMinor = 0;
    let missing = 0;
    for (const channel of channels) {
      const amount = sums.get(`${date}|${channel}`);
      if (amount === undefined) {
        cells[channel] = { state: "missing" };
        missing += 1;
      } else {
        cells[channel] = { state: "entered", amountMinor: amount };
        enteredMinor += amount;
      }
    }
    return { date, cells, enteredMinor, totalMinor: missing > 0 ? null : enteredMinor, partial: missing > 0 };
  });

  return {
    month,
    channels,
    days,
    enteredMinor: days.reduce((sum, d) => sum + d.enteredMinor, 0),
    missingDays: days.filter((d) => d.partial).length,
  };
}

export type CapWarning =
  | { kind: "configured-over-cap"; configuredMinor: number; capMinor: number }
  | { kind: "actual-day-over-cap"; date: string; actualMinor: number; capMinor: number }
  | { kind: "month-over-cap"; monthMinor: number; limitMinor: number };

/** Monthly ceiling implied by the daily cap: cap x 30,4, in integer math. */
export function monthLimitMinor(capMinor: number): number {
  return Math.floor((capMinor * 304) / 10);
}

/**
 * Two independent warnings (design 3): the configured daily budgets above the
 * cap, and each day whose actual spend is above it. Exactly the cap is
 * allowed. A partial day's entered spend is a lower bound, so it still warns.
 * The month total is checked against cap x 30,4 when given.
 */
export function capWarnings(input: {
  configuredDailyMinor: number | null;
  days: readonly { date: string; enteredMinor: number }[];
  capMinor: number;
  monthMinor?: number;
}): CapWarning[] {
  const { configuredDailyMinor, days, capMinor, monthMinor } = input;
  const warnings: CapWarning[] = [];
  if (configuredDailyMinor !== null && configuredDailyMinor > capMinor) {
    warnings.push({ kind: "configured-over-cap", configuredMinor: configuredDailyMinor, capMinor });
  }
  for (const day of days) {
    if (day.enteredMinor > capMinor) {
      warnings.push({ kind: "actual-day-over-cap", date: day.date, actualMinor: day.enteredMinor, capMinor });
    }
  }
  if (monthMinor !== undefined) {
    const limitMinor = monthLimitMinor(capMinor);
    if (monthMinor > limitMinor) warnings.push({ kind: "month-over-cap", monthMinor, limitMinor });
  }
  return warnings;
}

/** "12.345 TL", or "12.345 TL, eksik gün var (3)" when days are missing. */
export function monthSpendLabel(grid: Pick<MonthGrid, "enteredMinor" | "missingDays">): string {
  const total = minorToTryLabel(grid.enteredMinor);
  return grid.missingDays > 0 ? `${total}, eksik gün var (${grid.missingDays})` : total;
}
