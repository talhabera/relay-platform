import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { createFixtureReaders } from "@/lib/fixtures";
import { FIXTURE_IDS, fixtureData } from "@/lib/fixtures/data";
import {
  buildWorkflowViews,
  createWorkflowsReader,
  insertWorkflow,
  listLeadWorkflowAgentIds,
  listWorkflows,
  metricKeysFor,
  WorkflowDefinitionError,
  type MetricSource,
  type WorkflowDefinition,
  type WorkflowExecutor,
  type WorkflowRow,
} from ".";

const COMPANY = "company-1";
const GATHERER = { id: "agent-gatherer", name: "Lead Gatherer" };
const QUALIFIER = { id: "agent-qualifier", name: "Lead Qualifier" };
const MAILER = { id: "agent-mailer", name: "Mail Marketer" };
const SOCIAL = { id: "agent-social", name: "Social Media Manager" };
const WIDGET = { id: "agent-widget", name: "Website assistant" };

function leadEngineRow(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-lead",
    companyId: COMPANY,
    packageSlug: "lead_engine",
    name: "Lead engine",
    flow: "sequence",
    position: 0,
    weeklyTarget: 10,
    targetMetricKey: "leads.qualified_delivered",
    inboundStageId: "st-qualify",
    intake: [{ key: "name", label: "Name", required: true }],
    stages: [
      // Stored out of order on purpose: the reader sorts by `order`.
      { id: "st-outreach", order: 2, name: "Outreach", agentId: MAILER.id, metricKey: "records.contacted_replied", agent: MAILER },
      { id: "st-gather", order: 0, name: "Gather", agentId: GATHERER.id, metricKey: "records.gathered", agent: GATHERER },
      { id: "st-qualify", order: 1, name: "Qualify", agentId: QUALIFIER.id, metricKey: "records.qualified", agent: QUALIFIER },
      { id: "st-delivered", order: 3, name: "Delivered to client", agentId: null, metricKey: "records.delivered", agent: null },
    ],
    ...over,
  };
}

function socialRow(over: Partial<WorkflowRow> = {}): WorkflowRow {
  return {
    id: "wf-social",
    companyId: COMPANY,
    packageSlug: "social_media",
    name: "Social media",
    flow: "parallel",
    position: 1,
    weeklyTarget: null,
    targetMetricKey: null,
    inboundStageId: null,
    intake: [],
    stages: [
      { id: "st-calendar", order: 0, name: "Content calendar", agentId: SOCIAL.id, metricKey: "posts.scheduled_review", agent: SOCIAL },
      { id: "st-reviews", order: 1, name: "Review management", agentId: SOCIAL.id, metricKey: "reviews.new_negative", agent: SOCIAL },
    ],
    ...over,
  };
}

const emptyInputs = {
  metrics: {},
  pendingByAgent: new Map<string, number>(),
  activeAgentIds: new Set<string>(),
  customerAgents: [],
};

describe("buildWorkflowViews", () => {
  it("orders lanes by position and stages by order", () => {
    const views = buildWorkflowViews({
      ...emptyInputs,
      rows: [socialRow(), leadEngineRow()],
    });
    expect(views.map((w) => w.name)).toEqual(["Lead engine", "Social media"]);
    expect(views[0].stages.map((s) => s.name)).toEqual([
      "Gather",
      "Qualify",
      "Outreach",
      "Delivered to client",
    ]);
  });

  it("draws edges between consecutive stages of a sequence, none for parallel", () => {
    const [lead, social] = buildWorkflowViews({
      ...emptyInputs,
      rows: [leadEngineRow(), socialRow()],
    });
    expect(lead.edges).toEqual([
      { fromStageId: "st-gather", toStageId: "st-qualify" },
      { fromStageId: "st-qualify", toStageId: "st-outreach" },
      { fromStageId: "st-outreach", toStageId: "st-delivered" },
    ]);
    expect(social.edges).toEqual([]);
  });

  it("fills stage values from the metric source and null when a key has no data", () => {
    const [lead] = buildWorkflowViews({
      ...emptyInputs,
      rows: [leadEngineRow()],
      metrics: { "records.gathered": 42, "records.qualified": 12 },
    });
    expect(lead.stages.map((s) => s.metricValue)).toEqual([42, 12, null, null]);
  });

  it("renders an outcome stage and a deleted agent as No agent", () => {
    const row = leadEngineRow();
    row.stages[0] = { ...row.stages[0], agentId: null, agent: null };
    const [lead] = buildWorkflowViews({ ...emptyInputs, rows: [row] });
    const outreach = lead.stages.find((s) => s.id === "st-outreach")!;
    expect(outreach.agent).toBeNull();
    expect(lead.stages.find((s) => s.id === "st-delivered")!.agent).toBeNull();
    expect(outreach.state).toBe("default");
  });

  it("derives pending badges and state per agent; one agent may run several stages", () => {
    const [, social] = buildWorkflowViews({
      ...emptyInputs,
      rows: [leadEngineRow(), socialRow()],
      pendingByAgent: new Map([[SOCIAL.id, 2]]),
      activeAgentIds: new Set([QUALIFIER.id, SOCIAL.id]),
    });
    expect(social.stages.map((s) => [s.pending, s.state])).toEqual([
      [2, "needs_you"],
      [2, "needs_you"],
    ]);
    const [lead] = buildWorkflowViews({
      ...emptyInputs,
      rows: [leadEngineRow()],
      activeAgentIds: new Set([QUALIFIER.id]),
    });
    expect(lead.stages.map((s) => s.state)).toEqual([
      "default",
      "active",
      "default",
      "default",
    ]);
  });

  it("summarises inbound on the inbound stage and target progress on the workflow", () => {
    const [lead, social] = buildWorkflowViews({
      ...emptyInputs,
      rows: [leadEngineRow(), socialRow()],
      metrics: {
        "leads.inbound": 4,
        "conversations.started": 31,
        "leads.qualified_delivered": 6,
      },
      customerAgents: [WIDGET],
    });
    expect(lead.inbound).toEqual({
      stageId: "st-qualify",
      leads: 4,
      conversations: 31,
      customerAgents: [WIDGET],
    });
    expect(lead.target).toEqual({
      weeklyTarget: 10,
      metricKey: "leads.qualified_delivered",
      value: 6,
    });
    expect(social.inbound).toBeNull();
    expect(social.target).toBeNull();
  });

  it("counts target progress from zero when the metric has no data yet", () => {
    const [lead] = buildWorkflowViews({ ...emptyInputs, rows: [leadEngineRow()] });
    expect(lead.target?.value).toBe(0);
    expect(lead.inbound).toMatchObject({ leads: 0, conversations: 0 });
  });

  it("asks the metric source for stage, target and inbound keys once each", () => {
    expect(metricKeysFor([leadEngineRow(), socialRow()]).sort()).toEqual(
      [
        "conversations.started",
        "leads.inbound",
        "leads.qualified_delivered",
        "posts.scheduled_review",
        "records.contacted_replied",
        "records.delivered",
        "records.gathered",
        "records.qualified",
        "reviews.new_negative",
      ].sort(),
    );
  });

  it("produces the same shape as the fixtures reader", async () => {
    const [fixture] = await createFixtureReaders(
      fixtureData,
    ).workflows.listWorkflows(FIXTURE_IDS.company);
    const [real] = buildWorkflowViews({ ...emptyInputs, rows: [leadEngineRow()] });
    expect(Object.keys(real).sort()).toEqual(Object.keys(fixture).sort());
    expect(Object.keys(real.stages[0]).sort()).toEqual(
      Object.keys(fixture.stages[0]).sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Database read
// ---------------------------------------------------------------------------

type DbRow = Omit<WorkflowRow, "stages"> & {
  createdAt: Date;
  stages: (Omit<WorkflowRow["stages"][number], "agent"> & {
    workflowId: string;
    agent: { id: string; name: string } | null;
  })[];
};

function toDbRow(row: WorkflowRow): DbRow {
  return {
    ...row,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    stages: row.stages.map((s) => ({ ...s, workflowId: row.id })),
  };
}

const workflowsFindMany = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  (db.query as unknown as Record<string, unknown>).workflows = {
    findMany: workflowsFindMany,
    findFirst: vi.fn(),
  };
  workflowsFindMany.mockResolvedValue([]);
  vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
  vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
  vi.mocked(db.query.chats.findMany).mockResolvedValue([] as never);
  vi.mocked(db.query.agents.findMany).mockResolvedValue([] as never);
});

describe("listWorkflows", () => {
  it("returns nothing and skips every other query for a company with no workflows", async () => {
    expect(await listWorkflows(COMPANY)).toEqual([]);
    expect(db.query.checkpoints.findMany).not.toHaveBeenCalled();
    expect(db.query.agents.findMany).not.toHaveBeenCalled();
  });

  it("joins rows, Needs you items, running agents, customer agents and metrics", async () => {
    workflowsFindMany.mockResolvedValue([
      toDbRow(leadEngineRow()),
      toDbRow(socialRow()),
    ]);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "cp-1",
        agentId: MAILER.id,
        agent: { ...MAILER, createdByUserId: null },
        status: "pending",
        kind: "outreach",
        createdAt: new Date(),
        chatId: "chat-1",
        cronRunId: null,
        chat: { id: "chat-1", userId: "u" },
        cronRun: null,
      },
    ] as never);
    vi.mocked(db.query.chats.findMany).mockResolvedValue([
      { agentId: GATHERER.id },
    ] as never);
    vi.mocked(db.query.agents.findMany).mockResolvedValue([WIDGET] as never);
    const metrics: MetricSource = {
      getValues: vi.fn(async () => ({
        "records.gathered": 42,
        "leads.qualified_delivered": 6,
      })),
    };
    const now = new Date("2026-10-02T09:00:00Z");

    const [lead, social] = await listWorkflows(COMPANY, { metrics, now });

    expect(metrics.getValues).toHaveBeenCalledWith(
      COMPANY,
      expect.arrayContaining(["records.gathered", "leads.inbound"]),
      now,
    );
    expect(lead.stages.map((s) => [s.name, s.metricValue, s.pending, s.state])).toEqual([
      ["Gather", 42, 0, "active"],
      ["Qualify", null, 0, "default"],
      ["Outreach", null, 1, "needs_you"],
      ["Delivered to client", null, 0, "default"],
    ]);
    expect(lead.target).toEqual({
      weeklyTarget: 10,
      metricKey: "leads.qualified_delivered",
      value: 6,
    });
    expect(lead.inbound?.customerAgents).toEqual([WIDGET]);
    expect(social.inbound).toBeNull();
  });

  it("is the WorkflowsReader implementation", async () => {
    workflowsFindMany.mockResolvedValue([toDbRow(socialRow())]);
    const reader = createWorkflowsReader();
    const [social] = await reader.listWorkflows(COMPANY);
    expect(social.stages.map((s) => s.metricValue)).toEqual([null, null]);
    expect(db.query.agents.findMany).not.toHaveBeenCalled();
  });
});

describe("listLeadWorkflowAgentIds", () => {
  it("returns stage agents of workflows whose target counts leads", async () => {
    workflowsFindMany.mockResolvedValue([
      toDbRow(leadEngineRow()),
      toDbRow(socialRow()),
    ]);
    expect(await listLeadWorkflowAgentIds(COMPANY)).toEqual(
      new Set([GATHERER.id, QUALIFIER.id, MAILER.id]),
    );
  });
});

// ---------------------------------------------------------------------------
// Seed (package install path)
// ---------------------------------------------------------------------------

const leadEngineDefinition = (): WorkflowDefinition => ({
  packageSlug: "lead_engine",
  name: "Lead engine",
  flow: "sequence",
  weeklyTarget: 10,
  targetMetricKey: "leads.qualified_delivered",
  inboundStageOrder: 1,
  intake: [{ key: "name", label: "Name", required: true }],
  stages: [
    { order: 0, name: "Gather", agentId: GATHERER.id, metricKey: "records.gathered" },
    { order: 1, name: "Qualify", agentId: QUALIFIER.id, metricKey: "records.qualified" },
    { order: 2, name: "Outreach", agentId: MAILER.id, metricKey: "records.contacted_replied" },
    { order: 3, name: "Delivered to client", agentId: null, metricKey: "records.delivered" },
  ],
});

function fakeExecutor(agentRows: { id: string; kind: string }[]) {
  const inserted: { table: string; values: unknown }[] = [];
  const updates: unknown[] = [];
  const executor = {
    query: { agents: { findMany: vi.fn(async () => agentRows) } },
    insert: vi.fn((table: unknown) => ({
      values: (values: unknown) => {
        const name = Array.isArray(values) ? "workflow_stages" : "workflows";
        inserted.push({ table: name, values });
        return {
          returning: async () =>
            Array.isArray(values)
              ? values.map((v: { order: number }) => ({ id: `st-${v.order}`, order: v.order }))
              : [{ id: "wf-new" }],
        };
      },
    })),
    update: vi.fn(() => ({
      set: (values: unknown) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    })),
  };
  return { executor: executor as unknown as WorkflowExecutor, inserted, updates };
}

const operatorRows = [GATHERER, QUALIFIER, MAILER].map((a) => ({
  id: a.id,
  kind: "operator",
}));

describe("insertWorkflow", () => {
  it("seeds the Lead engine workflow, its stages and the inbound stage", async () => {
    const { executor, inserted, updates } = fakeExecutor(operatorRows);
    const result = await insertWorkflow(executor, COMPANY, leadEngineDefinition());

    expect(result.workflowId).toBe("wf-new");
    expect(inserted[0].values).toMatchObject({
      companyId: COMPANY,
      packageSlug: "lead_engine",
      flow: "sequence",
      weeklyTarget: 10,
      targetMetricKey: "leads.qualified_delivered",
    });
    expect(inserted[1].values).toHaveLength(4);
    expect(inserted[1].values).toContainEqual(
      expect.objectContaining({ workflowId: "wf-new", order: 3, agentId: null }),
    );
    expect(updates).toEqual([{ inboundStageId: "st-1" }]);
  });

  it("refuses a customer agent as a stage", async () => {
    const { executor, inserted } = fakeExecutor([
      ...operatorRows.slice(1),
      { id: GATHERER.id, kind: "customer" },
    ]);
    await expect(
      insertWorkflow(executor, COMPANY, leadEngineDefinition()),
    ).rejects.toThrow(/customer agents are never stages/);
    expect(inserted).toEqual([]);
  });

  it("refuses an agent from another company", async () => {
    const { executor } = fakeExecutor(operatorRows.slice(1));
    await expect(
      insertWorkflow(executor, COMPANY, leadEngineDefinition()),
    ).rejects.toThrow(/not in this company/);
  });

  it.each([
    ["duplicate order", (d: WorkflowDefinition) => { d.stages[1].order = 0; }],
    ["unknown metric key", (d: WorkflowDefinition) => { d.stages[0].metricKey = "nope" as never; }],
    ["target without key", (d: WorkflowDefinition) => { d.targetMetricKey = null; }],
    ["negative target", (d: WorkflowDefinition) => { d.weeklyTarget = -1; }],
    ["inbound stage missing", (d: WorkflowDefinition) => { d.inboundStageOrder = 9; }],
    ["no stages", (d: WorkflowDefinition) => { d.stages = []; }],
  ])("rejects a definition with %s", async (_label, mutate) => {
    const def = leadEngineDefinition();
    mutate(def);
    const { executor } = fakeExecutor(operatorRows);
    await expect(insertWorkflow(executor, COMPANY, def)).rejects.toBeInstanceOf(
      WorkflowDefinitionError,
    );
  });
});
