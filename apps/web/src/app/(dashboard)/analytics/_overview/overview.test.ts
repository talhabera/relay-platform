import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CampaignMetric } from "@/lib/metrics/campaigns";
import type { LeadEventFact } from "@/lib/metrics/compute";
import { shiftIsoWeek } from "@/lib/time";

import {
  adCampaignRows,
  buildOverview,
  formatRate,
  isoWeekLabel,
  parseAnalyticsView,
  parseWeekChoice,
  signedDelta,
  TREND_WEEKS,
  weekChoiceLabel,
  weekDaysLabel,
  type OverviewInput,
} from "./overview-model";
import { CampaignTable } from "./overview-view";
import { overviewReportCsv } from "./report-csv";

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

function input(over: Partial<OverviewInput> = {}): OverviewInput {
  return {
    timeZone: TZ,
    weeks,
    events: [],
    customerAgentIds: new Set(["support"]),
    qualified: [],
    scores: new Map(),
    tokens: { current: 0, previous: 0 },
    conversations: 0,
    target: null,
    ...over,
  };
}

describe("labels", () => {
  it("formats the week range in company time", () => {
    expect(weekDaysLabel(thisWeek, TZ)).toBe("21–27 Sep");
    expect(weekChoiceLabel("this", thisWeek, TZ)).toBe("This week · 21–27 Sep");
    const across = shiftIsoWeek(NOW, TZ, 1);
    expect(weekDaysLabel(across, TZ)).toBe("28 Sep – 4 Oct");
  });

  it("names ISO weeks", () => {
    expect(isoWeekLabel(thisWeek, TZ)).toBe("W39");
    expect(isoWeekLabel(weeks[0], TZ)).toBe("W33");
    expect(isoWeekLabel(shiftIsoWeek(new Date("2027-01-01T12:00:00Z"), TZ, 0), TZ)).toBe("W53");
  });

  it("formats rates and deltas like the design", () => {
    expect(formatRate(9, 31)).toBe("29%");
    expect(formatRate(64, 2480)).toBe("2.6%");
    expect(formatRate(1, 0)).toBeNull();
    expect(signedDelta(4)).toBe("+4");
    expect(signedDelta(-6, "$")).toBe("−$6");
    expect(signedDelta(0)).toBeNull();
  });

  it("parses search params with safe defaults", () => {
    expect(parseAnalyticsView(undefined)).toBe("overview");
    expect(parseAnalyticsView("agents")).toBe("agents");
    expect(parseAnalyticsView("marketing")).toBe("overview"); // not shipped yet
    expect(parseWeekChoice("last")).toBe("last");
    expect(parseWeekChoice("nonsense")).toBe("this");
  });
});

describe("buildOverview", () => {
  it("renders zeros and empty states with no data", () => {
    const m = buildOverview(input());
    expect(m.kpis.map((k) => k.value)).toEqual(["0", null, null, "0"]);
    expect(m.kpis[0].description).toBe("No weekly target set");
    expect(m.campaigns).toEqual([]);
    expect(m.charts[1].data).toMatchObject({ type: "line" });
    expect(m.charts[1].comparison).toBe("same as last week");
  });

  it("counts the lead engine, target, quality, cost and origin", () => {
    const events: LeadEventFact[] = [
      // Gathered this week: g1..g3 (creations by a non-customer agent).
      ev("g1", "pending", at(thisWeek, 1), { fromStatus: null }),
      ev("g2", "pending", at(thisWeek, 2), { fromStatus: null }),
      ev("g3", "gathered", at(thisWeek, 3)),
      // Outreach: g1 contacted + replied, g2 contacted.
      ev("g1", "contacted", at(thisWeek, 10)),
      ev("g1", "replied", at(thisWeek, 20)),
      ev("g2", "contacted", at(thisWeek, 11)),
      // Inbound lead created by a customer agent.
      ev("in1", "qualified", at(thisWeek, 5), { fromStatus: null, agentId: "support" }),
      // Delivered: d1 this week, d2 last week, d3 earlier and again this week (counts once, earlier).
      ev("d1", "delivered", at(thisWeek, 30)),
      ev("d2", "delivered", at(lastWeek, 30)),
      ev("d3", "delivered", at(weeks[0], 30)),
      ev("d3", "delivered", at(thisWeek, 31)),
    ];
    const m = buildOverview(
      input({
        events,
        qualified: [
          { id: "g1", source: "outbound" },
          { id: "in1", source: "whatsapp" },
          { id: "x", source: null },
        ],
        scores: new Map([
          ["d1", 86],
          ["d2", 80],
        ]),
        tokens: { current: 2_000_000, previous: 3_000_000 },
        conversations: 22,
        target: 4,
      }),
    );

    const [delivered, quality, cost, conversations] = m.kpis;
    expect(delivered).toMatchObject({ value: "1 of 4", description: "Weekly target · 25% reached" });
    expect(quality).toMatchObject({ value: "86", description: "+6 vs last week", trend: "up" });
    // $12 this week vs $18 last week: lower is better.
    expect(cost).toMatchObject({ value: "$12", description: "−$6 vs last week · estimate", trend: "up" });
    expect(conversations).toMatchObject({ value: "22", description: "1 became inbound lead" });

    const [funnel, trend, origin] = m.charts;
    expect(funnel.title).toBe("Lead engine · 21–27 Sep");
    expect(funnel.data).toEqual({
      type: "funnel",
      stages: [
        { label: "Gathered", value: 3 },
        { label: "Qualified", value: 3, note: "incl. 1 inbound" },
        { label: "Outreach", value: 2, note: "1 replied" },
        { label: "Delivered", value: 1, note: "target 4" },
      ],
    });
    expect(trend.data).toMatchObject({
      type: "line",
      points: [
        { label: "W33", value: 1 },
        { label: "W34", value: 0 },
        { label: "W35", value: 0 },
        { label: "W36", value: 0 },
        { label: "W37", value: 0 },
        { label: "W38", value: 1 },
        { label: "W39", value: 1 },
      ],
    });
    expect(origin).toMatchObject({ value: "3", delta: "1 inbound", comparison: "2 gathered" });

    expect(m.campaigns).toEqual([
      {
        id: "lead-engine-outreach",
        name: "Lead engine outreach",
        channel: "email",
        channelLabel: "Email",
        reached: "2 contacted",
        responses: "1 reply",
        rate: "50%",
      },
    ]);
  });
});

describe("CampaignTable", () => {
  it("shows an empty state without campaigns", () => {
    const html = renderToStaticMarkup(h(CampaignTable, { title: "Marketing performance · this week", rows: [] }));
    expect(html).toContain("No campaign activity");
  });

  it("renders a row per campaign", () => {
    const html = renderToStaticMarkup(
      h(CampaignTable, {
        title: "Marketing performance · this week",
        rows: [
          {
            id: "c",
            name: "Lead engine outreach",
            channel: "email",
            channelLabel: "Email",
            reached: "31 contacted",
            responses: "9 replies",
            rate: "29%",
          },
        ],
      }),
    );
    expect(html).toContain("Lead engine outreach");
    expect(html).toContain("31 contacted");
    expect(html).toContain("29%");
  });
});

describe("ad campaigns (S84)", () => {
  const metrics: CampaignMetric[] = [
    { id: "ad:1202", kind: "ad", name: "Mutfak yenileme", source: "whatsapp", leads: 12, qualified: 5 },
    { id: "kod:banyo24", kind: "kod", name: "Code BANYO24", source: "widget", leads: 1, qualified: 0 },
    { id: "url:x", kind: "ad", name: "https://fb.me/x", source: null, leads: 2, qualified: 1 },
  ];

  it("formats leads per campaign as table rows", () => {
    expect(adCampaignRows(metrics)).toEqual([
      {
        id: "ad:1202",
        name: "Mutfak yenileme",
        channel: "whatsapp",
        channelLabel: "WhatsApp ad",
        reached: "12 leads",
        responses: "5 qualified",
        rate: "42%",
      },
      {
        id: "kod:banyo24",
        name: "Code BANYO24",
        channel: "website",
        channelLabel: "Website",
        reached: "1 lead",
        responses: "0 qualified",
        rate: "0.0%",
      },
      {
        id: "url:x",
        name: "https://fb.me/x",
        channel: "whatsapp",
        channelLabel: "WhatsApp ad",
        reached: "2 leads",
        responses: "1 qualified",
        rate: "50%",
      },
    ]);
  });

  it("lists ad campaigns after outreach on the overview and in the CSV export", () => {
    const m = buildOverview(
      input({
        events: [ev("o1", "contacted", at(thisWeek, 1)), ev("o1", "replied", at(thisWeek, 2))],
        campaigns: adCampaignRows(metrics.slice(0, 1)),
      }),
    );
    expect(m.campaigns.map((c) => c.id)).toEqual(["lead-engine-outreach", "ad:1202"]);

    const csv = overviewReportCsv(m, "21–27 Sep");
    expect(csv).toContain("campaign,Mutfak yenileme,12 leads,WhatsApp ad · 5 qualified · 42%");
  });
});
