import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";
import type { MetricKey } from "@/lib/workflows/metrics";

import { AgentMap } from "./agent-map";
import { agentMapMeta, buildAgentMap, type AgentMapAgent, type AgentMapInput } from "./agent-map-model";

// Figma 04 `home/default` agent map (413:52668), Acme copy.
const agent = (id: string, kind: AgentMapAgent["kind"], extra: Partial<AgentMapAgent> = {}): AgentMapAgent => ({
  id,
  name: id,
  kind,
  model: "sonnet",
  isActive: true,
  liveVersion: kind === "operator" ? "v1" : null,
  ...extra,
});

const stage = (id: string, order: number, agentId: string | null, metricKey: MetricKey): WorkflowStageView => ({
  id,
  order,
  name: id,
  agent: agentId ? { id: agentId, name: agentId } : null,
  metricKey,
  metricValue: null,
  pending: 0,
  state: "default",
});

const workflow = (w: Partial<WorkflowView> & Pick<WorkflowView, "id" | "stages">): WorkflowView => ({
  companyId: "c1",
  packageSlug: "revenue",
  name: w.id,
  flow: "sequence",
  position: 0,
  edges: [],
  inbound: null,
  target: null,
  intake: [],
  ...w,
});

const leadEngine = workflow({
  id: "Lead engine",
  position: 0,
  stages: [
    stage("gather", 0, "Lead Gatherer", "records.gathered"),
    stage("qualify", 1, "Lead Qualifier", "records.qualified"),
    stage("outreach", 2, "Mail Marketer", "records.contacted_replied"),
    stage("delivered", 3, null, "leads.qualified_delivered"),
  ],
  edges: [
    { fromStageId: "gather", toStageId: "qualify" },
    { fromStageId: "qualify", toStageId: "outreach" },
    { fromStageId: "outreach", toStageId: "delivered" },
  ],
  inbound: {
    stageId: "qualify",
    leads: 9,
    conversations: 40,
    customerAgents: [
      { id: "Acme Website Assistant", name: "Acme Website Assistant" },
      { id: "Acme Instagram Concierge", name: "Acme Instagram Concierge" },
    ],
  },
});
const social = workflow({
  id: "Social media",
  position: 1,
  flow: "parallel",
  stages: [
    stage("calendar", 0, "Social Media Manager", "posts.scheduled_review"),
    stage("reviews", 1, "Social Media Manager", "reviews.new_negative"),
  ],
});
const insights = workflow({ id: "Insights", position: 2, stages: [stage("analysis", 0, "Market Analyst", "report.next_run")] });

const acme: AgentMapInput = {
  agents: [
    agent("Acme Website Assistant", "customer", { model: "haiku" }),
    agent("Acme Instagram Concierge", "customer", { model: "haiku" }),
    agent("Market Analyst", "operator", { model: "opus" }),
    agent("Social Media Manager", "operator"),
    agent("Mail Marketer", "operator"),
    agent("Lead Qualifier", "operator"),
    agent("Lead Gatherer", "operator", { model: "haiku" }),
  ],
  channels: [
    { agentId: "Acme Website Assistant", type: "widget", active: true },
    { agentId: "Acme Website Assistant", type: "whatsapp", active: true },
    { agentId: "Acme Instagram Concierge", type: "instagram", active: true },
    { agentId: "Acme Instagram Concierge", type: "messenger", active: true },
  ],
  // Out of order on purpose: the map sorts by position.
  workflows: [insights, social, leadEngine],
  hasKnowledgeBase: true,
  hasHandoff: true,
};

describe("buildAgentMap (04 home/default)", () => {
  const model = buildAgentMap(acme)!;

  it("header shows the real workflow count, not the design's 4", () => {
    expect(model.meta).toBe("7 agents · 4 sources · 3 workflows");
    expect(agentMapMeta(1, 0, 1)).toBe("1 agent · 0 sources · 1 workflow");
  });

  it("sources: one node per active channel type, in canvas order", () => {
    expect(model.sources.map((s) => s.source)).toEqual(["website", "whatsapp", "instagram", "messenger"]);
  });

  it("operators stack in stage order so sequence neighbours sit together", () => {
    expect(model.operators.map((o) => o.name)).toEqual([
      "Lead Gatherer",
      "Lead Qualifier",
      "Mail Marketer",
      "Social Media Manager",
      "Market Analyst",
    ]);
    expect(model.operators.map((o) => o.icon)).toEqual(["user", "list-checks", "mail", "megaphone", "trending-up"]);
    expect(model.operators[0]).toMatchObject({ eyebrow: "Claude Haiku", status: { tone: "live", label: "v1 Live" } });
    expect(model.operators[4].eyebrow).toBe("Claude Opus");
  });

  it("edges: sources to customers, teal inbound, sequence loops only between agent stages", () => {
    const keyed = model.edges.map((e) => `${e.from}->${e.to}${e.tone ? ` ${e.tone}` : ""}${e.route ? ` ${e.route}` : ""}`);
    expect(keyed).toEqual([
      "source:website->agent:Acme Website Assistant",
      "source:whatsapp->agent:Acme Website Assistant",
      "source:instagram->agent:Acme Instagram Concierge",
      "source:messenger->agent:Acme Instagram Concierge",
      "agent:Acme Website Assistant->agent:Lead Qualifier active",
      "agent:Acme Instagram Concierge->agent:Lead Qualifier active",
      "agent:Lead Gatherer->agent:Lead Qualifier loop",
      "agent:Lead Qualifier->agent:Mail Marketer loop",
    ]);
  });

  it("parallel workflows and outcome stages draw no agent edges", () => {
    expect(model.edges.some((e) => e.from.includes("Social") || e.to.includes("Social"))).toBe(false);
  });

  it("legend names the inbound agent and this week's leads", () => {
    expect(model.legend).toBe("Teal lines: inbound leads from customer agents to Lead Qualifier · 9 this week");
  });

  it("integrations and live state", () => {
    expect(model.integrations).toEqual(["Knowledge base", "Human handoff"]);
    expect(model.live).toBe(true);
  });

  it("statuses: draft without a live version, paused when inactive", () => {
    const m = buildAgentMap({
      ...acme,
      agents: [agent("a", "operator", { liveVersion: null }), agent("b", "operator", { isActive: false }), agent("c", "customer", { isActive: false })],
      workflows: [],
    })!;
    expect(m.operators.map((o) => o.status.label)).toEqual(["Draft", "Paused"]);
    expect(m.operators[1].paused).toBe(true);
    expect(m.customers[0].status).toEqual({ tone: "neutral", label: "Paused" });
  });

  it("skips inactive channels, unknown agents and the inbound legend without customer agents", () => {
    const m = buildAgentMap({
      ...acme,
      agents: acme.agents.filter((a) => a.kind === "operator"),
      channels: [{ agentId: "ghost", type: "widget", active: true }],
    })!;
    expect(m.sources).toEqual([]);
    expect(m.legend).toBeNull();
    expect(m.edges.every((e) => e.route === "loop")).toBe(true);
  });

  it("returns null without agents", () => {
    expect(buildAgentMap({ ...acme, agents: [] })).toBeNull();
  });
});

describe("AgentMap tile", () => {
  const html = renderToStaticMarkup(h(AgentMap, { model: buildAgentMap(acme)! }));

  it("renders header, three columns, integrations and legend; no zoom controls", () => {
    expect(html).toContain("Agent map");
    expect(html).toContain("7 agents · 4 sources · 3 workflows");
    for (const col of ["sources", "customers", "operators"]) expect(html).toContain(`data-column="${col}"`);
    expect(html).toContain('data-slot="agent-map-integrations"');
    expect(html).toContain("Teal lines: inbound leads");
    expect(html).not.toMatch(/zoom|100%/i);
  });

  it("is read-only: no menus or action buttons on nodes", () => {
    expect(html).not.toContain("<button");
  });

  it("uses the compact agent node", () => {
    expect(html.split('data-slot="canvas-agent-node"').length - 1).toBe(2 * 7);
  });
});
