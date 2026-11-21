import { escapeHtml } from "@relay/db/report-email";

import type { ReportPeriod } from "@/lib/fixtures/interfaces";
import type { ReportStatCard, ReportView } from "@/lib/reports/view";

// Print HTML of one closed report (S89): the same view model the portal page
// renders (`buildReportView`), laid out for A4 with print CSS and printed to
// PDF by headless Chromium in the worker. Self-contained on purpose: inline
// styles, system fonts, no scripts and no network assets, because Chromium
// prints it offline with scripts disabled. Colours are the light tokens in
// globals.css as hex (the PDF is always light, like the report email).

const C = {
  page: "#ffffff",
  card: "#ffffff",
  border: "#dde1e8", // --slate-200
  text: "#151b25", // --slate-900
  muted: "#4a5769", // --slate-600
  primary: "#147f6b", // --teal-600
  primarySoft: "#e3f4ef",
};

const PERIOD_TITLE: Record<ReportPeriod, string> = {
  daily: "Daily report",
  weekly: "Weekly report",
  monthly: "Monthly report",
};

const CSS = `
@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${C.page}; color: ${C.text}; }
body { font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }
header { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px;
  padding-bottom: 12px; margin-bottom: 20px; border-bottom: 2px solid ${C.primary}; }
.brand { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: ${C.primary}; font-weight: 600; }
h1 { margin: 4px 0 0; font-size: 22px; line-height: 1.2; }
.range { color: ${C.muted}; font-size: 14px; text-align: right; }
section { break-inside: avoid; page-break-inside: avoid; border: 1px solid ${C.border}; border-radius: 10px;
  background: ${C.card}; padding: 14px 16px; }
.row { display: flex; gap: 12px; margin-bottom: 12px; }
.row > section { flex: 1 1 0; min-width: 0; }
.stack > section { margin-bottom: 12px; }
.label { color: ${C.muted}; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.metric { font-size: 26px; font-weight: 600; line-height: 1.2; margin-top: 4px; }
.suffix { font-size: 15px; color: ${C.muted}; font-weight: 500; }
.caption { color: ${C.muted}; font-size: 12px; }
.caption.up { color: ${C.primary}; }
h2 { margin: 0 0 8px; font-size: 14px; }
.chart-value { font-size: 20px; font-weight: 600; }
.bars { display: flex; align-items: flex-end; gap: 6px; height: 110px; margin-top: 10px; }
.bar { flex: 1 1 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; }
.bar i { display: block; width: 100%; background: ${C.primary}; border-radius: 3px 3px 0 0; min-height: 1px; }
.bar b { font-size: 10px; font-weight: 500; color: ${C.muted}; margin-top: 4px; }
.bar s { font-size: 10px; text-decoration: none; color: ${C.text}; margin-bottom: 2px; }
.funnel { margin-top: 10px; }
.stage { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.stage span { width: 72px; font-size: 12px; color: ${C.muted}; }
.stage em { flex: 1; height: 14px; background: ${C.primarySoft}; border-radius: 3px; position: relative; }
.stage em i { position: absolute; inset: 0 auto 0 0; background: ${C.primary}; border-radius: 3px; }
.stage strong { width: 40px; text-align: right; font-size: 12px; }
ul.also { list-style: none; margin: 0; padding: 0; }
ul.also li { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid ${C.border}; }
ul.also li:first-child { border-top: 0; }
ul.highlights { margin: 8px 0 0; padding-left: 18px; }
p { margin: 6px 0 0; }
.empty { text-align: center; padding: 32px 16px; color: ${C.muted}; }
footer { margin-top: 20px; color: ${C.muted}; font-size: 11px; }
`;

const e = escapeHtml;

function statCard(card: ReportStatCard): string {
  const caption = card.caption
    ? `<div class="caption${card.caption.startsWith("Up from") ? " up" : ""}">${e(card.caption)}</div>`
    : "";
  return `<section data-metric="${e(card.metricKey)}"><div class="label">${e(card.label)}</div><div class="metric">${e(card.value)}</div>${caption}</section>`;
}

function headline(view: ReportView): string {
  if (view.headline.length === 0) return "";
  return `<div class="row">${view.headline.map(statCard).join("")}</div>`;
}

function goals(view: ReportView): string {
  if (view.period !== "weekly" || (!view.delivered && !view.quality)) return "";
  const parts: string[] = [];
  if (view.delivered) {
    parts.push(
      `<section><div class="label">${e(view.delivered.title)}</div><div class="metric">${e(view.delivered.value)}</div></section>`,
    );
  }
  if (view.quality) {
    parts.push(
      `<section><div class="label">Lead quality score</div><div class="metric">${e(view.quality.value)} <span class="suffix">/ 100</span></div><div class="caption">Average fit score of qualified leads</div></section>`,
    );
  }
  return `<div class="row">${parts.join("")}</div>`;
}

function funnel(view: ReportView): string {
  if (!view.funnel) return "";
  const max = Math.max(1, ...view.funnel.stages.map((s) => s.value));
  const stages = view.funnel.stages
    .map(
      (s) =>
        `<div class="stage"><span>${e(s.label)}</span><em><i style="width:${((s.value / max) * 100).toFixed(1)}%"></i></em><strong>${s.value}</strong></div>`,
    )
    .join("");
  return `<section data-slot="funnel"><h2>${e(`Lead engine · ${view.shortRangeLabel}`)}</h2><div class="chart-value">${view.funnel.delivered}</div><div class="caption">${view.funnel.gathered} → ${view.funnel.delivered} gathered to delivered</div><div class="funnel">${stages}</div></section>`;
}

function deliveredSeries(view: ReportView): string {
  if (!view.deliveredSeries) return "";
  const max = Math.max(1, ...view.deliveredSeries.points.map((p) => p.value));
  const bars = view.deliveredSeries.points
    .map(
      (p) =>
        `<div class="bar"><s>${p.value}</s><i style="height:${((p.value / max) * 80).toFixed(1)}%"></i><b>${e(p.label)}</b></div>`,
    )
    .join("");
  return `<section data-slot="delivered-series"><h2>${e(view.deliveredSeries.title)}</h2><div class="chart-value">${view.deliveredSeries.total}</div><div class="caption">qualified leads</div><div class="bars">${bars}</div></section>`;
}

function also(view: ReportView): string {
  if (!view.also) return "";
  const rows = view.also.rows
    .map((r) => `<li data-metric="${e(r.metricKey)}"><span>${e(r.label)}</span><strong>${e(r.value)}</strong></li>`)
    .join("");
  return `<section><h2>${e(view.also.title)}</h2><ul class="also">${rows}</ul></section>`;
}

function narrative(view: ReportView): string {
  if (!view.summary && view.highlights.length === 0) return "";
  const title = view.period === "monthly" ? "Highlights" : "Summary";
  const summary = view.summary ? `<p>${e(view.summary)}</p>` : "";
  const list =
    view.highlights.length > 0
      ? `<ul class="highlights">${view.highlights.map((h) => `<li>${e(h)}</li>`).join("")}</ul>`
      : "";
  return `<section data-slot="narrative"><div class="label">${title}</div>${summary}${list}</section>`;
}

function body(view: ReportView): string {
  if (view.empty) {
    return `<section class="empty"><h2>Nothing to report for this period</h2><p>None of the numbers in this report have a data source yet.</p></section>`;
  }
  const charts = [funnel(view), deliveredSeries(view), view.period === "monthly" ? also(view) : ""]
    .filter(Boolean)
    .map((s) => `<div class="row">${s}</div>`)
    .join("");
  const weeklyAlso = view.period === "weekly" ? also(view) : "";
  return [headline(view), goals(view), charts, `<div class="stack">${weeklyAlso}${narrative(view)}</div>`].join("");
}

export type ReportPrintInput = {
  view: ReportView;
  companyName: string;
  /** When the PDF was made, shown in the footer. */
  generatedAt: Date;
  timeZone: string;
};

/** Full HTML document of a report, ready for Chromium `--print-to-pdf`. */
export function renderReportPrintHtml({ view, companyName, generatedAt, timeZone }: ReportPrintInput): string {
  const title = `${PERIOD_TITLE[view.period]} · ${view.rangeLabel}`;
  const generated = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(generatedAt);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${e(`${companyName} · ${title}`)}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>${CSS}</style></head>
<body data-period="${view.period}">
<header><div><div class="brand">${e(companyName)}</div><h1>${e(PERIOD_TITLE[view.period])}</h1></div><div class="range">${e(view.rangeLabel)}</div></header>
<main>${body(view)}</main>
<footer>Generated ${e(generated)} · Figures are frozen when the period closes.</footer>
</body></html>`;
}

/** `relay-report-weekly-2026-09-14.pdf`: period and first day in company time. */
export function reportPdfFileName(period: ReportPeriod, start: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(start);
  return `relay-report-${period}-${day}.pdf`;
}
