import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";
import type { NeedsYouItem } from "@/lib/operator/needs-you";

import type { SessionListRow } from "../_sessions/sessions-list";
import {
  briefTitle,
  buildSessionTargets,
  formatCostPerLead,
  recentSessionsSummary,
  stageNote,
  weekRangeLabel,
  type OperatorAgentOption,
} from "./overview-model";
import { OperatorOverview } from "./overview-view";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({
  db: { query: { agentVersions: { findFirst: vi.fn() } } },
}));
vi.mock("@/lib/ai/chat-persistence", () => ({
  createChatSession: vi.fn(),
  saveUserMessage: vi.fn(),
}));
vi.mock("@/lib/operator/access", () => ({
  requireOperatorAgentAccess: vi.fn(),
}));

const { db } = await import("@/db");
const { createChatSession, saveUserMessage } = await import("@/lib/ai/chat-persistence");
const { requireOperatorAgentAccess } = await import("@/lib/operator/access");
const { startOperatorSession } = await import("./actions");

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

const agent = (id: string, name: string, live = true): OperatorAgentOption => ({
  id,
  name,
  version: { id: `v-${id}`, name: "v1", status: live ? "live" : "draft" },
});

const AGENTS = [
  agent("gather", "Lead Gatherer"),
  agent("qualify", "Lead Qualifier"),
  agent("mail", "Mail Marketer"),
  agent("social", "Social Media Manager"),
  agent("analyst", "Market Analyst"),
  agent("loose", "Ops Helper", false),
  { id: "noversion", name: "Empty", version: null },
];

const WORKFLOWS = [
  workflow({
    id: "lead",
    name: "Lead engine",
    position: 0,
    stages: [
      stage({ id: "st-gather", order: 0, name: "Gather", agent: { id: "gather", name: "Lead Gatherer" }, metricKey: "records.gathered", metricValue: 146 }),
      stage({ id: "st-qualify", order: 1, name: "Qualify", agent: { id: "qualify", name: "Lead Qualifier" }, metricKey: "records.qualified", metricValue: 44, pending: 1 }),
      stage({ id: "st-outreach", order: 2, name: "Outreach", agent: { id: "mail", name: "Mail Marketer" }, metricKey: "records.contacted_replied", metricValue: 31 }),
      stage({ id: "st-delivered", order: 3, name: "Delivered to client", agent: null, metricKey: "records.delivered" }),
    ],
  }),
  workflow({
    id: "insights",
    name: "Insights",
    position: 2,
    stages: [stage({ id: "st-analysis", name: "Marketing analysis", agent: { id: "analyst", name: "Market Analyst" }, metricKey: "report.next_run" })],
  }),
  workflow({
    id: "social-wf",
    name: "Social media",
    flow: "parallel",
    position: 1,
    stages: [
      stage({ id: "st-cal", order: 0, name: "Content calendar", agent: { id: "social", name: "Social Media Manager" }, metricKey: "posts.scheduled_review", metricValue: 12 }),
      stage({ id: "st-rev", order: 1, name: "Review management", agent: { id: "social", name: "Social Media Manager" }, metricKey: "reviews.new_negative", metricValue: 5 }),
    ],
  }),
];

describe("buildSessionTargets", () => {
  const groups = buildSessionTargets(WORKFLOWS, AGENTS);

  it("makes Figma's chips: sequence workflow, parallel stages, single-stage workflow, then other agents", () => {
    expect(groups.map((g) => [g.label, g.icon])).toEqual([
      ["Lead engine", "workflow"],
      ["Content calendar", "calendar"],
      ["Review management", "star"],
      ["Marketing analysis", "chart-no-axes-column"],
      ["Other agents", "bot"],
    ]);
  });

  it("lists a sequence workflow's agent stages in order, with version and stage note", () => {
    expect(groups[0].targets.map((t) => [t.label, t.agentName, t.versionId, t.note])).toEqual([
      ["Gather", "Lead Gatherer", "v-gather", "146 gathered this week"],
      ["Qualify", "Lead Qualifier", "v-qualify", "44 qualified · 1 waiting on you"],
      ["Outreach", "Mail Marketer", "v-mail", "31 contacted"],
    ]);
  });

  it("puts agents outside workflows under Other agents and drops agents with no version", () => {
    const other = groups.at(-1)!;
    expect(other.targets.map((t) => [t.agentName, t.versionStatus])).toEqual([["Ops Helper", "draft"]]);
    expect(groups.flatMap((g) => g.targets).some((t) => t.agentId === "noversion")).toBe(false);
  });

  it("returns no groups with no agents", () => {
    expect(buildSessionTargets(WORKFLOWS, [])).toEqual([]);
  });
});

describe("overview formatting", () => {
  it("stageNote skips unknown values", () => {
    expect(stageNote({ metricKey: "report.next_run", metricValue: 3, pending: 0 })).toBeNull();
    expect(stageNote({ metricKey: "records.qualified", metricValue: null, pending: 2 })).toBe("2 waiting on you");
  });

  it("weekRangeLabel formats the ISO week in company time", () => {
    const range = { from: new Date("2026-09-20T22:00:00Z"), to: new Date("2026-09-27T22:00:00Z") };
    expect(weekRangeLabel(range, "Europe/Berlin")).toBe("21–27 Sep 2026");
    const cross = { from: new Date("2026-09-27T22:00:00Z"), to: new Date("2026-10-04T22:00:00Z") };
    expect(weekRangeLabel(cross, "Europe/Berlin")).toBe("28 Sep – 4 Oct 2026");
  });

  it("formatCostPerLead rounds and handles null", () => {
    expect(formatCostPerLead(41.2)).toBe("$41");
    expect(formatCostPerLead(0.854)).toBe("$0.85");
    expect(formatCostPerLead(null)).toBeNull();
  });

  it("recentSessionsSummary and briefTitle", () => {
    expect(recentSessionsSummary(5, 9)).toBe("Latest 5 of 9 · open and finished sessions");
    expect(recentSessionsSummary(0, 0)).toBe("No sessions yet");
    expect(briefTitle("  ")).toBe("Untitled session");
    expect(briefTitle("Re-check leads\nmore detail")).toBe("Re-check leads");
    expect(briefTitle("x".repeat(100))).toHaveLength(80);
  });
});

const now = new Date("2026-09-25T10:00:00Z");

const item = (over: Partial<NeedsYouItem>): NeedsYouItem => ({
  id: "n1",
  type: "failed_run",
  agentId: "gather",
  agentName: "Lead Gatherer",
  title: "Google Places quota reached",
  createdAt: new Date("2026-09-25T04:00:00Z"),
  chatId: null,
  cronRunId: "r1",
  cronJobId: "j1",
  tier: 1,
  href: "/operator?tab=cron&jobId=j1&runId=r1",
  workflow: "Lead engine",
  ...over,
});

const session = (over: Partial<SessionListRow>): SessionListRow => ({
  id: "c1",
  title: "Lead re-check",
  status: "running",
  agentId: "qualify",
  agentName: "Lead Qualifier",
  versionId: "v1",
  versionName: "v1",
  versionStatus: "live",
  workflowIds: ["lead"],
  workflowLabel: "Lead engine · Qualify",
  starterName: "Talha Bera",
  createdAt: new Date("2026-09-25T09:00:00Z"),
  lastActivityAt: new Date("2026-09-25T09:58:00Z"),
  openCheckpoints: 0,
  runId: null,
  scheduleName: null,
  ...over,
});

function renderOverview(over: Partial<Parameters<typeof OperatorOverview>[0]> = {}) {
  return renderToStaticMarkup(
    h(OperatorOverview, {
      companyName: "Acme GmbH",
      timeZone: "Europe/Berlin",
      now,
      needsYou: {
        items: [item({}), item({ id: "n2", type: "agent_question", title: "Include offices under 20 employees?", tier: 2 })],
        total: 2,
      },
      kpis: {
        weekId: "2026-W39",
        range: { from: new Date("2026-09-20T22:00:00Z"), to: new Date("2026-09-27T22:00:00Z") },
        timeZone: "Europe/Berlin",
        qualifiedDelivered: 6,
        inbound: 9,
        qualityScore: 82,
        costPerQualifiedLead: { tokens: 1, tokensPerLead: 1, estimatedUsdPerLead: 41 },
      },
      leadTarget: 10,
      recent: [session({}), session({ id: "c2", title: "Autumn outreach", status: "needs_you" })],
      totalSessions: 9,
      newSession: h("button", { type: "button" }, "New session"),
      ...over,
    }),
  );
}

describe("OperatorOverview", () => {
  it("renders the Needs you column in server order with the count", () => {
    const html = renderOverview();
    expect(html).toContain('data-slot="needs-you-list"');
    expect(html.indexOf("Google Places quota reached")).toBeLessThan(html.indexOf("Include offices under 20 employees?"));
    expect(html).toContain("6h ago");
  });

  it("renders the Workflows header with week, KPI strip and New session slot", () => {
    const html = renderOverview();
    expect(html).toContain("Acme GmbH · Week 21–27 Sep 2026");
    expect(html).toContain('data-slot="goal-strip"');
    expect(html).toContain("$41");
    expect(html).toContain("New session");
  });

  it("hides the KPI strip without a lead target", () => {
    expect(renderOverview({ leadTarget: null })).not.toContain('data-slot="goal-strip"');
  });

  it("renders Recent sessions linking to the session and to the Sessions tab", () => {
    const html = renderOverview();
    expect(html).toContain("Latest 2 of 9 · open and finished sessions");
    expect(html).toContain('href="/operator?chatId=c1"');
    expect(html).toContain('href="/operator?tab=sessions"');
  });

  it("shows empty states", () => {
    const html = renderOverview({ needsYou: { items: [], total: 0 }, recent: [], totalSessions: 0 });
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).toContain('data-slot="recent-sessions-empty"');
  });
});

describe("startOperatorSession", () => {
  const agentId = "660e8400-e29b-41d4-a716-446655440001";
  const versionId = "770e8400-e29b-41d4-a716-446655440002";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      session: { user: { id: "user-1" } },
      agent: { companyId: "co-1" },
    } as never);
    vi.mocked(createChatSession).mockResolvedValue("chat-1");
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({ id: versionId, agentId } as never);
  });

  it("creates the session titled from the brief and saves the brief as the first message", async () => {
    const result = await startOperatorSession({ agentId, versionId, brief: "  Re-check leads\nin Munich  " });
    expect(createChatSession).toHaveBeenCalledWith("user-1", "co-1", agentId, "Re-check leads", undefined, "operator", versionId);
    expect(saveUserMessage).toHaveBeenCalledWith("chat-1", "Re-check leads\nin Munich");
    expect(result).toEqual({ chatId: "chat-1", agentId, versionId });
  });

  it("starts an untitled session without a message when the brief is empty", async () => {
    await startOperatorSession({ agentId, versionId, brief: "" });
    expect(createChatSession).toHaveBeenCalledWith("user-1", "co-1", agentId, "Untitled session", undefined, "operator", versionId);
    expect(saveUserMessage).not.toHaveBeenCalled();
  });

  it("rejects a version of another agent", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({ id: versionId, agentId: "other" } as never);
    await expect(startOperatorSession({ agentId, versionId })).rejects.toThrow("Version not found");
    expect(createChatSession).not.toHaveBeenCalled();
  });
});
