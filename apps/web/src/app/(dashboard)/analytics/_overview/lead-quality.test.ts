import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SessionLeadRecord } from "@/components/operator/session/panes/leads/leads-pane-model";
import type { LeadEventFact } from "@/lib/metrics/compute";
import { shiftIsoWeek } from "@/lib/time";

import { EmptyRangeView } from "./empty-range-view";
import {
  buildLeadQuality,
  groupRejectReasons,
  leadListFooter,
  rejectedSubtitle,
  type LeadQualityInput,
} from "./lead-quality-model";
import { LeadQualityView } from "./lead-quality-view";
import {
  buildOverview,
  emptyRangeCopy,
  EXPORT_VIEWS,
  isEmptyWeek,
  OVERVIEW_KPI_LABELS,
  parseAnalyticsView,
  TREND_WEEKS,
  type OverviewInput,
} from "./overview-model";
import { leadQualityReportCsv, overviewReportCsv, reportExportHref, reportFileName } from "./report-csv";

const TZ = "Europe/Berlin";
const NOW = new Date("2026-09-24T10:00:00Z"); // Thu, ISO 2026-W39 (21-27 Sep)
const weeks = Array.from({ length: TREND_WEEKS }, (_, i) => shiftIsoWeek(NOW, TZ, i - (TREND_WEEKS - 1)));
const thisWeek = weeks[TREND_WEEKS - 1];
const lastWeek = weeks[TREND_WEEKS - 2];
const at = (range: { from: Date }, hours: number) => new Date(range.from.getTime() + hours * 3_600_000);

const ev = (recordId: string, toStatus: string, when: Date, over: Partial<LeadEventFact> = {}): LeadEventFact => ({
  recordId,
  fromStatus: "x",
  toStatus,
  agentId: "gatherer",
  userId: null,
  at: when,
  ...over,
});

const lead = (id: string, over: Partial<SessionLeadRecord> = {}): SessionLeadRecord => ({
  id,
  entityType: "account",
  name: id,
  domain: null,
  phone: null,
  source: "outbound",
  status: "qualified",
  fitScore: 80,
  reasons: [],
  rejectReason: null,
  contact: null,
  location: null,
  ...over,
});

function lqInput(over: Partial<LeadQualityInput> = {}): LeadQualityInput {
  return {
    weeks,
    events: [],
    customerAgentIds: new Set(["support"]),
    qualified: [],
    scores: new Map(),
    conversations: 0,
    target: null,
    leads: [],
    rejectReasons: [],
    ...over,
  };
}

describe("views", () => {
  it("enables Lead quality; Marketing waits for campaign metrics", () => {
    expect(parseAnalyticsView("lead-quality")).toBe("lead-quality");
    expect(parseAnalyticsView("marketing")).toBe("overview");
    expect([...EXPORT_VIEWS]).toEqual(["overview", "lead-quality"]);
  });
});

describe("buildLeadQuality", () => {
  it("empty week: dashed pass rate, zero inbound, no target", () => {
    const m = buildLeadQuality(lqInput());
    expect(m.kpis.map((k) => k.label)).toEqual([
      "Lead quality score",
      "Qualified from gathered",
      "Inbound qualified",
      "Delivered to client",
    ]);
    expect(m.kpis.map((k) => k.value)).toEqual([null, null, "0", "0"]);
    expect(m.kpis[3].description).toBe("No weekly target set");
    expect(m.rows).toEqual([]);
    expect(m.rejected).toEqual({ total: 0, reasons: [] });
  });

  it("counts pass rate, inbound, target and sorts leads by fit", () => {
    const events: LeadEventFact[] = [
      ...["g1", "g2", "g3", "g4"].map((id, i) => ev(id, "pending", at(thisWeek, i + 1), { fromStatus: null })),
      ev("g1", "qualified", at(thisWeek, 10)),
      ev("g2", "borderline", at(thisWeek, 11)),
      ev("g3", "rejected", at(thisWeek, 12)),
      ev("g4", "rejected", at(thisWeek, 12)),
      ev("in1", "qualified", at(thisWeek, 5), { fromStatus: null, agentId: "support" }),
      ev("d1", "delivered", at(thisWeek, 30)),
      ev("d2", "delivered", at(lastWeek, 30)),
    ];
    const m = buildLeadQuality(
      lqInput({
        events,
        qualified: [
          { id: "g1", source: "outbound" },
          { id: "in1", source: "whatsapp" },
        ],
        scores: new Map([
          ["d1", 90],
          ["d2", 86],
        ]),
        conversations: 22,
        target: 10,
        leads: [
          lead("g1", { name: "Brandt Logistik GmbH", fitScore: 91, reasons: ["Size fit"] }),
          lead("in1", { entityType: "person", source: "whatsapp", fitScore: 74, phone: "+4915100000" }),
          lead("g2", { name: "AlphaLog", status: "borderline", fitScore: 58 }),
          // Borderline earlier, accepted since: it is qualified, not listed twice.
          lead("stale", { status: "interested", fitScore: 99 }),
        ],
        rejectReasons: ["Under 20 employees", "Under 20 employees"],
      }),
    );

    const [quality, fromGathered, inbound, delivered] = m.kpis;
    expect(quality).toMatchObject({ value: "90", description: "+4 vs last week", trend: "up" });
    expect(fromGathered).toMatchObject({ value: "1 of 4", description: "25% pass rate" });
    expect(inbound).toMatchObject({ value: "1", description: "From 22 customer-agent conversations" });
    expect(delivered).toMatchObject({ value: "1 of 10", description: "9 more to reach the weekly target" });

    expect(m.rows.map((r) => [r.id, r.fitScore, r.borderline])).toEqual([
      ["g1", 91, false],
      ["in1", 74, false],
      ["g2", 58, true],
    ]);
    expect(m.rows[1]).toMatchObject({ contactName: "+4915100000", companyMeta: "WhatsApp" });
    expect(leadListFooter(m, 3)).toBe("Showing 3 of 3 leads · 2 qualified · 1 borderline");
    expect(m.rejected.reasons).toEqual([{ label: "Under 20 employees", count: 2, pct: 100 }]);
    expect(rejectedSubtitle(m)).toBe("2 of 4 gathered leads · why the qualifier said no");
  });

  it("says when the weekly target is reached", () => {
    const m = buildLeadQuality(lqInput({ target: 1, events: [ev("d1", "delivered", at(thisWeek, 1))] }));
    expect(m.kpis[3]).toMatchObject({ value: "1 of 1", description: "Weekly target reached" });
  });
});

describe("groupRejectReasons", () => {
  it("orders by count, labels missing reasons and folds the tail", () => {
    const reasons = ["a", "a", "a", "b", "b", "c", "d", "e", null, " "];
    expect(groupRejectReasons(reasons)).toEqual([
      { label: "a", count: 3, pct: 30 },
      { label: "b", count: 2, pct: 20 },
      { label: "No reason given", count: 2, pct: 20 },
      { label: "c", count: 1, pct: 10 },
      { label: "Other reasons", count: 2, pct: 20 },
    ]);
  });
});

describe("empty range", () => {
  const base: Pick<OverviewInput, "weeks" | "events" | "qualified" | "conversations" | "tokens"> = {
    weeks,
    events: [],
    qualified: [],
    conversations: 0,
    tokens: { current: 0, previous: 0 },
  };

  it("is empty only when nothing happened in the selected week", () => {
    expect(isEmptyWeek(base)).toBe(true);
    // Activity in an earlier week does not fill this one.
    expect(isEmptyWeek({ ...base, events: [ev("x", "pending", at(lastWeek, 1))] })).toBe(true);
    expect(isEmptyWeek({ ...base, events: [ev("x", "pending", at(thisWeek, 1))] })).toBe(false);
    expect(isEmptyWeek({ ...base, conversations: 1 })).toBe(false);
    expect(isEmptyWeek({ ...base, tokens: { current: 5, previous: 0 } })).toBe(false);
  });

  it("explains a week before the company existed", () => {
    const copy = emptyRangeCopy({
      companyName: "Acme GmbH",
      companyCreatedAt: new Date("2026-09-01T08:00:00Z"),
      week: shiftIsoWeek(new Date("2026-08-05T12:00:00Z"), TZ, 0),
      timeZone: TZ,
    });
    expect(copy.title).toBe("No data for 3–9 Aug");
    expect(copy.description).toContain("on 1 Sep 2026");
    const quiet = emptyRangeCopy({
      companyName: "Acme GmbH",
      companyCreatedAt: new Date("2026-09-01T08:00:00Z"),
      week: thisWeek,
      timeZone: TZ,
    });
    expect(quiet.description).toContain("No leads");
  });

  it("renders dashed KPIs and the back link", () => {
    const html = renderToStaticMarkup(
      h(EmptyRangeView, {
        kpiLabels: OVERVIEW_KPI_LABELS,
        title: "No data for 3–9 Aug",
        description: "d",
        backHref: "/analytics",
      }),
    );
    expect(html.match(/No data for this range yet/g)).toHaveLength(4);
    expect(html).toContain('href="/analytics"');
    expect(html).toContain("Back to this week");
  });
});

describe("LeadQualityView", () => {
  it("renders rows, borderline chip and reject bars", () => {
    const m = buildLeadQuality(
      lqInput({
        qualified: [{ id: "a", source: "outbound" }],
        leads: [lead("a", { name: "Brandt Logistik GmbH", fitScore: 91 }), lead("b", { status: "borderline", fitScore: 58 })],
        rejectReasons: ["Fully remote, no office"],
      }),
    );
    const html = renderToStaticMarkup(h(LeadQualityView, { model: m }));
    expect(html).toContain("Brandt Logistik GmbH");
    expect(html).toContain("Borderline");
    expect(html).toContain("Fully remote, no office");
    expect(html).toContain("1 · 100%");
  });

  it("shows the empty list copy", () => {
    const html = renderToStaticMarkup(h(LeadQualityView, { model: buildLeadQuality(lqInput()) }));
    expect(html).toContain("No qualified leads this week");
    expect(html).toContain("No leads were rejected this week.");
  });
});

describe("report CSV", () => {
  it("exports the overview in long format with a BOM", () => {
    const csv = overviewReportCsv(
      buildOverview({
        timeZone: TZ,
        weeks,
        events: [ev("d1", "delivered", at(thisWeek, 1))],
        customerAgentIds: new Set(),
        qualified: [],
        scores: new Map(),
        tokens: { current: 0, previous: 0 },
        conversations: 3,
        target: 2,
      }),
      "21–27 Sep",
    );
    const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("section,label,value,detail");
    expect(lines[1]).toBe("week,Week,21–27 Sep,");
    expect(lines).toContain("kpi,Qualified leads delivered,1 of 2,Weekly target · 50% reached");
    expect(lines).toContain("Qualified leads delivered per week,W39,1,");
  });

  it("exports lead rows formula-escaped and reject reasons", () => {
    const m = buildLeadQuality(
      lqInput({
        qualified: [{ id: "a", source: "outbound" }],
        leads: [lead("a", { name: "=HYPERLINK(1)", fitScore: 88, reasons: ["Size fit"] })],
        rejectReasons: ["Outside Munich"],
      }),
    );
    const csv = leadQualityReportCsv(m, "21–27 Sep");
    expect(csv).toContain("qualified lead,'=HYPERLINK(1),88,qualified · Size fit");
    expect(csv).toContain("rejected,Outside Munich,1,100%");
  });

  it("names the file and builds the link", () => {
    expect(reportFileName("lead-quality", "2026-09-21")).toBe("analytics-lead-quality-2026-09-21.csv");
    expect(reportExportHref("overview", "this")).toBe("/analytics/export?view=overview");
    expect(reportExportHref("lead-quality", "last")).toBe("/analytics/export?view=lead-quality&week=last");
  });
});
