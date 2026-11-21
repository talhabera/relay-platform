import { describe, expect, it } from "vitest";

import type { ReportSnapshot } from "@/lib/fixtures/interfaces";
import { buildReportView } from "@/lib/reports/view";

import { renderReportPrintHtml, reportPdfFileName } from "./print-html";

const TZ = "Europe/Berlin";
const generatedAt = new Date("2026-09-21T09:00:00Z");

function snapshot(overrides: Partial<ReportSnapshot>): ReportSnapshot {
  return {
    id: "snap-1",
    companyId: "c1",
    period: "weekly",
    start: new Date("2026-09-13T22:00:00Z"),
    end: new Date("2026-09-20T22:00:00Z"),
    metrics: [],
    series: { delivered: [], funnel: [] },
    narrative: null,
    frozenAt: new Date("2026-09-20T22:01:00Z"),
    ...overrides,
  };
}

function render(s: ReportSnapshot, companyName = "Müller GmbH") {
  return renderReportPrintHtml({ view: buildReportView(s, TZ), companyName, generatedAt, timeZone: TZ });
}

describe("renderReportPrintHtml", () => {
  it("prints a weekly report with goals, funnel, series and narrative", () => {
    const html = render(
      snapshot({
        metrics: [
          { metricKey: "leads.qualified_delivered", value: 12, previous: 9 },
          { metricKey: "leads.quality_score", value: 81, previous: null },
          { metricKey: "conversations.started", value: 140, previous: null },
        ],
        series: {
          delivered: [
            { label: "2026-09-14", value: 2 },
            { label: "2026-09-15", value: 4 },
          ],
          funnel: [
            { stage: "gathered", value: 40 },
            { stage: "delivered", value: 12 },
          ],
        },
        narrative: { summary: "A strong week.", highlights: ["Two new partners"] },
      }),
    );
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page { size: A4");
    expect(html).toContain("Weekly report");
    expect(html).toContain("14–20 Sep 2026");
    expect(html).toContain("Qualified leads delivered · 14–20 Sep");
    expect(html).toContain("/ 100");
    expect(html).toContain("Delivered per day");
    expect(html).toContain("<b>Mon</b>");
    expect(html).toContain("40 → 12 gathered to delivered");
    expect(html).toContain("Also this week");
    expect(html).toContain("A strong week.");
    expect(html).toContain("<li>Two new partners</li>");
    expect(html).toContain("Müller GmbH");
  });

  it("hides cards without a data source", () => {
    const html = render(
      snapshot({
        period: "daily",
        start: new Date("2026-09-23T22:00:00Z"),
        end: new Date("2026-09-24T22:00:00Z"),
        metrics: [{ metricKey: "conversations.started", value: 19, previous: null }],
      }),
    );
    expect(html).toContain('data-metric="conversations.started"');
    expect(html).not.toContain("Inbound leads");
    expect(html).not.toContain('data-slot="narrative"');
  });

  it("prints the empty note when nothing has a source", () => {
    expect(render(snapshot({}))).toContain("Nothing to report for this period");
  });

  it("escapes company names and narrative, and has no scripts or remote assets", () => {
    const html = render(
      snapshot({
        metrics: [{ metricKey: "conversations.started", value: 1, previous: null }],
        narrative: { summary: '<script>alert("x")</script>', highlights: ["<img src=x>"] },
      }),
      "<b>Evil</b> & Co",
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;b&gt;Evil&lt;/b&gt; &amp; Co");
    expect(html).not.toMatch(/(src|href)=["']?https?:/);
    expect(html).toContain("default-src 'none'");
  });
});

describe("reportPdfFileName", () => {
  it("names the period and its first day in company time", () => {
    expect(reportPdfFileName("weekly", new Date("2026-09-13T22:00:00Z"), TZ)).toBe(
      "relay-report-weekly-2026-09-14.pdf",
    );
  });
});
