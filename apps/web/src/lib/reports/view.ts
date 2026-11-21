import type {
  MetricKey,
  ReportPeriod,
  ReportSnapshot,
} from "@/lib/fixtures/interfaces";

// View model of one closed report (S70, Figma 11a `451:61553`). Pure: the
// page renders exactly what this returns. A card whose metric is absent from
// the snapshot has no data source yet and is left out, never shown empty
// (report snapshot spec, decision 5). `previous` is rendered only where Figma
// shows it: the monthly delivered card, "Up from 23 in July" (decision 6, S71).

export type ReportStatCard = { metricKey: MetricKey; label: string; value: string; caption?: string };

export type ReportFunnelStage = { label: string; value: number };

export type ReportView = {
  period: ReportPeriod;
  /** Report header range, e.g. "Thu 24 Sep 2026", "14–20 Sep 2026", "August 2026". */
  rangeLabel: string;
  /** Short range for card titles, e.g. "14–20 Sep". */
  shortRangeLabel: string;
  /** Daily and monthly: the headline row. Empty on weekly. */
  headline: ReportStatCard[];
  /** Weekly / monthly goal row: delivered and lead quality, when sourced. */
  delivered: { value: string; title: string; comparison: string | null } | null;
  quality: { value: string } | null;
  /** Lead engine funnel (weekly / monthly), Gathered > ... > Delivered. */
  funnel: { stages: ReportFunnelStage[]; delivered: number; gathered: number } | null;
  /** Delivered per day (weekly) or per week (monthly). */
  deliveredSeries: { title: string; total: number; points: { label: string; value: number }[] } | null;
  /** Weekly / monthly "Also this week|month" rows. */
  also: { title: string; rows: ReportStatCard[] } | null;
  summary: string | null;
  highlights: string[];
  /** Nothing in the snapshot has a source: show the empty note. */
  empty: boolean;
};

export const REPORT_METRIC_LABELS: Partial<Record<MetricKey, string>> = {
  "conversations.started": "Conversations",
  "leads.inbound": "Inbound leads",
  "leads.qualified_delivered": "Qualified leads delivered",
  "handoff.staff_answers": "Staff answers",
  "leads.quality_score": "Lead quality score",
};

/** Daily headline cards in Figma order (Site visits joins once sourced). */
const DAILY_HEADLINE: MetricKey[] = [
  "conversations.started",
  "leads.inbound",
  "leads.qualified_delivered",
  "handoff.staff_answers",
];

/** "Also this week" rows that have a source today. */
const ALSO_ROWS: MetricKey[] = [
  "conversations.started",
  "leads.inbound",
  "handoff.staff_answers",
];

/** Monthly headline row in Figma order (Cost per qualified lead joins once sourced). */
const MONTHLY_HEADLINE: MetricKey[] = [
  "leads.qualified_delivered",
  "leads.quality_score",
  "conversations.started",
];

/** "Also this month": Conversations moved up into the headline row. */
const MONTHLY_ALSO_ROWS: MetricKey[] = ["leads.inbound", "handoff.staff_answers"];

const QUALITY_CAPTION = "Average fit score of qualified leads";

/** "Up from 23 in July" (monthly only); null when the previous month is unknown. */
export function previousPeriodCopy(value: number, previous: number | null, previousLabel: string): string | null {
  if (previous === null) return null;
  if (value > previous) return `Up from ${number.format(previous)} in ${previousLabel}`;
  if (value < previous) return `Down from ${number.format(previous)} in ${previousLabel}`;
  return `Same as ${previousLabel}`;
}

const FUNNEL_LABELS = {
  gathered: "Gathered",
  qualified: "Qualified",
  contacted: "Contacted",
  delivered: "Delivered",
} as const;

const number = new Intl.NumberFormat("en-GB");

type Civil = { y: number; m: number; d: number; weekday: string; month: string; monthLong: string };

function civil(at: Date, timeZone: string): Civil {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    weekday: "short",
  }).formatToParts(at);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const monthLong = new Intl.DateTimeFormat("en-US", { timeZone, month: "long" }).format(at);
  const numeric = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const [y, m, d] = numeric.split("-").map(Number);
  return { y, m, d, weekday: read("weekday"), month: read("month"), monthLong };
}

function spanLabel(first: Civil, last: Civil, withYear: boolean): string {
  const year = withYear ? ` ${last.y}` : "";
  if (first.y === last.y && first.m === last.m) return `${first.d}–${last.d} ${last.month}${year}`;
  if (first.y === last.y) return `${first.d} ${first.month} – ${last.d} ${last.month}${year}`;
  return `${first.d} ${first.month} ${first.y} – ${last.d} ${last.month} ${last.y}`;
}

/** Header and card labels of a half-open `[start, end)` period in company time. */
export function reportRangeLabels(
  period: ReportPeriod,
  start: Date,
  end: Date,
  timeZone: string,
): { rangeLabel: string; shortRangeLabel: string } {
  const first = civil(start, timeZone);
  if (period === "daily") {
    return {
      rangeLabel: `${first.weekday} ${first.d} ${first.month} ${first.y}`,
      shortRangeLabel: `${first.weekday} ${first.d} ${first.month}`,
    };
  }
  if (period === "monthly") {
    return { rangeLabel: `${first.monthLong} ${first.y}`, shortRangeLabel: first.monthLong };
  }
  const last = civil(new Date(end.getTime() - 1), timeZone);
  return { rangeLabel: spanLabel(first, last, true), shortRangeLabel: spanLabel(first, last, false) };
}

/** The portal URL of a report: `?period=` and, for a given snapshot, `&id=`. */
export function reportsHref(period: ReportPeriod, id?: string | null): string {
  const query = new URLSearchParams({ period });
  if (id) query.set("id", id);
  return `/client/reports?${query.toString()}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Series labels as stored (`2026-09-14`, `2026-W38`) to chart ticks (`Mon`, `W38`). */
export function seriesTickLabel(label: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label);
  if (day) {
    return WEEKDAYS[new Date(Date.UTC(+day[1], +day[2] - 1, +day[3])).getUTCDay()];
  }
  const week = /^\d{4}-(W\d{2})$/.exec(label);
  return week ? week[1] : label;
}

export function buildReportView(snapshot: ReportSnapshot, timeZone: string): ReportView {
  const { period } = snapshot;
  const values = new Map(snapshot.metrics.map((m) => [m.metricKey, m.value]));
  const previous = new Map(snapshot.metrics.map((m) => [m.metricKey, m.previous]));
  const card = (metricKey: MetricKey): ReportStatCard | null => {
    const value = values.get(metricKey);
    const label = REPORT_METRIC_LABELS[metricKey];
    if (value === undefined || !label) return null;
    return { metricKey, label, value: number.format(value) };
  };
  const cards = (keys: MetricKey[]) =>
    keys.map(card).filter((c): c is ReportStatCard => c !== null);

  const labels = reportRangeLabels(period, snapshot.start, snapshot.end, timeZone);
  const narrative = snapshot.narrative;
  const summary = narrative?.summary.trim() ? narrative.summary.trim() : null;
  const highlights = narrative?.highlights.filter((h) => h.trim()) ?? [];

  if (period === "daily") {
    const headline = cards(DAILY_HEADLINE);
    return {
      period,
      ...labels,
      headline,
      delivered: null,
      quality: null,
      funnel: null,
      deliveredSeries: null,
      also: null,
      summary,
      highlights,
      empty: headline.length === 0 && !summary && highlights.length === 0,
    };
  }

  const deliveredValue = values.get("leads.qualified_delivered");
  const qualityValue = values.get("leads.quality_score");
  const funnelSteps = snapshot.series.funnel;
  const stageValue = (stage: keyof typeof FUNNEL_LABELS) =>
    funnelSteps.find((s) => s.stage === stage)?.value ?? 0;
  const funnel =
    funnelSteps.length > 0
      ? {
          stages: funnelSteps.map((s) => ({ label: FUNNEL_LABELS[s.stage], value: s.value })),
          gathered: stageValue("gathered"),
          delivered: stageValue("delivered"),
        }
      : null;
  const points = snapshot.series.delivered.map((p) => ({
    label: seriesTickLabel(p.label),
    value: p.value,
  }));
  const deliveredSeries =
    points.length > 0
      ? {
          title: period === "weekly" ? "Delivered per day" : "Delivered per week",
          total: points.reduce((sum, p) => sum + p.value, 0),
          points,
        }
      : null;
  const alsoRows = cards(period === "monthly" ? MONTHLY_ALSO_ROWS : ALSO_ROWS);
  const also =
    alsoRows.length > 0
      ? { title: period === "weekly" ? "Also this week" : "Also this month", rows: alsoRows }
      : null;
  const comparison =
    period === "monthly" && deliveredValue !== undefined
      ? previousPeriodCopy(
          deliveredValue,
          previous.get("leads.qualified_delivered") ?? null,
          civil(new Date(snapshot.start.getTime() - 1), timeZone).monthLong,
        )
      : null;
  const delivered =
    deliveredValue === undefined
      ? null
      : {
          value: number.format(deliveredValue),
          title: `Qualified leads delivered · ${labels.shortRangeLabel}`,
          comparison,
        };
  const quality = qualityValue === undefined ? null : { value: number.format(qualityValue) };
  const captions: Partial<Record<MetricKey, string | null>> = {
    "leads.qualified_delivered": comparison,
    "leads.quality_score": QUALITY_CAPTION,
  };
  const headline =
    period === "monthly"
      ? cards(MONTHLY_HEADLINE).map((c) => {
          const caption = captions[c.metricKey];
          return caption ? { ...c, caption } : c;
        })
      : [];

  return {
    period,
    ...labels,
    headline,
    delivered,
    quality,
    funnel,
    deliveredSeries,
    also,
    summary,
    highlights,
    empty:
      headline.length === 0 &&
      !delivered &&
      !quality &&
      !funnel &&
      !deliveredSeries &&
      !also &&
      !summary &&
      highlights.length === 0,
  };
}
