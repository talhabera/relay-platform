/**
 * Client Live (S72, Figma 11b `500:69276`) view model. Pure, so the server page
 * and the client feed share one set of rules. Data comes from the S90 backend
 * (`lib/live/summary`, `lib/live/feed`); cards without a source yet (site
 * visits, median first reply, resolved without staff, live-now chip and the
 * Live now list) are not rendered.
 */
import type { PortalEvent, PortalEventType } from "@/lib/fixtures/interfaces";
import type { HourlySeries, SourceCount } from "@/lib/live/hourly";
import {
  formatClock,
  SOURCE_BRAND,
  SOURCE_LABEL,
  toInboxSource,
  type InboxSource,
} from "@/components/messaging/inbox-model";
import type { LiveEventKind } from "@/components/v2/client";
import type { BrandName } from "@/components/v2/primitives/brand-glyph";

export const LIVE_PATH = "/client/live";
export const LIVE_PREVIEW_PATH = "/client/live/preview";
/** Where Exit preview returns the owner / member. */
export const PREVIEW_EXIT_HREF = "/home";

// ---------------------------------------------------------------------------
// Search params: `?event=<portal event id>` or `?chat=<chat id>` opens the sheet.
// ---------------------------------------------------------------------------

export type LiveSearch = { event: string | null; chat: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseLiveSearch(params: Record<string, string | string[] | undefined>): LiveSearch {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const uuid = (v: string | undefined) => (v && UUID.test(v) ? v : null);
  return { event: uuid(one(params.event)), chat: uuid(one(params.chat)) };
}

export function liveHref(base: string, open?: { event?: string; chat?: string }): string {
  if (open?.event) return `${base}?event=${encodeURIComponent(open.event)}`;
  if (open?.chat) return `${base}?chat=${encodeURIComponent(open.chat)}`;
  return base;
}

export function inboxHref(chatId: string): string {
  return `/messaging?chatId=${encodeURIComponent(chatId)}`;
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

/** A feed row as it crosses to the client (dates as ISO strings). */
export type FeedEvent = Omit<PortalEvent, "at"> & { at: string };

export function toFeedEvent(event: PortalEvent | FeedEvent): FeedEvent {
  return { ...event, at: event.at instanceof Date ? event.at.toISOString() : event.at };
}

export const FEED_MAX_ROWS = 50;

/** Union by id, newest first (ties by id, as the API orders them), capped. */
export function mergeFeed(...lists: readonly (readonly FeedEvent[])[]): FeedEvent[] {
  const byId = new Map<string, FeedEvent>();
  for (const list of lists) for (const e of list) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()]
    .sort((a, b) => {
      const diff = Date.parse(b.at) - Date.parse(a.at);
      return diff !== 0 ? diff : b.id.localeCompare(a.id);
    })
    .slice(0, FEED_MAX_ROWS);
}

const KIND: Record<PortalEventType, LiveEventKind> = {
  lead_inbound_qualified: "lead",
  lead_delivered: "lead",
  handoff_sent: "handoff",
  conversation_started: "conversation",
  site_visit_booked: "booking",
  review_new: "review",
};

const CHANNEL_BRAND: Record<string, BrandName> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  widget: "website",
  shopify: "shopify",
  outbound: "email",
};

/** Feed rows that lead to a conversation the sheet can show. */
const OPENABLE: ReadonlySet<PortalEventType> = new Set([
  "handoff_sent",
  "lead_inbound_qualified",
  "lead_delivered",
  "conversation_started",
]);

export type FeedRowView = {
  id: string;
  kind: LiveEventKind;
  time: string;
  text: string;
  detail: string | undefined;
  source: BrandName | null;
  openable: boolean;
};

export function feedRow(event: FeedEvent, timeZone: string): FeedRowView {
  const text =
    event.type === "lead_inbound_qualified" ? `Inbound lead qualified: ${event.title}` : event.title;
  return {
    id: event.id,
    kind: KIND[event.type] ?? "conversation",
    time: formatClock(new Date(event.at), timeZone),
    text,
    detail: event.detail.trim() || undefined,
    source: event.channel ? (CHANNEL_BRAND[event.channel] ?? null) : null,
    openable: OPENABLE.has(event.type),
  };
}

// ---------------------------------------------------------------------------
// Title row, today metrics, charts
// ---------------------------------------------------------------------------

function zoneName(at: Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone
  );
}

/** "Fri 25 Sep 2026 · 11:52 CET". */
export function formatLiveStamp(at: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(at)
    .replace(",", "");
  return `${day} · ${formatClock(at, timeZone)} ${zoneName(at, timeZone)}`;
}

/** "21–27 Sep" or "29 Sep – 5 Oct" for the Goal strip (range end is exclusive). */
export function formatWeekLabel(range: { from: Date; to: Date }, timeZone: string): string {
  const last = new Date(range.to.getTime() - 1);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-GB", { timeZone, ...o }).format(d);
  const sameMonth = fmt(range.from, { month: "short" }) === fmt(last, { month: "short" });
  return sameMonth
    ? `${fmt(range.from, { day: "numeric" })}–${fmt(last, { day: "numeric", month: "short" })}`
    : `${fmt(range.from, { day: "numeric", month: "short" })} – ${fmt(last, { day: "numeric", month: "short" })}`;
}

export function formatWaited(since: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export type HourBarView = { label: string; value: number; pct: number; busiest: boolean };

export type HourlyView = {
  bars: HourBarView[];
  /** "14 conversations so far · busiest hour 11:00". */
  summary: string;
  /** "Today · 00–12 CET". */
  range: string;
};

export function hourlyView(series: HourlySeries, generatedAt: Date, timeZone: string): HourlyView {
  const max = Math.max(0, ...series.points.map((p) => p.value));
  const bars = series.points.map((p) => ({
    label: String(p.hour).padStart(2, "0"),
    value: p.value,
    pct: max > 0 ? Math.round((p.value / max) * 100) : 0,
    busiest: series.busiestHour === p.hour && p.value > 0,
  }));
  const noun = series.total === 1 ? "conversation" : "conversations";
  const busiest =
    series.busiestHour === null ? "" : ` · busiest hour ${String(series.busiestHour).padStart(2, "0")}:00`;
  const end = String(series.points.length).padStart(2, "0");
  return {
    bars,
    summary: `${series.total} ${noun} so far${busiest}`,
    range: `Today · 00–${end} ${zoneName(generatedAt, timeZone)}`,
  };
}

export type SourceRowView = { source: InboxSource; label: string; brand: BrandName; value: number; pct: number };

/** Chat channels folded into the Inbox sources (`web` is the legacy widget). */
export function sourcesView(sources: readonly SourceCount[]): SourceRowView[] {
  const totals = new Map<InboxSource, number>();
  for (const s of sources) {
    const key = toInboxSource(s.channel);
    totals.set(key, (totals.get(key) ?? 0) + s.value);
  }
  const max = Math.max(0, ...totals.values());
  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([source, value]) => ({
      source,
      label: SOURCE_LABEL[source],
      brand: SOURCE_BRAND[source],
      value,
      pct: max > 0 ? Math.round((value / max) * 100) : 0,
    }));
}
