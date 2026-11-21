// Analytics Overview (08b `analytics/default`): pure view model. The loader in
// `./load-overview.ts` fetches rows; everything that decides what a card says
// lives here so it is testable without a database. Leads are `company_records`
// and every count reads the `lead_events` log (lead attribution spec); a
// "qualified" lead is one first qualified in the week (fit >= 70, or a
// borderline lead a person accepted), the billing basis of `listQualifiedLeads`.

import type { BrandName } from "@/components/v2/primitives/brand-glyph";
import type { ChartCardData } from "@/components/v2/data/chart-card";
import type { CampaignMetric } from "@/lib/metrics/campaigns";
import {
  costPerQualifiedLead,
  countLeadMetrics,
  firstDeliveredInRange,
  inRange,
  leadQualityScore,
  type LeadCounts,
  type LeadEventFact,
  type WeekRange,
} from "@/lib/metrics/compute";
import { formatCostPerLead } from "../../operator/_overview/overview-model";

export const ANALYTICS_VIEWS = ["overview", "lead-quality", "agents", "marketing"] as const;
export type AnalyticsView = (typeof ANALYTICS_VIEWS)[number];

/** Views shipped so far; Marketing stays a disabled segment until campaign metrics (S84). */
export const ENABLED_VIEWS: ReadonlySet<AnalyticsView> = new Set(["overview", "lead-quality", "agents"]);

/** Views the report export covers (the week-based ones). */
export const EXPORT_VIEWS: ReadonlySet<AnalyticsView> = new Set(["overview", "lead-quality"]);

export const ANALYTICS_VIEW_LABELS: Record<AnalyticsView, string> = {
  overview: "Overview",
  "lead-quality": "Lead quality",
  agents: "Customer agents",
  marketing: "Marketing",
};

export function parseAnalyticsView(value: string | undefined): AnalyticsView {
  const view = ANALYTICS_VIEWS.find((v) => v === value);
  return view && ENABLED_VIEWS.has(view) ? view : "overview";
}

export const WEEK_CHOICES = ["this", "last"] as const;
export type WeekChoice = (typeof WEEK_CHOICES)[number];

export function parseWeekChoice(value: string | undefined): WeekChoice {
  return value === "last" ? "last" : "this";
}

/** Weeks shown on the per-week trend line, the selected one last. */
export const TREND_WEEKS = 7;

/** Statuses that count as a reply to outreach (post-reply `interested` included). */
const REPLIED_STATUSES: readonly string[] = ["replied", "interested"];

/** A row of the Marketing performance table: Lead engine outreach, then ad campaigns (S84). */
export type CampaignRow = {
  id: string;
  name: string;
  channel: BrandName;
  channelLabel: string;
  /** Display text, e.g. "31 contacted" or "2,480". */
  reached: string;
  responses: string;
  /** Null when nothing was reached. */
  rate: string | null;
};

export type QualifiedFact = { id: string; source: string | null };

export type OverviewInput = {
  timeZone: string;
  /** `TREND_WEEKS` ISO weeks, oldest first; the last is the selected week. */
  weeks: WeekRange[];
  /** Lead events from `weeks[0].from` to the selected week's end, plus every earlier delivery. */
  events: LeadEventFact[];
  customerAgentIds: ReadonlySet<string>;
  /** Leads first qualified in the selected week. */
  qualified: QualifiedFact[];
  /** Fit scores of the leads delivered in the selected and the previous week. */
  scores: ReadonlyMap<string, number | null>;
  tokens: { current: number; previous: number };
  /** Customer-agent conversations started in the selected week. */
  conversations: number;
  /** Weekly qualified-lead target; null when no workflow sets one. */
  target: number | null;
  /** Ad campaign rows (`adCampaignRows`); outreach is derived here. */
  campaigns?: CampaignRow[];
};

export type KpiCard = {
  label: string;
  value: string | null;
  description: string;
  trend?: "up" | "down";
  emptyText?: string;
};

export type OverviewChart = {
  title: string;
  info: string;
  value: string;
  delta?: string;
  comparison?: string;
  data: ChartCardData;
};

export type OverviewModel = {
  weekLabel: string;
  kpis: KpiCard[];
  charts: OverviewChart[];
  campaigns: CampaignRow[];
};

const intFmt = new Intl.NumberFormat("en-US");

/** "21–27 Sep", or "29 Sep – 5 Oct" across months, in company time. */
export function weekDaysLabel(range: WeekRange, timeZone: string): string {
  const last = new Date(range.to.getTime() - 1);
  // en-US parts: en-GB spells September "Sept"; the design uses "Sep".
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric", month: "short" }).formatToParts(d);
    return { day: p.find((x) => x.type === "day")?.value ?? "", month: p.find((x) => x.type === "month")?.value ?? "" };
  };
  const a = parts(range.from);
  const b = parts(last);
  return a.month === b.month ? `${a.day}–${b.day} ${b.month}` : `${a.day} ${a.month} – ${b.day} ${b.month}`;
}

/** "This week · 21–27 Sep". */
export function weekChoiceLabel(choice: WeekChoice, range: WeekRange, timeZone: string): string {
  return `${choice === "this" ? "This week" : "Last week"} · ${weekDaysLabel(range, timeZone)}`;
}

/** "W39" for the ISO week starting at `from` (Monday, company time). */
export function isoWeekLabel(range: WeekRange, timeZone: string): string {
  // Thursday decides the ISO year/week; read the civil date in company time.
  const thursday = new Date(range.from.getTime() + 3.5 * 86_400_000);
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(thursday);
  const [y, m, d] = ymd.split("-").map(Number);
  const date = Date.UTC(y, m - 1, d);
  const jan1 = Date.UTC(y, 0, 1);
  const week = Math.floor((date - jan1) / 86_400_000 / 7) + 1;
  return `W${week}`;
}

/** Response rate: whole percent from 10%, one decimal below (Figma 29%, 2.6%). */
export function formatRate(responses: number, reached: number): string | null {
  if (reached <= 0) return null;
  const pct = (responses / reached) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
}

/** "+1", "−2" (U+2212, so ChartCard picks trending-down), or null for no change. */
export function signedDelta(delta: number, prefix = ""): string | null {
  if (delta === 0) return null;
  return delta > 0 ? `+${prefix}${intFmt.format(delta)}` : `−${prefix}${intFmt.format(-delta)}`;
}

function distinctRecords(
  events: readonly LeadEventFact[],
  range: WeekRange,
  statuses: readonly string[],
): number {
  const ids = new Set<string>();
  for (const e of events) if (inRange(e.at, range) && statuses.includes(e.toStatus)) ids.add(e.recordId);
  return ids.size;
}

const isInboundSource = (source: string | null) => source !== null && source !== "outbound";

/** Lead quality score KPI: average fit of the week's delivered leads, vs the previous week. */
export function qualityKpi(
  counts: LeadCounts,
  prevCounts: LeadCounts | null,
  scores: ReadonlyMap<string, number | null>,
): KpiCard {
  const quality = leadQualityScore(counts.deliveredRecordIds, scores);
  const prevQuality = prevCounts ? leadQualityScore(prevCounts.deliveredRecordIds, scores) : null;
  const qualityDelta = quality !== null && prevQuality !== null ? quality - prevQuality : null;
  return {
    label: "Lead quality score",
    value: quality === null ? null : String(quality),
    description:
      qualityDelta === null
        ? "No scored leads last week"
        : qualityDelta === 0
          ? "Same as last week"
          : `${signedDelta(qualityDelta)} vs last week`,
    trend: qualityDelta === null || qualityDelta === 0 ? undefined : qualityDelta > 0 ? "up" : "down",
    emptyText: "No scored leads delivered yet",
  };
}

/** Inputs every week-based view shares; `isEmptyWeek` reads only these. */
export type WeekActivity = Pick<OverviewInput, "weeks" | "events" | "qualified" | "conversations" | "tokens">;

/**
 * The empty-range state (08b `analytics/empty-range`): nothing at all happened
 * in the selected week, so every card would read zero. A week with only
 * zeros in some cards is not empty; this is "no data", not "no results".
 */
export function isEmptyWeek(input: WeekActivity): boolean {
  const week = input.weeks[input.weeks.length - 1];
  return (
    input.qualified.length === 0 &&
    input.conversations === 0 &&
    input.tokens.current === 0 &&
    !input.events.some((e) => inRange(e.at, week))
  );
}

/** KPI labels per view, for the empty-range and loading states. */
export const OVERVIEW_KPI_LABELS = [
  "Qualified leads delivered",
  "Lead quality score",
  "Cost per qualified lead",
  "Customer-agent conversations",
] as const;

export const LEAD_QUALITY_KPI_LABELS = [
  "Lead quality score",
  "Qualified from gathered",
  "Inbound qualified",
  "Delivered to client",
] as const;

/** Empty-range copy: before the company existed, or a quiet week after it. */
export function emptyRangeCopy(args: {
  companyName: string;
  companyCreatedAt: Date;
  week: WeekRange;
  timeZone: string;
}): { title: string; description: string } {
  const { companyName, companyCreatedAt, week, timeZone } = args;
  const title = `No data for ${weekDaysLabel(week, timeZone)}`;
  if (week.to.getTime() <= companyCreatedAt.getTime()) {
    // en-US parts, not en-GB: en-GB spells September "Sept"; the design says "1 Sep 2026".
    const p = new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).formatToParts(companyCreatedAt);
    const part = (type: string) => p.find((x) => x.type === type)?.value ?? "";
    const started = `${part("day")} ${part("month")} ${part("year")}`;
    return {
      title,
      description: `Relay started collecting analytics for ${companyName} on ${started}. Pick a range after that date to see leads, agents and campaigns.`,
    };
  }
  return {
    title,
    description: `No leads, customer-agent conversations or token usage were recorded for ${companyName} in this week.`,
  };
}

/** Lead source -> table glyph and label; an ad without a source is Click-to-WhatsApp. */
const CAMPAIGN_CHANNELS: Record<string, { channel: BrandName; label: string }> = {
  whatsapp: { channel: "whatsapp", label: "WhatsApp" },
  instagram: { channel: "instagram", label: "Instagram" },
  messenger: { channel: "messenger", label: "Messenger" },
  telegram: { channel: "telegram", label: "Telegram" },
  shopify: { channel: "shopify", label: "Shopify" },
  widget: { channel: "website", label: "Website" },
  outbound: { channel: "email", label: "Email" },
};

/**
 * Ad campaign rows (lead scoring spec, decision 14): leads the campaign brought
 * in this week, and how many of them reached qualified.
 */
export function adCampaignRows(metrics: readonly CampaignMetric[]): CampaignRow[] {
  return metrics.map((m) => {
    const known = m.source ? CAMPAIGN_CHANNELS[m.source] : undefined;
    const via = known ?? (m.kind === "ad" ? CAMPAIGN_CHANNELS.whatsapp : { channel: "website" as const, label: "Website" });
    return {
      id: m.id,
      name: m.name,
      channel: via.channel,
      channelLabel: m.kind === "ad" ? `${via.label} ad` : via.label,
      reached: `${intFmt.format(m.leads)} ${m.leads === 1 ? "lead" : "leads"}`,
      responses: `${intFmt.format(m.qualified)} qualified`,
      rate: formatRate(m.qualified, m.leads),
    };
  });
}

export function buildOverview(input: OverviewInput): OverviewModel {
  const { weeks, events, customerAgentIds, timeZone } = input;
  const week = weeks[weeks.length - 1];
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;

  const counts = countLeadMetrics(events, week, customerAgentIds);
  const prevCounts = prev ? countLeadMetrics(events, prev, customerAgentIds) : null;
  const replied = distinctRecords(events, week, REPLIED_STATUSES);
  const qualifiedInbound = input.qualified.filter((q) => isInboundSource(q.source)).length;
  const qualifiedGathered = input.qualified.length - qualifiedInbound;

  // KPI 1: qualified leads delivered against the weekly target.
  const target = input.target;
  const deliveredCard: KpiCard =
    target !== null && target > 0
      ? {
          label: "Qualified leads delivered",
          value: `${counts.delivered} of ${target}`,
          description: `Weekly target · ${Math.round((counts.delivered / target) * 100)}% reached`,
        }
      : {
          label: "Qualified leads delivered",
          value: String(counts.delivered),
          description: "No weekly target set",
        };

  // KPI 2: average fit score of this week's delivered leads.
  const qualityCard = qualityKpi(counts, prevCounts, input.scores);

  // KPI 3: estimated token cost per delivered qualified lead (lower is better).
  const cost = costPerQualifiedLead(input.tokens.current, counts.delivered);
  const prevCost = prevCounts ? costPerQualifiedLead(input.tokens.previous, prevCounts.delivered) : null;
  const costDelta =
    cost && prevCost ? Math.round(cost.estimatedUsdPerLead - prevCost.estimatedUsdPerLead) : null;
  const costCard: KpiCard = {
    label: "Cost per qualified lead",
    value: cost ? formatCostPerLead(cost.estimatedUsdPerLead) : null,
    description:
      costDelta === null
        ? "Estimate from token usage"
        : costDelta === 0
          ? "Estimate · same as last week"
          : `${signedDelta(costDelta, "$")} vs last week · estimate`,
    trend: costDelta === null || costDelta === 0 ? undefined : costDelta < 0 ? "up" : "down",
    emptyText: "No qualified lead delivered yet",
  };

  const conversationsCard: KpiCard = {
    label: "Customer-agent conversations",
    value: intFmt.format(input.conversations),
    description: `${counts.inbound} became inbound ${counts.inbound === 1 ? "lead" : "leads"}`,
  };

  // Charts.
  const days = weekDaysLabel(week, timeZone);
  const funnel: OverviewChart = {
    title: `Lead engine · ${days}`,
    info: "Distinct leads that reached each stage this week.",
    value: `${counts.delivered} delivered`,
    delta: `${intFmt.format(counts.gathered)} → ${intFmt.format(counts.delivered)}`,
    comparison: "gathered to delivered",
    data: {
      type: "funnel",
      stages: [
        { label: "Gathered", value: counts.gathered },
        {
          label: "Qualified",
          value: input.qualified.length,
          note: qualifiedInbound > 0 ? `incl. ${qualifiedInbound} inbound` : undefined,
        },
        { label: "Outreach", value: counts.contactedReplied, note: `${replied} replied` },
        {
          label: "Delivered",
          value: counts.delivered,
          note: target !== null && target > 0 ? `target ${target}` : undefined,
        },
      ],
    },
  };

  const perWeek = weeks.map((w) => firstDeliveredInRange(events, w).size);
  const weekDelta = prev ? perWeek[perWeek.length - 1] - perWeek[perWeek.length - 2] : 0;
  const weekDeltaText = signedDelta(weekDelta);
  const trend: OverviewChart = {
    title: "Qualified leads delivered per week",
    info: "Qualified leads counted once, on their first delivery.",
    value: String(counts.delivered),
    delta: weekDeltaText ?? undefined,
    comparison: weekDeltaText ? "vs last week" : "same as last week",
    data: {
      type: "line",
      points: weeks.map((w, i) => ({ label: isoWeekLabel(w, timeZone), value: perWeek[i] })),
    },
  };

  const origin: OverviewChart = {
    title: "Qualified leads by origin",
    info: "Leads first qualified this week, by where they came from.",
    value: String(input.qualified.length),
    delta: `${qualifiedInbound} inbound`,
    comparison: `${qualifiedGathered} gathered`,
    data: {
      type: "donut",
      centerLabel: "qualified",
      segments: [
        { label: "Gathered by Lead Gatherer", value: qualifiedGathered },
        { label: "Inbound from customer agents", value: qualifiedInbound },
      ],
    },
  };

  // Marketing performance: Lead engine outreach is the one campaign with data today.
  const campaigns: CampaignRow[] = [];
  if (counts.contactedReplied > 0) {
    campaigns.push({
      id: "lead-engine-outreach",
      name: "Lead engine outreach",
      channel: "email",
      channelLabel: "Email",
      reached: `${intFmt.format(counts.contactedReplied)} contacted`,
      responses: `${intFmt.format(replied)} ${replied === 1 ? "reply" : "replies"}`,
      rate: formatRate(replied, counts.contactedReplied),
    });
  }
  campaigns.push(...(input.campaigns ?? []));

  return {
    weekLabel: days,
    kpis: [deliveredCard, qualityCard, costCard, conversationsCard],
    charts: [funnel, trend, origin],
    campaigns,
  };
}
