import { describe, expect, it } from "vitest";

import { fixtureData } from "@/lib/fixtures/data";
import type { ReportSnapshot } from "@/lib/fixtures/interfaces";

import { buildReportView, reportRangeLabels, seriesTickLabel } from "./view";

const TZ = "Europe/Berlin";
const byId = (id: string) => fixtureData.reportSnapshots.find((r) => r.id === id)!;

describe("buildReportView: daily (Figma 11a reports/daily)", () => {
  it("shows the sourced headline cards in Figma order; Site visits is hidden", () => {
    const view = buildReportView(byId("fx-report-d0924"), TZ);
    expect(view.rangeLabel).toBe("Thu 24 Sep 2026");
    expect(view.headline.map((c) => [c.label, c.value])).toEqual([
      ["Conversations", "19"],
      ["Inbound leads", "4"],
      ["Qualified leads delivered", "2"],
      ["Staff answers", "3"],
    ]);
    expect(view.headline.some((c) => /site visit/i.test(c.label))).toBe(false);
    expect(view.funnel).toBeNull();
    expect(view.deliveredSeries).toBeNull();
    expect(view.empty).toBe(false);
  });

  it("hides a card whose metric is absent instead of rendering it empty", () => {
    const snap: ReportSnapshot = {
      ...byId("fx-report-d0924"),
      metrics: [{ metricKey: "conversations.started", value: 5, previous: 3 }],
    };
    const view = buildReportView(snap, TZ);
    expect(view.headline.map((c) => c.metricKey)).toEqual(["conversations.started"]);
  });

  it("a snapshot with no sourced metric is empty", () => {
    expect(buildReportView(byId("fx-report-d0923"), TZ).empty).toBe(true);
  });

  it("carries the Insights narrative when present", () => {
    const snap = { ...byId("fx-report-d0924"), narrative: { summary: " Busy day. ", highlights: ["a", " "] } };
    const view = buildReportView(snap, TZ);
    expect(view.summary).toBe("Busy day.");
    expect(view.highlights).toEqual(["a"]);
  });
});

describe("buildReportView: weekly (Figma 11a reports/weekly)", () => {
  const view = buildReportView(byId("fx-report-w0914"), TZ);

  it("labels the week and its goal cards", () => {
    expect(view.rangeLabel).toBe("14–20 Sep 2026");
    expect(view.delivered).toEqual({ value: "8", title: "Qualified leads delivered · 14–20 Sep", comparison: null });
    expect(view.quality).toEqual({ value: "80" });
  });

  it("builds the lead engine funnel and delivered per day", () => {
    expect(view.funnel).toEqual({
      stages: [
        { label: "Gathered", value: 131 },
        { label: "Qualified", value: 39 },
        { label: "Contacted", value: 28 },
        { label: "Delivered", value: 8 },
      ],
      gathered: 131,
      delivered: 8,
    });
    expect(view.deliveredSeries).toEqual({
      title: "Delivered per day",
      total: 8,
      points: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, i) => ({
        label,
        value: [1, 2, 1, 2, 1, 1, 0][i],
      })),
    });
  });

  it("lists only sourced 'Also this week' rows; no cost card exists", () => {
    expect(view.also?.title).toBe("Also this week");
    expect(view.also?.rows.map((r) => r.metricKey)).toEqual([
      "conversations.started",
      "leads.inbound",
      "handoff.staff_answers",
    ]);
    expect(JSON.stringify(view)).not.toMatch(/cost|site visit|review|post/i);
  });

  it("hides the funnel and series when the snapshot has none", () => {
    const empty = buildReportView(byId("fx-report-w0907"), TZ);
    expect(empty.funnel).toBeNull();
    expect(empty.deliveredSeries).toBeNull();
    expect(empty.empty).toBe(true);
  });

  it("drops the quality card when nothing scored was delivered", () => {
    const snap = {
      ...byId("fx-report-w0914"),
      metrics: byId("fx-report-w0914").metrics.filter((m) => m.metricKey !== "leads.quality_score"),
    };
    expect(buildReportView(snap, TZ).quality).toBeNull();
  });
});

describe("buildReportView: monthly (Figma 11a reports/monthly)", () => {
  const monthly = () => byId("fx-report-m2608");

  it("leads with delivered, quality and conversations; delivered carries the previous-period copy", () => {
    const view = buildReportView(monthly(), TZ);
    expect(view.rangeLabel).toBe("August 2026");
    expect(view.headline.map((c) => [c.label, c.value, c.caption ?? null])).toEqual([
      ["Qualified leads delivered", "31", "Up from 23 in July"],
      ["Lead quality score", "79", "Average fit score of qualified leads"],
      ["Conversations", "96", null],
    ]);
    expect(view.delivered?.comparison).toBe("Up from 23 in July");
  });

  it("charts delivered per week and titles the extra rows 'Also this month'", () => {
    const view = buildReportView(monthly(), TZ);
    expect(view.deliveredSeries).toMatchObject({ title: "Delivered per week", total: 31 });
    expect(view.deliveredSeries?.points.map((p) => p.label)).toEqual(["W32", "W33", "W34", "W35"]);
    expect(view.also?.title).toBe("Also this month");
    // Conversations sits in the headline row on monthly, not in "Also".
    expect(view.also?.rows.map((r) => r.metricKey)).toEqual(["handoff.staff_answers"]);
    expect(JSON.stringify(view)).not.toMatch(/cost|site visit|review|post/i);
  });

  it("words a drop, a flat month and a missing previous", () => {
    const withDelivered = (value: number, previous: number | null) => ({
      ...monthly(),
      metrics: [{ metricKey: "leads.qualified_delivered" as const, value, previous }],
    });
    expect(buildReportView(withDelivered(20, 23), TZ).delivered?.comparison).toBe("Down from 23 in July");
    expect(buildReportView(withDelivered(23, 23), TZ).delivered?.comparison).toBe("Same as July");
    expect(buildReportView(withDelivered(23, null), TZ).delivered?.comparison).toBeNull();
    expect(buildReportView(withDelivered(23, null), TZ).headline[0].caption).toBeUndefined();
  });

  it("weekly never renders the previous-period copy", () => {
    const weekly = byId("fx-report-w0914");
    const snap = { ...weekly, metrics: weekly.metrics.map((m) => ({ ...m, previous: 1 })) };
    const view = buildReportView(snap, TZ);
    expect(view.delivered?.comparison).toBeNull();
    expect(JSON.stringify(view)).not.toMatch(/Up from|Down from|Same as/);
  });
});

describe("reportRangeLabels in company time", () => {
  it("spans months and years", () => {
    expect(
      reportRangeLabels("weekly", new Date("2026-09-27T22:00:00Z"), new Date("2026-10-04T22:00:00Z"), TZ).rangeLabel,
    ).toBe("28 Sep – 4 Oct 2026");
    expect(
      reportRangeLabels("weekly", new Date("2025-12-28T23:00:00Z"), new Date("2026-01-04T23:00:00Z"), TZ).rangeLabel,
    ).toBe("29 Dec 2025 – 4 Jan 2026");
  });

  it("uses the local day across the DST change", () => {
    // Week of Mon 26 Oct 2026 is 169 h long in Berlin (DST ends Sun 25 Oct).
    const labels = reportRangeLabels(
      "weekly",
      new Date("2026-10-18T22:00:00Z"),
      new Date("2026-10-25T23:00:00Z"),
      TZ,
    );
    expect(labels.rangeLabel).toBe("19–25 Oct 2026");
    expect(
      reportRangeLabels("daily", new Date("2026-09-23T22:00:00Z"), new Date("2026-09-24T22:00:00Z"), TZ).rangeLabel,
    ).toBe("Thu 24 Sep 2026");
    expect(
      reportRangeLabels("monthly", new Date("2026-07-31T22:00:00Z"), new Date("2026-08-31T22:00:00Z"), TZ).rangeLabel,
    ).toBe("August 2026");
  });
});

describe("seriesTickLabel", () => {
  it("maps stored bucket labels to chart ticks", () => {
    expect(seriesTickLabel("2026-09-14")).toBe("Mon");
    expect(seriesTickLabel("2026-09-20")).toBe("Sun");
    expect(seriesTickLabel("2026-W35")).toBe("W35");
    expect(seriesTickLabel("Mon")).toBe("Mon");
  });
});
