import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { listWorkflows } from "@/lib/workflows";
import { dbMetricSource, getCanvasStats, getCompanyKpis } from ".";

const COMPANY = "co-1";
const OWNER = "owner-1";
const WIDGET = "agent-widget";
const GATHERER = "agent-gatherer";
const QUALIFIER = "agent-qualifier";
// Wednesday 7 Oct 2026; Istanbul week = [4 Oct 21:00Z, 11 Oct 21:00Z).
const NOW = new Date("2026-10-07T12:00:00Z");

const leadEventsFindMany = vi.fn();
const handoffFindMany = vi.fn();
const tokenUsageFindMany = vi.fn();

function event(
  recordId: string,
  toStatus: string,
  at: string,
  over: { fromStatus?: string | null; agentId?: string | null; userId?: string | null } = {},
) {
  return {
    recordId,
    fromStatus: "pending",
    toStatus,
    agentId: QUALIFIER,
    userId: null,
    at: new Date(at),
    ...over,
  };
}

const EVENTS = [
  event("g1", "pending", "2026-10-05T06:00:00Z", { fromStatus: null, agentId: GATHERER }),
  // Sunday 23:30 Istanbul: last week, though `to` is past the UTC midnight.
  event("g0", "pending", "2026-10-04T20:30:00Z", { fromStatus: null, agentId: GATHERER }),
  event("in1", "pending", "2026-10-05T07:00:00Z", { fromStatus: null, agentId: WIDGET }),
  event("q1", "qualified", "2026-10-05T08:00:00Z"),
  event("q1", "delivered", "2026-10-06T08:00:00Z"),
  event("q2", "delivered", "2026-10-06T09:00:00Z"),
  // Delivered before this week, again this week: not counted.
  event("old", "delivered", "2026-09-29T09:00:00Z"),
  event("old", "delivered", "2026-10-06T10:00:00Z", { fromStatus: "delivered" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  const query = db.query as unknown as Record<string, unknown>;
  query.leadEvents = { findMany: leadEventsFindMany };
  query.handoffRequests = { findMany: handoffFindMany };
  query.tokenUsage = { findFirst: vi.fn(), findMany: tokenUsageFindMany };
  vi.mocked(db.query.companies.findFirst).mockResolvedValue({
    id: COMPANY,
    timezone: "Europe/Istanbul",
    ownerId: OWNER,
  } as never);
  leadEventsFindMany.mockResolvedValue(EVENTS);
  vi.mocked(db.query.agents.findMany).mockResolvedValue([
    { id: WIDGET, kind: "customer" },
    { id: GATHERER, kind: "operator" },
    { id: QUALIFIER, kind: "operator" },
  ] as never);
  vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([
    { id: "q1", score: 82 },
    { id: "q2", score: 71 },
  ] as never);
  vi.mocked(db.query.chats.findMany).mockResolvedValue([
    { agentId: WIDGET, channelType: "widget" },
    { agentId: WIDGET, channelType: "whatsapp" },
    { agentId: WIDGET, channelType: "web" },
    { agentId: QUALIFIER, channelType: "operator" },
    { agentId: null, channelType: "master" },
  ] as never);
  handoffFindMany.mockResolvedValue([{ id: "h1" }, { id: "h2" }]);
  vi.mocked(db.query.channels.findMany).mockResolvedValue([{ id: "ch-1" }] as never);
  vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
    { userId: "member-1" },
  ] as never);
  tokenUsageFindMany.mockResolvedValue([{ tokensUsed: 900_000 }, { tokensUsed: 100_000 }]);
});

describe("dbMetricSource", () => {
  it("implements every key that has a data source, week-to-date in company time", async () => {
    const values = await dbMetricSource.getValues(
      COMPANY,
      [
        "records.gathered",
        "records.qualified",
        "records.contacted_replied",
        "records.delivered",
        "leads.qualified_delivered",
        "leads.inbound",
        "leads.quality_score",
        "conversations.started",
        "handoff.staff_answers",
        "posts.scheduled_review",
        "reviews.new_negative",
        "report.next_run",
      ],
      NOW,
    );
    expect(values).toEqual({
      "records.gathered": 1,
      "records.qualified": 1,
      "records.contacted_replied": 0,
      "records.delivered": 2,
      "leads.qualified_delivered": 2,
      "leads.inbound": 1,
      "leads.quality_score": 77,
      "conversations.started": 2,
      "handoff.staff_answers": 2,
    });
  });

  it("returns only the keys asked for and skips untouched sources", async () => {
    const values = await dbMetricSource.getValues(
      COMPANY,
      ["conversations.started"],
      NOW,
    );
    expect(values).toEqual({ "conversations.started": 2 });
    expect(leadEventsFindMany).not.toHaveBeenCalled();
    expect(handoffFindMany).not.toHaveBeenCalled();
  });

  it("leaves the quality score out when nothing scored was delivered", async () => {
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([
      { id: "q1", score: null },
      { id: "q2", score: null },
    ] as never);
    const values = await dbMetricSource.getValues(
      COMPANY,
      ["leads.quality_score", "leads.qualified_delivered"],
      NOW,
    );
    expect(values).toEqual({ "leads.qualified_delivered": 2 });
  });

  it("falls back to UTC weeks for an invalid stored timezone", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue({
      id: COMPANY,
      timezone: "Not/AZone",
      ownerId: OWNER,
    } as never);
    // In UTC the Sunday 20:30Z creation is last week too, so the count holds.
    const values = await dbMetricSource.getValues(COMPANY, ["records.gathered"], NOW);
    expect(values).toEqual({ "records.gathered": 1 });
  });

  it("returns nothing for an unknown company", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined as never);
    await expect(
      dbMetricSource.getValues(COMPANY, ["records.gathered"], NOW),
    ).resolves.toEqual({});
  });

  it("feeds weekly target progress on the workflow", async () => {
    const workflowsFindMany = vi.fn().mockResolvedValue([
      {
        id: "wf-lead",
        companyId: COMPANY,
        packageSlug: "lead_engine",
        name: "Lead engine",
        flow: "sequence",
        position: 0,
        weeklyTarget: 10,
        targetMetricKey: "leads.qualified_delivered",
        inboundStageId: null,
        intake: [],
        stages: [
          { id: "s1", order: 0, name: "Gather", agentId: GATHERER, metricKey: "records.gathered", agent: { id: GATHERER, name: "Lead Gatherer" } },
        ],
      },
    ]);
    (db.query as unknown as Record<string, unknown>).workflows = {
      findMany: workflowsFindMany,
      findFirst: vi.fn(),
    };
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    const [lead] = await listWorkflows(COMPANY, { metrics: dbMetricSource, now: NOW });
    expect(lead.target).toEqual({
      weeklyTarget: 10,
      metricKey: "leads.qualified_delivered",
      value: 2,
    });
    expect(lead.stages[0].metricValue).toBe(1);
  });
});

describe("getCompanyKpis", () => {
  it("reports delivered, quality and cost per qualified lead for the week", async () => {
    const kpis = await getCompanyKpis(COMPANY, NOW);
    expect(kpis).toMatchObject({
      weekId: "2026-W41",
      timeZone: "Europe/Istanbul",
      qualifiedDelivered: 2,
      inbound: 1,
      qualityScore: 77,
      costPerQualifiedLead: {
        tokens: 1_000_000,
        tokensPerLead: 500_000,
        estimatedUsdPerLead: 3,
      },
    });
    expect(kpis?.range.from.toISOString()).toBe("2026-10-04T21:00:00.000Z");
    expect(tokenUsageFindMany).toHaveBeenCalledTimes(1);
  });

  it("has no cost per lead when nothing was delivered", async () => {
    leadEventsFindMany.mockResolvedValue([]);
    const kpis = await getCompanyKpis(COMPANY, NOW);
    expect(kpis?.qualifiedDelivered).toBe(0);
    expect(kpis?.qualityScore).toBeNull();
    expect(kpis?.costPerQualifiedLead).toBeNull();
  });
});

describe("getCanvasStats", () => {
  it("counts chats and leads per agent this week", async () => {
    const stats = await getCanvasStats(COMPANY, NOW);
    expect(stats).toEqual({
      weekId: "2026-W41",
      agents: {
        [WIDGET]: { chats: 3, leads: 1 },
        [GATHERER]: { chats: 0, leads: 1 },
        [QUALIFIER]: { chats: 1, leads: 3 },
      },
    });
  });
});
