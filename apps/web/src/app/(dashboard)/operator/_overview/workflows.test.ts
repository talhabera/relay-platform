import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";

import type { OperatorAgentOption } from "./overview-model";
import { WorkflowsCanvas } from "./workflows-canvas";
import { buildWorkflowLanes, stageCount } from "./workflows-model";

// Figma 05 `operator-home/default` (411:30197), Acme copy.
const stage = (over: Partial<WorkflowStageView>): WorkflowStageView => ({
  id: "s",
  order: 0,
  name: "Stage",
  agent: null,
  metricKey: "records.gathered",
  metricValue: null,
  pending: 0,
  state: "default",
  ...over,
});

const workflow = (over: Partial<WorkflowView>): WorkflowView => ({
  id: "w",
  companyId: "c",
  packageSlug: "lead-engine",
  name: "Workflow",
  flow: "sequence",
  position: 0,
  stages: [],
  edges: [],
  inbound: null,
  target: null,
  intake: [],
  ...over,
});

const agent = (id: string, name: string, status: "live" | "draft" = "live"): OperatorAgentOption => ({
  id,
  name,
  version: { id: `v-${id}`, name: "v1", status },
});

const AGENTS = [
  agent("gather", "Lead Gatherer"),
  agent("qualify", "Lead Qualifier"),
  agent("mail", "Mail Marketer", "draft"),
  agent("social", "Social Media Manager"),
  agent("analyst", "Market Analyst"),
];

const lead = workflow({
  id: "lead",
  name: "Lead engine",
  position: 0,
  stages: [
    stage({ id: "delivered", order: 3, name: "Delivered to client", metricKey: "leads.qualified_delivered", metricValue: 6 }),
    stage({ id: "gather", order: 0, name: "Gather", agent: { id: "gather", name: "Lead Gatherer" }, metricValue: 146, pending: 1 }),
    stage({ id: "qualify", order: 1, name: "Qualify", agent: { id: "qualify", name: "Lead Qualifier" }, metricKey: "records.qualified", metricValue: 44 }),
    stage({ id: "outreach", order: 2, name: "Outreach", agent: { id: "mail", name: "Mail Marketer" }, metricKey: "records.contacted_replied", metricValue: 31 }),
  ],
  edges: [
    { fromStageId: "gather", toStageId: "qualify" },
    { fromStageId: "qualify", toStageId: "outreach" },
    { fromStageId: "outreach", toStageId: "delivered" },
  ],
  inbound: {
    stageId: "qualify",
    leads: 9,
    conversations: 22,
    customerAgents: [
      { id: "web", name: "Acme Website Assistant" },
      { id: "ig", name: "Acme Instagram Concierge" },
    ],
  },
  target: { weeklyTarget: 10, metricKey: "leads.qualified_delivered", value: 6 },
});

const social = workflow({
  id: "social",
  name: "Social media",
  flow: "parallel",
  position: 1,
  stages: [
    stage({ id: "cal", order: 0, name: "Content calendar", agent: { id: "social", name: "Social Media Manager" }, metricKey: "posts.scheduled_review", metricValue: 12 }),
    stage({ id: "rev", order: 1, name: "Review management", agent: { id: "social", name: "Social Media Manager" }, metricKey: "reviews.new_negative", metricValue: 5 }),
  ],
});

const insights = workflow({
  id: "insights",
  name: "Insights",
  position: 2,
  stages: [stage({ id: "analysis", name: "Marketing analysis", agent: { id: "analyst", name: "Market Analyst" }, metricKey: "report.next_run", state: "idle" })],
});

describe("buildWorkflowLanes (05 operator-home/default)", () => {
  const lanes = buildWorkflowLanes([insights, social, lead], AGENTS);

  it("one lane per workflow by position, with icon, path and width", () => {
    expect(lanes.map((l) => [l.name, l.icon, l.path, l.wide])).toEqual([
      ["Lead engine", "workflow", "Gather → Qualify → Outreach → Delivered to client", true],
      ["Social media", "megaphone", "Content calendar · Review management", false],
      ["Insights", "chart-no-axes-column", "Marketing analysis", false],
    ]);
  });

  it("stages are columns in order; the inbound node sits under the stage before the inbound stage", () => {
    expect(lanes[0].columns.map((c) => c.nodes.map((n) => n.type))).toEqual([
      ["stage", "inbound"],
      ["stage"],
      ["stage"],
      ["outcome"],
    ]);
  });

  it("stage nodes carry the agent's version, metric line and needs-you state", () => {
    const [gather, qualify, outreach] = lanes[0].columns.map((c) => c.nodes[0]);
    expect(gather).toMatchObject({
      name: "Gather",
      agent: { name: "Lead Gatherer", version: "v1", status: "live" },
      count: "146 gathered",
      state: "needs_you",
      pending: 1,
    });
    expect(qualify).toMatchObject({ count: "44 qualified", state: "default" });
    expect(outreach).toMatchObject({ agent: { status: "draft" }, count: "31 contacted" });
  });

  it("outcome stage counts the weekly target", () => {
    expect(lanes[0].columns[3].nodes[0]).toMatchObject({ type: "outcome", name: "Delivered to client", count: "6 of 10 this week" });
  });

  it("inbound node summarises customer agents, leads and conversations", () => {
    expect(lanes[0].columns[0].nodes[1]).toMatchObject({
      type: "inbound",
      agents: "2 customer agents",
      line: "9 leads from 22 conversations",
    });
  });

  it("edges: sequence stages plus a teal inbound edge; parallel and single-stage lanes draw none", () => {
    expect(lanes[0].edges.map((e) => `${e.from}->${e.to}${e.tone ? ` ${e.tone}` : ""}`)).toEqual([
      "stage:gather->stage:qualify",
      "stage:qualify->stage:outreach",
      "stage:outreach->stage:delivered",
      "inbound:lead->stage:qualify active",
    ]);
    expect(lanes[1].edges).toEqual([]);
    expect(lanes[2].edges).toEqual([]);
  });

  it("an inbound first stage gets its own column; a deleted agent keeps the stage with no agent", () => {
    const [lane] = buildWorkflowLanes(
      [
        workflow({
          stages: [stage({ id: "a", name: "Qualify", metricKey: "records.qualified" })],
          inbound: { stageId: "a", leads: 1, conversations: 1, customerAgents: [{ id: "x", name: "X" }] },
        }),
      ],
      [],
    );
    expect(lane.columns.map((c) => c.id)).toEqual(["inbound", "a"]);
    expect(lane.columns[0].nodes[0]).toMatchObject({ agents: "1 customer agent", line: "1 lead from 1 conversation" });
    expect(lane.columns[1].nodes[0]).toMatchObject({ type: "stage", agent: null, count: "No data yet" });
  });

  it("skips workflows without stages", () => {
    expect(buildWorkflowLanes([workflow({ stages: [] })], AGENTS)).toEqual([]);
  });

  it("stageCount formats known keys and falls back to the number", () => {
    expect(stageCount({ metricKey: "reviews.new_negative", metricValue: 5 })).toBe("5 new");
    expect(stageCount({ metricKey: "leads.inbound", metricValue: 3 })).toBe("3");
    expect(stageCount({ metricKey: "report.next_run", metricValue: null })).toBe("No data yet");
  });
});

describe("WorkflowsCanvas", () => {
  it("renders a collapsible lane per workflow with stage, inbound and outcome nodes; no zoom", () => {
    const html = renderToStaticMarkup(h(WorkflowsCanvas, { lanes: buildWorkflowLanes([lead, social, insights], AGENTS) }));
    expect(html.match(/data-slot="workflow-lane"/g)).toHaveLength(3);
    expect(html).toContain("<details open");
    expect(html).toContain("Gather → Qualify → Outreach → Delivered to client");
    expect(html).toContain('data-slot="workflow-stage-node"');
    expect(html).toContain("Inbound from customer agents");
    expect(html).toContain("6 of 10 this week");
    expect(html).toContain('data-canvas-node="stage:qualify"');
    expect(html).not.toMatch(/zoom/i);
  });

  it("shows an empty state without workflows", () => {
    expect(renderToStaticMarkup(h(WorkflowsCanvas, { lanes: [] }))).toContain("No workflows yet");
  });
});
