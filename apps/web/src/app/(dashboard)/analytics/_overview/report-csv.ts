// Analytics "Export report": the selected view's numbers for the selected
// week as one CSV. Long format (section, label, value, detail) so the KPIs,
// charts, tables and lead rows of a view share one file. Campaign rows are the
// page's Marketing performance table: outreach plus ad campaigns (S84).
// Cells are formula-escaped (lead names come from strangers).

import { escapeCsvCell } from "@/lib/leads-csv";

import type { LeadQualityModel } from "./lead-quality-model";
import type { AnalyticsView, KpiCard, OverviewModel } from "./overview-model";

export const REPORT_CSV_COLUMNS = ["section", "label", "value", "detail"] as const;

type ReportRow = [section: string, label: string, value: string | number | null, detail: string | null];

function toCsv(rows: readonly ReportRow[]): string {
  const lines = [REPORT_CSV_COLUMNS.join(","), ...rows.map((row) => row.map((c) => escapeCsvCell(c)).join(","))];
  // UTF-8 BOM so Excel keeps non-ASCII names intact, as the leads CSV does.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

const kpiRows = (kpis: readonly KpiCard[]): ReportRow[] =>
  kpis.map((k) => ["kpi", k.label, k.value, k.value === null ? (k.emptyText ?? null) : k.description]);

export function overviewReportCsv(model: OverviewModel, weekLabel: string): string {
  const rows: ReportRow[] = [["week", "Week", weekLabel, null], ...kpiRows(model.kpis)];
  for (const { title, data } of model.charts) {
    if (data.type === "funnel") {
      for (const s of data.stages) rows.push([title, s.label, s.value, s.note ?? null]);
    } else if (data.type === "donut") {
      for (const s of data.segments) rows.push([title, s.label, s.value, null]);
    } else {
      for (const p of data.points) rows.push([title, p.label, p.value, null]);
    }
  }
  for (const c of model.campaigns) {
    rows.push(["campaign", c.name, c.reached, [c.channelLabel, c.responses, c.rate].filter(Boolean).join(" · ")]);
  }
  return toCsv(rows);
}

export function leadQualityReportCsv(model: LeadQualityModel, weekLabel: string): string {
  const rows: ReportRow[] = [["week", "Week", weekLabel, null], ...kpiRows(model.kpis)];
  for (const r of model.rows) {
    const detail = [r.borderline ? "borderline" : r.status, r.contactName, ...r.reasons].filter(Boolean).join(" · ");
    rows.push([r.borderline ? "borderline lead" : "qualified lead", r.company, r.fitScore, detail]);
  }
  for (const r of model.rejected.reasons) rows.push(["rejected", r.label, r.count, `${r.pct}%`]);
  return toCsv(rows);
}

/** `analytics-lead-quality-2026-09-21.csv`: view plus the week's local Monday. */
export function reportFileName(view: AnalyticsView, weekStart: string): string {
  return `analytics-${view}-${weekStart}.csv`;
}

/** Export link for the title row; null where the export does not apply. */
export function reportExportHref(view: AnalyticsView, week: "this" | "last"): string {
  const params = new URLSearchParams({ view });
  if (week === "last") params.set("week", "last");
  return `/analytics/export?${params.toString()}`;
}
