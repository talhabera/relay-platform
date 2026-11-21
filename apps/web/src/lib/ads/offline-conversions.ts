import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { AD_CURRENCY } from "@relay/db";

import type { db } from "@/db";
import { adClicks, companyRecords, leadEvents } from "@/db/schema";
import { localDayRange } from "@/lib/time";

/**
 * Google Ads offline conversion export (RELAY-169, R3 / P1 section 7).
 *
 * One row per first qualification (`Nitelikli başvuru`, value 0) and one per
 * lead that is currently won (`Satış`, contract amount VAT excluded), for leads
 * bound to a Google click. Read-only: re-running a range yields the same file
 * and Google de-duplicates on `Order ID`.
 */

/** Byte-identical to the Google Ads conversion action names (P1 section 7). */
export const CONVERSION_QUALIFIED = "Nitelikli başvuru";
export const CONVERSION_WON = "Satış";

export type ConversionName = typeof CONVERSION_QUALIFIED | typeof CONVERSION_WON;

/** Inclusive local days a single export may span. */
export const MAX_EXPORT_DAYS = 92;

const CSV_HEADER =
  "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency,Order ID";
const CRLF = "\r\n";
const CLICK_ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const DAY_MS = 86_400_000;
const CONVERSION_STATUSES = ["qualified", "won"] as const;

export type ConversionEvent = { recordId: string; toStatus: string; at: Date };
export type ConversionRecord = { id: string; status: string; saleAmountMinor: number | null };
export type ConversionClick = {
  linkedRecordId: string | null;
  channel: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
};
export type OfflineConversionRow = {
  clickId: string;
  name: ConversionName;
  at: Date;
  valueMinor: number;
  orderId: string;
};
/** Conversions in the range left out of the file, one count per conversion row. */
export type OfflineConversionSkips = {
  noGoogleClick: number;
  invalidClickId: number;
  wbraidOnly: number;
};
export type OfflineConversions = { rows: OfflineConversionRow[]; skipped: OfflineConversionSkips };

// --- formatting ------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function civilParts(at: Date, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) parts[part.type] = part.value;
  return parts;
}

/** `yyyy-MM-dd HH:mm:ss` in `timeZone`, no offset (the zone is on the Parameters line). */
export function formatConversionTime(at: Date, timeZone: string): string {
  const p = civilParts(at, timeZone);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** Integer kuruş to `1234.56`: decimal point, no thousands separator. */
export function formatMinorAsLira(minor: number): string {
  if (!Number.isSafeInteger(minor)) {
    throw new Error("Money must be an integer amount of minor units");
  }
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A click id is a stranger-controlled value: only Google's id alphabet reaches a cell. */
export function isExportableClickId(value: string): boolean {
  return CLICK_ID_RE.test(value);
}

export type PickedClickId =
  | { kind: "gclid" | "gbraid"; value: string }
  | { kind: "wbraid_only" };

/** gclid first, else gbraid. wbraid is not exported (R3: upload rules unconfirmed). */
export function pickClickId(click: {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
}): PickedClickId | null {
  if (click.gclid) return { kind: "gclid", value: click.gclid };
  if (click.gbraid) return { kind: "gbraid", value: click.gbraid };
  if (click.wbraid) return { kind: "wbraid_only" };
  return null;
}

/** The Google Ads upload file: Parameters line, English header, CRLF, no BOM. */
export function buildOfflineConversionsCsv({
  timeZone,
  rows,
}: {
  timeZone: string;
  rows: OfflineConversionRow[];
}): string {
  const sorted = [...rows].sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  const lines = [`Parameters:TimeZone=${timeZone}`, CSV_HEADER];
  for (const row of sorted) {
    if (!isExportableClickId(row.clickId)) {
      throw new Error("Refusing to write an invalid click id");
    }
    lines.push(
      [
        row.clickId,
        row.name,
        formatConversionTime(row.at, timeZone),
        formatMinorAsLira(row.valueMinor),
        AD_CURRENCY,
        row.orderId,
      ].join(","),
    );
  }
  return lines.join(CRLF) + CRLF;
}

// --- reducers --------------------------------------------------------------

/** First `qualified` event per record: the billing definition of qualification time. */
export function firstQualifiedAt(events: ConversionEvent[]): Map<string, Date> {
  const first = new Map<string, Date>();
  for (const event of events) {
    if (event.toStatus !== "qualified") continue;
    const seen = first.get(event.recordId);
    if (!seen || event.at < seen) first.set(event.recordId, event.at);
  }
  return first;
}

/** Latest `won` event per record. */
export function latestWonAt(events: ConversionEvent[]): Map<string, Date> {
  const latest = new Map<string, Date>();
  for (const event of events) {
    if (event.toStatus !== "won") continue;
    const seen = latest.get(event.recordId);
    if (!seen || event.at > seen) latest.set(event.recordId, event.at);
  }
  return latest;
}

/** Conversions whose moment lies in `[from, to)` and whose lead carries an exportable Google click id. */
export function selectConversions({
  records,
  events,
  clicks,
  from,
  to,
}: {
  records: ConversionRecord[];
  events: ConversionEvent[];
  clicks: ConversionClick[];
  from: Date;
  to: Date;
}): OfflineConversions {
  const inRange = (at: Date | undefined): at is Date => !!at && at >= from && at < to;
  const qualifiedAt = firstQualifiedAt(events);
  const wonAt = latestWonAt(events);
  const clickByRecord = new Map<string, ConversionClick>();
  for (const click of clicks) {
    if (click.channel === "google" && click.linkedRecordId) {
      clickByRecord.set(click.linkedRecordId, click);
    }
  }

  const rows: OfflineConversionRow[] = [];
  const skipped: OfflineConversionSkips = { noGoogleClick: 0, invalidClickId: 0, wbraidOnly: 0 };

  for (const record of records) {
    const candidates: Omit<OfflineConversionRow, "clickId">[] = [];
    const q = qualifiedAt.get(record.id);
    if (inRange(q)) {
      candidates.push({ name: CONVERSION_QUALIFIED, at: q, valueMinor: 0, orderId: `${record.id}:qualified` });
    }
    const w = wonAt.get(record.id);
    // company_records_won_sale_chk guarantees a positive amount on a won record.
    if (record.status === "won" && inRange(w) && record.saleAmountMinor && record.saleAmountMinor > 0) {
      candidates.push({ name: CONVERSION_WON, at: w, valueMinor: record.saleAmountMinor, orderId: `${record.id}:won` });
    }
    if (candidates.length === 0) continue;

    const click = clickByRecord.get(record.id);
    const picked = click ? pickClickId(click) : null;
    for (const candidate of candidates) {
      if (!picked) skipped.noGoogleClick += 1;
      else if (picked.kind === "wbraid_only") skipped.wbraidOnly += 1;
      else if (!isExportableClickId(picked.value)) skipped.invalidClickId += 1;
      else rows.push({ ...candidate, clickId: picked.value });
    }
  }
  return { rows, skipped };
}

// --- date range ------------------------------------------------------------

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((day) => {
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  });

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

function addDays(day: string, n: number): string {
  return new Date((dayNumber(day) + n) * DAY_MS).toISOString().slice(0, 10);
}

function localDay(at: Date, timeZone: string): string {
  const p = civilParts(at, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `[local 00:00, next local 00:00)` of a calendar day in `timeZone`. */
function localDayBounds(day: string, timeZone: string) {
  // Noon UTC is that calendar day in most zones; shift by the day difference otherwise.
  let guess = dayNumber(day) * DAY_MS + DAY_MS / 2;
  guess -= (dayNumber(localDay(new Date(guess), timeZone)) - dayNumber(day)) * DAY_MS;
  return localDayRange(new Date(guess), timeZone);
}

/** The last 7 local days ending yesterday (the weekly upload). */
export function defaultExportDays(timeZone: string, now: Date = new Date()) {
  const today = localDay(now, timeZone);
  return { fromDay: addDays(today, -7), toDay: addDays(today, -1) };
}

export type ExportRange =
  | { ok: true; fromDay: string; toDay: string; from: Date; to: Date }
  | { ok: false; error: string };

/** Inclusive `from`/`to` local days from the query, or the default week; at most 92 days. */
export function resolveExportRange({
  from,
  to,
  timeZone,
  now,
}: {
  from: string | null;
  to: string | null;
  timeZone: string;
  now: Date;
}): ExportRange {
  let fromDay: string;
  let toDay: string;
  if (from === null && to === null) {
    ({ fromDay, toDay } = defaultExportDays(timeZone, now));
  } else {
    const parsedFrom = daySchema.safeParse(from);
    const parsedTo = daySchema.safeParse(to);
    if (!parsedFrom.success || !parsedTo.success) return { ok: false, error: "invalid_date" };
    fromDay = parsedFrom.data;
    toDay = parsedTo.data;
  }
  const days = dayNumber(toDay) - dayNumber(fromDay) + 1;
  if (days < 1) return { ok: false, error: "reversed_range" };
  if (days > MAX_EXPORT_DAYS) return { ok: false, error: "range_too_long" };
  return {
    ok: true,
    fromDay,
    toDay,
    from: localDayBounds(fromDay, timeZone).from,
    to: localDayBounds(toDay, timeZone).to,
  };
}

// --- query -----------------------------------------------------------------

export type OfflineConversionsExecutor = Pick<typeof db, "select">;

/**
 * Read-only. Candidates are records of the company with a qualified or won
 * event in `[from, to)` (bounded by `lead_events_company_id_at_idx`); for them
 * every qualified/won event is loaded without the range, so a re-qualification
 * is never mistaken for the first one. The reduction happens in `selectConversions`.
 */
export async function loadOfflineConversions(
  executor: OfflineConversionsExecutor,
  { companyId, from, to }: { companyId: string; from: Date; to: Date },
): Promise<OfflineConversions> {
  const candidateIds = () =>
    executor
      .select({ id: leadEvents.recordId })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.companyId, companyId),
          inArray(leadEvents.toStatus, CONVERSION_STATUSES),
          gte(leadEvents.at, from),
          lt(leadEvents.at, to),
        ),
      );

  const [events, records, clicks] = await Promise.all([
    executor
      .select({ recordId: leadEvents.recordId, toStatus: leadEvents.toStatus, at: leadEvents.at })
      .from(leadEvents)
      .where(
        and(
          eq(leadEvents.companyId, companyId),
          inArray(leadEvents.toStatus, CONVERSION_STATUSES),
          inArray(leadEvents.recordId, candidateIds()),
        ),
      ),
    executor
      .select({
        id: companyRecords.id,
        status: companyRecords.status,
        saleAmountMinor: companyRecords.saleAmountMinor,
      })
      .from(companyRecords)
      .where(and(eq(companyRecords.companyId, companyId), inArray(companyRecords.id, candidateIds()))),
    executor
      .select({
        linkedRecordId: adClicks.linkedRecordId,
        channel: adClicks.channel,
        gclid: adClicks.gclid,
        gbraid: adClicks.gbraid,
        wbraid: adClicks.wbraid,
      })
      .from(adClicks)
      .where(
        and(
          eq(adClicks.companyId, companyId),
          eq(adClicks.channel, "google"),
          inArray(adClicks.linkedRecordId, candidateIds()),
        ),
      ),
  ]);

  return selectConversions({ records, events, clicks, from, to });
}
