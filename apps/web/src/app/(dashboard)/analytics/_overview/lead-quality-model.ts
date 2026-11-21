// Analytics Lead quality (08b `analytics/lead-quality`): pure view model. Leads
// are `company_records` scored 0-100 by the qualify agent (lead scoring spec,
// S26): qualified = first reached `qualified` in the week (fit >= 70, or a
// borderline lead a person accepted), borderline = 50-69 still waiting for a
// person, rejected = the qualifier said no (one reject reason each).

import {
  leadRowView,
  type LeadRowView,
  type SessionLeadRecord,
} from "@/components/operator/session/panes/leads/leads-pane-model";
import { countLeadMetrics, type LeadEventFact, type WeekRange } from "@/lib/metrics/compute";

import { qualityKpi, type KpiCard, type QualifiedFact } from "./overview-model";

/** Rows the Qualified leads card lists; the export carries every row. */
export const LEAD_QUALITY_LIST_LIMIT = 8;
/** Reject reasons shown as bars; the rest fold into "Other reasons". */
export const REJECT_REASON_LIMIT = 5;

const NO_REASON = "No reason given";
const intFmt = new Intl.NumberFormat("en-US");

export type LeadQualityInput = {
  /** Oldest first; the last is the selected week, the one before it the previous week. */
  weeks: WeekRange[];
  events: LeadEventFact[];
  customerAgentIds: ReadonlySet<string>;
  /** Leads first qualified in the selected week. */
  qualified: QualifiedFact[];
  /** Fit scores of the leads delivered in the selected and the previous week. */
  scores: ReadonlyMap<string, number | null>;
  conversations: number;
  target: number | null;
  /** Qualified leads of the week plus borderline leads that became borderline in it. */
  leads: SessionLeadRecord[];
  /** One entry per lead rejected in the week: its reject reason. */
  rejectReasons: (string | null)[];
};

export type LeadQualityRow = LeadRowView & { id: string; status: string; source: string | null };

export type RejectReasonBar = { label: string; count: number; pct: number };

export type LeadQualityModel = {
  kpis: KpiCard[];
  /** Best fit first, borderline leads after the qualified ones of equal fit. */
  rows: LeadQualityRow[];
  qualifiedCount: number;
  borderlineCount: number;
  gathered: number;
  rejected: { total: number; reasons: RejectReasonBar[] };
};

const isInbound = (source: string | null) => source !== null && source !== "outbound";

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Reject reasons by count, most common first; the long tail folds into one bar. */
export function groupRejectReasons(reasons: readonly (string | null)[]): RejectReasonBar[] {
  const counts = new Map<string, number>();
  for (const r of reasons) {
    const label = r?.trim() || NO_REASON;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.length > REJECT_REASON_LIMIT ? sorted.slice(0, REJECT_REASON_LIMIT - 1) : sorted;
  const tail = sorted.slice(head.length).reduce((sum, [, n]) => sum + n, 0);
  const bars = head.map(([label, count]) => ({ label, count, pct: percent(count, reasons.length) }));
  if (tail > 0) bars.push({ label: "Other reasons", count: tail, pct: percent(tail, reasons.length) });
  return bars;
}

export function buildLeadQuality(input: LeadQualityInput): LeadQualityModel {
  const week = input.weeks[input.weeks.length - 1];
  const prev = input.weeks.length > 1 ? input.weeks[input.weeks.length - 2] : null;
  const counts = countLeadMetrics(input.events, week, input.customerAgentIds);
  const prevCounts = prev ? countLeadMetrics(input.events, prev, input.customerAgentIds) : null;

  const qualifiedInbound = input.qualified.filter((q) => isInbound(q.source)).length;
  const qualifiedGathered = input.qualified.length - qualifiedInbound;

  const fromGathered: KpiCard =
    counts.gathered > 0
      ? {
          label: "Qualified from gathered",
          value: `${intFmt.format(qualifiedGathered)} of ${intFmt.format(counts.gathered)}`,
          description: `${percent(qualifiedGathered, counts.gathered)}% pass rate`,
        }
      : {
          label: "Qualified from gathered",
          value: null,
          description: "",
          emptyText: "No leads gathered this week",
        };

  const inbound: KpiCard = {
    label: "Inbound qualified",
    value: intFmt.format(qualifiedInbound),
    description: `From ${intFmt.format(input.conversations)} customer-agent ${
      input.conversations === 1 ? "conversation" : "conversations"
    }`,
  };

  const target = input.target;
  const delivered: KpiCard =
    target !== null && target > 0
      ? {
          label: "Delivered to client",
          value: `${counts.delivered} of ${target}`,
          description:
            counts.delivered >= target
              ? "Weekly target reached"
              : `${target - counts.delivered} more to reach the weekly target`,
        }
      : {
          label: "Delivered to client",
          value: String(counts.delivered),
          description: "No weekly target set",
        };

  const qualifiedIds = new Set(input.qualified.map((q) => q.id));
  const rows: LeadQualityRow[] = input.leads
    .filter((lead) => qualifiedIds.has(lead.id) || lead.status === "borderline")
    .map((lead) => ({ ...leadRowView(lead), id: lead.id, status: lead.status, source: lead.source }))
    .sort(
      (a, b) =>
        (b.fitScore ?? -1) - (a.fitScore ?? -1) ||
        Number(a.borderline) - Number(b.borderline) ||
        a.company.localeCompare(b.company),
    );

  return {
    kpis: [qualityKpi(counts, prevCounts, input.scores), fromGathered, inbound, delivered],
    rows,
    qualifiedCount: input.qualified.length,
    borderlineCount: rows.filter((r) => r.borderline).length,
    gathered: counts.gathered,
    rejected: { total: input.rejectReasons.length, reasons: groupRejectReasons(input.rejectReasons) },
  };
}

/** "Showing 6 of 35 qualified leads · 1 borderline". */
export function leadListFooter(model: LeadQualityModel, shown: number): string {
  const parts = [
    `Showing ${shown} of ${model.qualifiedCount + model.borderlineCount} ${
      model.qualifiedCount + model.borderlineCount === 1 ? "lead" : "leads"
    }`,
    `${model.qualifiedCount} qualified`,
  ];
  if (model.borderlineCount > 0) parts.push(`${model.borderlineCount} borderline`);
  return parts.join(" · ");
}

/** "111 of 146 gathered leads · why the qualifier said no". */
export function rejectedSubtitle(model: LeadQualityModel): string {
  const total = intFmt.format(model.rejected.total);
  return model.gathered > 0
    ? `${total} of ${intFmt.format(model.gathered)} gathered leads · why the qualifier said no`
    : `${total} ${model.rejected.total === 1 ? "lead" : "leads"} · why the qualifier said no`;
}
