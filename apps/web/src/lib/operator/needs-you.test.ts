import { beforeEach, describe, expect, it, vi } from "vitest";
import { asc, desc, sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { companyRecords } from "@/db/schema";

vi.mock("@/lib/workflows/read", () => ({
  listLeadWorkflowAgentIds: vi.fn(async () => new Set<string>()),
  listAgentWorkflows: vi.fn(async () => ({
    leadAgentIds: new Set<string>(),
    workflowNameByAgent: new Map<string, string>(),
  })),
}));
import { listAgentWorkflows } from "@/lib/workflows/read";
import { localDateLabel } from "@relay/db/report-snapshots";
import {
  buildNeedsYou,
  compareNeedsYou,
  countOpenCheckpointsByChat,
  countSessionNeedsYou,
  deriveSessionStatus,
  getNeedsYou,
  impactTier,
  loadFailedScheduleRuns,
  loadOpenAgentQuestions,
  loadUnreadBrief,
  NEEDS_YOU_TOP_N,
  topNeedsYou,
  type NeedsYouCandidate,
} from "./needs-you";

// The shared db mock predates daily_briefs.
const briefQuery = { findFirst: vi.fn(async () => undefined as unknown) };
(db.query as unknown as Record<string, unknown>).dailyBriefs = briefQuery;
const leadEventsQuery = { findMany: vi.fn(async () => [] as unknown[]) };
(db.query as unknown as Record<string, unknown>).leadEvents = leadEventsQuery;

const LEAD_AGENT = "agent-lead";
const OTHER_AGENT = "agent-other";
const isLead = (id: string) => id === LEAD_AGENT;
const at = (iso: string) => new Date(`2026-09-25T${iso}:00.000Z`);

function checkpoint(
  over: Partial<Extract<NeedsYouCandidate, { type: "checkpoint" }>> = {},
): Extract<NeedsYouCandidate, { type: "checkpoint" }> {
  return {
    type: "checkpoint",
    id: "cp-1",
    agentId: OTHER_AGENT,
    agentName: "Agent",
    title: "Approve outreach",
    createdAt: at("10:00"),
    chatId: "chat-1",
    cronRunId: null,
    cronJobId: null,
    checkpointKind: "outreach",
    checkpointStatus: "pending",
    approval: { agentCreatedByUserId: "creator", sessionUserId: "starter" },
    ...over,
  };
}

function question(over: Partial<NeedsYouCandidate> = {}): NeedsYouCandidate {
  return {
    type: "agent_question",
    id: "q-1",
    agentId: OTHER_AGENT,
    agentName: "Agent",
    title: "Include offices under 20 employees?",
    createdAt: at("10:00"),
    chatId: "chat-2",
    cronRunId: null,
    cronJobId: null,
    ...over,
  } as NeedsYouCandidate;
}

function failedRun(over: Partial<NeedsYouCandidate> = {}): NeedsYouCandidate {
  return {
    type: "failed_run",
    id: "run-1",
    agentId: OTHER_AGENT,
    agentName: "Agent",
    title: "Google Places quota reached",
    createdAt: at("06:00"),
    chatId: null,
    cronRunId: "run-1",
    cronJobId: "job-1",
    error: "quota",
    ...over,
  } as NeedsYouCandidate;
}

describe("impactTier", () => {
  it("tier 1: failed Schedule run of a lead-workflow agent", () => {
    expect(impactTier(failedRun({ agentId: LEAD_AGENT }), isLead)).toBe(1);
  });

  it("tier 2: outreach and lead_delivery checkpoints, any state, any agent", () => {
    for (const kind of ["outreach", "lead_delivery"] as const) {
      for (const status of ["pending", "stale", "failed"] as const) {
        expect(
          impactTier(
            checkpoint({ checkpointKind: kind, checkpointStatus: status }),
            isLead,
          ),
        ).toBe(2);
      }
    }
  });

  it("tier 2: questions from lead-workflow agents", () => {
    expect(impactTier(question({ agentId: LEAD_AGENT }), isLead)).toBe(2);
  });

  it("tier 3: post, review_reply, email_sequence checkpoints even on lead agents", () => {
    for (const kind of ["post", "review_reply", "email_sequence"] as const) {
      expect(
        impactTier(
          checkpoint({ checkpointKind: kind, agentId: LEAD_AGENT }),
          isLead,
        ),
      ).toBe(3);
    }
  });

  it("tier 3: questions and failed runs of agents outside lead workflows", () => {
    expect(impactTier(question(), isLead)).toBe(3);
    expect(impactTier(failedRun(), isLead)).toBe(3);
  });
});

describe("compareNeedsYou / buildNeedsYou order", () => {
  it("orders by tier, then oldest first (canonical snapshot)", () => {
    const list = buildNeedsYou({
      candidates: [
        checkpoint({ id: "posts", checkpointKind: "post", createdAt: at("09:52") }),
        checkpoint({ id: "replies", checkpointKind: "review_reply", createdAt: at("10:52") }),
        checkpoint({ id: "sequence", checkpointKind: "outreach", createdAt: at("11:40") }),
        question({ id: "offices", agentId: LEAD_AGENT, createdAt: at("11:14") }),
        failedRun({ id: "quota", agentId: LEAD_AGENT, createdAt: at("06:00") }),
      ],
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
    });
    expect(list.items.map((i) => i.id)).toEqual([
      "quota",
      "offices",
      "sequence",
      "posts",
      "replies",
    ]);
    expect(list.items.map((i) => i.tier)).toEqual([1, 2, 2, 3, 3]);
    expect(list.total).toBe(5);
  });

  it("does not let state change order inside a tier", () => {
    const list = buildNeedsYou({
      candidates: [
        checkpoint({ id: "pending-new", checkpointStatus: "pending", createdAt: at("11:00") }),
        checkpoint({ id: "failed-old", checkpointStatus: "failed", createdAt: at("08:00") }),
        checkpoint({ id: "stale-mid", checkpointStatus: "stale", createdAt: at("09:00") }),
      ],
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
    });
    expect(list.items.map((i) => i.id)).toEqual([
      "failed-old",
      "stale-mid",
      "pending-new",
    ]);
  });

  it("breaks an exact-time tie by id so the order is stable", () => {
    const a = { tier: 2 as const, createdAt: at("10:00"), id: "a" };
    const b = { tier: 2 as const, createdAt: at("10:00"), id: "b" };
    expect(compareNeedsYou(a, b)).toBeLessThan(0);
    expect(compareNeedsYou(b, a)).toBeGreaterThan(0);
  });

  it("never sends the approval hint to the client", () => {
    const list = buildNeedsYou({
      candidates: [checkpoint()],
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
    });
    expect(list.items[0]).not.toHaveProperty("approval");
    expect(list.items[0].href).toBe("/operator?agentId=agent-other&chatId=chat-1");
  });
});

describe("viewer filter", () => {
  const candidates = [
    checkpoint({ id: "cp" }),
    question({ id: "q" }),
    failedRun({ id: "run" }),
  ];

  it("shows checkpoints only to approvers", () => {
    const list = buildNeedsYou({
      candidates,
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => false,
    });
    expect(list.items.map((i) => i.id).sort()).toEqual(["q", "run"]);
    expect(list.total).toBe(2);
  });

  it("approvers see every item", () => {
    const list = buildNeedsYou({
      candidates,
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
    });
    expect(list.total).toBe(3);
  });
});

describe("topNeedsYou", () => {
  it("slices the top 5 and keeps the full count for View all (n)", () => {
    const list = buildNeedsYou({
      candidates: Array.from({ length: 7 }, (_, i) =>
        checkpoint({ id: `cp-${i}`, createdAt: at(`0${i}:00`) }),
      ),
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
    });
    const top = topNeedsYou(list);
    expect(NEEDS_YOU_TOP_N).toBe(5);
    expect(top.items.map((i) => i.id)).toEqual([
      "cp-0",
      "cp-1",
      "cp-2",
      "cp-3",
      "cp-4",
    ]);
    expect(top.total).toBe(7);
  });
});

describe("deriveSessionStatus", () => {
  it.each([
    [{ running: true, failed: false, openCheckpoints: 1, openQuestions: 0 }, "needs_you"],
    [{ running: false, failed: false, openCheckpoints: 0, openQuestions: 1 }, "needs_you"],
    [{ running: true, failed: false, openCheckpoints: 0, openQuestions: 0 }, "running"],
    [{ running: false, failed: true, openCheckpoints: 0, openQuestions: 0 }, "failed"],
    [{ running: false, failed: false, openCheckpoints: 0, openQuestions: 0 }, "completed"],
  ] as const)("%o -> %s", (input, expected) => {
    expect(deriveSessionStatus(input)).toBe(expected);
  });
});

describe("data loaders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts open checkpoints per session", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      { chatId: "a" },
      { chatId: "a" },
      { chatId: "b" },
    ] as never);
    const counts = await countOpenCheckpointsByChat(["a", "b", "c"]);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1 });
  });

  it("skips the query for no sessions", async () => {
    const counts = await countOpenCheckpointsByChat([]);
    expect(counts.size).toBe(0);
    expect(db.query.checkpoints.findMany).not.toHaveBeenCalled();
  });

  it("loads open agent questions as Needs you items for every viewer", async () => {
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValueOnce([
      {
        id: "q-session",
        agentId: LEAD_AGENT,
        question: "Which   city\nshould I target?",
        createdAt: at("08:00"),
        chatId: "chat-1",
        cronRunId: null,
        agent: { id: LEAD_AGENT, name: "Lead finder" },
        cronRun: null,
      },
      {
        id: "q-run",
        agentId: OTHER_AGENT,
        question: "x".repeat(120),
        createdAt: at("07:00"),
        chatId: null,
        cronRunId: "run-1",
        agent: { id: OTHER_AGENT, name: "Writer" },
        cronRun: { id: "run-1", jobId: "job-1" },
      },
    ] as never);

    const items = await loadOpenAgentQuestions("company-1");
    expect(items[0]).toMatchObject({
      type: "agent_question",
      id: "q-session",
      title: "Which city should I target?",
      chatId: "chat-1",
      cronJobId: null,
    });
    expect(items[1]).toMatchObject({ id: "q-run", cronRunId: "run-1", cronJobId: "job-1" });
    expect(items[1]!.title).toHaveLength(80);

    const list = buildNeedsYou({
      candidates: items,
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => false,
    });
    expect(list.items.map((i) => [i.id, i.tier])).toEqual([
      ["q-session", 2],
      ["q-run", 3],
    ]);
    expect(list.items[1]!.href).toBe("/operator?runId=run-1");
  });

  it("keeps only Schedules whose latest run failed", async () => {
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([
      {
        id: "job-1",
        name: "Gather leads",
        agentId: "agent-1",
        agent: { id: "agent-1", name: "Lead finder" },
        runs: [
          {
            id: "run-1",
            status: "failed",
            error: "quota",
            createdAt: at("06:00"),
            finishedAt: at("06:05"),
          },
        ],
      },
      {
        id: "job-2",
        name: "Recovered",
        agentId: "agent-1",
        agent: { id: "agent-1", name: "Lead finder" },
        runs: [
          { id: "run-2", status: "succeeded", error: null, createdAt: at("07:00"), finishedAt: at("07:01") },
        ],
      },
      { id: "job-3", name: "Never ran", agentId: "agent-1", agent: null, runs: [] },
    ] as never);
    const items = await loadFailedScheduleRuns("company-1");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "failed_run",
      id: "run-1",
      cronJobId: "job-1",
      createdAt: at("06:05"),
    });
  });

  it("getNeedsYou shows a member only checkpoints on agents they can approve", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "cp-own-session",
        agentId: "agent-1",
        kind: "outreach",
        status: "pending",
        createdAt: at("09:00"),
        chatId: "chat-1",
        cronRunId: null,
        agent: { id: "agent-1", name: "A", createdByUserId: "owner" },
        chat: { id: "chat-1", userId: "member" },
        cronRun: null,
      },
      {
        id: "cp-someone-else",
        agentId: "agent-1",
        kind: "outreach",
        status: "pending",
        createdAt: at("08:00"),
        chatId: "chat-2",
        cronRunId: null,
        agent: { id: "agent-1", name: "A", createdByUserId: "owner" },
        chat: { id: "chat-2", userId: "other" },
        cronRun: null,
      },
      {
        id: "cp-edited-agent",
        agentId: "agent-2",
        kind: "post",
        status: "stale",
        createdAt: at("07:00"),
        chatId: null,
        cronRunId: "run-9",
        agent: { id: "agent-2", name: "B", createdByUserId: "owner" },
        chat: null,
        cronRun: { id: "run-9", jobId: "job-9" },
      },
    ] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true, agents: false, messaging: false, analytics: false },
    } as never);
    // Edit without approve on agent-1 (even on their own session), approve on agent-2.
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([
      { agentId: "agent-1", canApprove: false },
      { agentId: "agent-2", canApprove: true },
    ] as never);

    const member = await getNeedsYou({
      companyId: "company-1",
      viewerId: "member",
      ownerId: "owner",
    });
    expect(member.items.map((i) => i.id)).toEqual(["cp-edited-agent"]);
    expect(member.items[0].href).toBe(
      "/operator?runId=run-9",
    );

    const owner = await getNeedsYou({
      companyId: "company-1",
      viewerId: "owner",
      ownerId: "owner",
    });
    expect(owner.total).toBe(3);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "client",
      pagePermissions: { operator: true },
    } as never);
    const client = await getNeedsYou({
      companyId: "company-1",
      viewerId: "member",
      ownerId: "owner",
    });
    expect(client.total).toBe(0);
  });

  it("lists a customer-chat lead_delivery card for its approvers, linked to the qualified leads (W3GAP2)", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "cp-lead-delivery",
        agentId: "agent-customer",
        kind: "lead_delivery",
        status: "pending",
        createdAt: at("09:00"),
        chatId: "chat-customer",
        cronRunId: null,
        agent: { id: "agent-customer", name: "Acme inbound", createdByUserId: "owner" },
        chat: { id: "chat-customer", userId: null, channelType: "whatsapp" },
        cronRun: null,
      },
    ] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([] as never);

    const owner = await getNeedsYou({
      companyId: "company-1",
      viewerId: "owner",
      ownerId: "owner",
    });
    expect(owner.items).toEqual([
      expect.objectContaining({
        id: "cp-lead-delivery",
        type: "checkpoint",
        checkpointKind: "lead_delivery",
        chatId: "chat-customer",
        tier: 2,
        href: "/messaging?chatId=chat-customer",
        onCustomerChat: true,
      }),
    ]);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([
      { agentId: "agent-customer", canApprove: false },
    ] as never);
    const member = await getNeedsYou({
      companyId: "company-1",
      viewerId: "member",
      ownerId: "owner",
    });
    expect(member.total).toBe(0);

    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([
      { agentId: "agent-customer", canApprove: true },
    ] as never);
    const approver = await getNeedsYou({
      companyId: "company-1",
      viewerId: "member",
      ownerId: "owner",
    });
    expect(approver.items.map((i) => i.id)).toEqual(["cp-lead-delivery"]);
  });

  it("keeps the session link for a card on an operator chat", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([
      {
        id: "cp-operator",
        agentId: "agent-1",
        kind: "lead_delivery",
        status: "pending",
        createdAt: at("09:00"),
        chatId: "chat-op",
        cronRunId: null,
        agent: { id: "agent-1", name: "Qualify", createdByUserId: "owner" },
        chat: { id: "chat-op", userId: "owner", channelType: "operator" },
        cronRun: null,
      },
    ] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([] as never);

    const owner = await getNeedsYou({
      companyId: "company-1",
      viewerId: "owner",
      ownerId: "owner",
    });
    expect(owner.items[0].href).toBe("/operator?agentId=agent-1&chatId=chat-op");
  });

  it("getNeedsYou tags each row with its agent's workflow and tiers lead agents (S46)", async () => {
    vi.mocked(listAgentWorkflows).mockResolvedValueOnce({
      leadAgentIds: new Set(["agent-lead"]),
      workflowNameByAgent: new Map([["agent-lead", "Lead engine"]]),
    });
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValueOnce([
      {
        id: "q-lead",
        agentId: "agent-lead",
        question: "Include offices under 20 employees?",
        createdAt: at("11:00"),
        chatId: "chat-1",
        cronRunId: null,
        agent: { id: "agent-lead", name: "Lead Qualifier" },
        cronRun: null,
      },
      {
        id: "q-other",
        agentId: "agent-other",
        question: "Post now?",
        createdAt: at("09:00"),
        chatId: "chat-2",
        cronRunId: null,
        agent: { id: "agent-other", name: "Social" },
        cronRun: null,
      },
    ] as never);

    const list = await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
    expect(list.items.map((i) => [i.id, i.tier, i.workflow])).toEqual([
      ["q-lead", 2, "Lead engine"],
      ["q-other", 3, null],
    ]);
  });

  it("getNeedsYou shows questions and failed runs only to members with operator access (W5GAP)", async () => {
    const questionRows = [
      {
        id: "q-op",
        agentId: "agent-op",
        question: "Which city?",
        createdAt: at("08:00"),
        chatId: "chat-1",
        cronRunId: null,
        agent: { id: "agent-op", name: "Lead finder", kind: "operator" },
        cronRun: null,
      },
      {
        id: "q-customer",
        agentId: "agent-customer",
        question: "Hand off?",
        createdAt: at("08:30"),
        chatId: "chat-2",
        cronRunId: null,
        agent: { id: "agent-customer", name: "Inbound", kind: "customer" },
        cronRun: null,
      },
    ];
    const jobRows = [
      {
        id: "job-1",
        name: "Gather leads",
        agentId: "agent-op",
        agent: { id: "agent-op", name: "Lead finder", kind: "operator" },
        runs: [
          { id: "run-1", status: "failed", error: "quota", createdAt: at("06:00"), finishedAt: at("06:05") },
        ],
      },
    ];
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue(questionRows as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue(jobRows as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([] as never);
    const viewer = { companyId: "company-1", viewerId: "member", ownerId: "owner" };

    const owner = await getNeedsYou({ ...viewer, viewerId: "owner" });
    expect(owner.items.map((i) => i.id).sort()).toEqual(["q-customer", "q-op", "run-1"]);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: false, agents: true, messaging: true, analytics: true },
    } as never);
    expect((await getNeedsYou(viewer)).total).toBe(0);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    const operatorMember = await getNeedsYou(viewer);
    expect(operatorMember.items.map((i) => i.id).sort()).toEqual(["q-op", "run-1"]);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined as never);
    expect((await getNeedsYou(viewer)).total).toBe(0);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "client",
      pagePermissions: { operator: true },
    } as never);
    expect((await getNeedsYou(viewer)).total).toBe(0);
  });

  it("buildNeedsYou drops questions and failed runs the viewer cannot see, keeps approvable checkpoints", () => {
    const list = buildNeedsYou({
      candidates: [checkpoint({ id: "cp" }), question({ id: "q" }), failedRun({ id: "run" })],
      isLeadWorkflowAgent: isLead,
      canApproveCheckpoint: () => true,
      canSeeOperatorItem: () => false,
    });
    expect(list.items.map((i) => i.id)).toEqual(["cp"]);
  });

  it("countSessionNeedsYou adds open questions to open checkpoints per session (S46)", async () => {
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValueOnce([
      { chatId: "a" },
      { chatId: "b" },
    ] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValueOnce([
      { chatId: "a" },
      { chatId: "c" },
      { chatId: null },
    ] as never);
    const counts = await countSessionNeedsYou(["a", "b", "c"]);
    expect(Object.fromEntries(counts)).toEqual({ a: 2, b: 1, c: 1 });
    expect(await countSessionNeedsYou([])).toEqual(new Map());
  });
});

describe("daily brief item", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    briefQuery.findFirst.mockResolvedValue(undefined);
  });

  // 2026-09-25 05:30Z is 08:30 in Istanbul, the same local day.
  const now = at("05:30");
  const briefRow = (over: Record<string, unknown> = {}) => ({
    id: "brief-1",
    agentId: "agent-manager",
    cronRunId: "run-brief",
    localDate: "2026-09-25",
    readAt: null,
    createdAt: at("05:30"),
    agent: { id: "agent-manager", name: "Daily Manager", kind: "operator" },
    cronRun: { id: "run-brief", jobId: "job-brief" },
    company: { timezone: "Europe/Istanbul" },
    ...over,
  });

  it("lists today's brief while it is unread, linked to the Home tile", async () => {
    briefQuery.findFirst.mockResolvedValue(briefRow());
    const [item] = await loadUnreadBrief("company-1", now);
    expect(item).toMatchObject({
      type: "brief",
      id: "brief-1",
      agentId: "agent-manager",
      agentName: "Daily Manager",
      title: "Today's brief",
      cronRunId: "run-brief",
      cronJobId: "job-brief",
    });
    const list = buildNeedsYou({
      candidates: [item],
      isLeadWorkflowAgent: () => true,
      canApproveCheckpoint: () => true,
    });
    expect(list.items[0]).toMatchObject({ type: "brief", tier: 3, href: "/home#brief" });
  });

  it("drops a read brief and a brief whose agent is gone", async () => {
    briefQuery.findFirst.mockResolvedValue(briefRow({ readAt: at("06:00") }));
    expect(await loadUnreadBrief("company-1", now)).toEqual([]);
    briefQuery.findFirst.mockResolvedValue(briefRow({ agentId: null, agent: null }));
    expect(await loadUnreadBrief("company-1", now)).toEqual([]);
    briefQuery.findFirst.mockResolvedValue(undefined);
    expect(await loadUnreadBrief("company-1", now)).toEqual([]);
  });

  it("drops an unread brief from an earlier local day, which Home can no longer mark read", async () => {
    briefQuery.findFirst.mockResolvedValue(briefRow({ localDate: "2026-09-24" }));
    expect(await loadUnreadBrief("company-1", now)).toEqual([]);
    // 22:30Z on the 24th is already the 25th in Istanbul.
    briefQuery.findFirst.mockResolvedValue(briefRow());
    expect(await loadUnreadBrief("company-1", new Date("2026-09-24T22:30:00.000Z"))).toHaveLength(1);
  });

  it("is the lowest impact tier, even for a lead-workflow agent", () => {
    const brief = { ...question({ id: "b" }), type: "brief" } as NeedsYouCandidate;
    expect(impactTier(brief, () => true)).toBe(3);
  });

  it("getNeedsYou shows an unread brief to the owner and operator members only, like questions", async () => {
    // getNeedsYou reads the clock, so the brief is dated today in its timezone.
    briefQuery.findFirst.mockResolvedValue(
      briefRow({ localDate: localDateLabel(new Date(), "Europe/Istanbul") }),
    );
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([] as never);
    const viewer = { companyId: "company-1", viewerId: "member", ownerId: "owner" };

    expect((await getNeedsYou({ ...viewer, viewerId: "owner" })).items.map((i) => i.id)).toEqual(["brief-1"]);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: false },
    } as never);
    expect((await getNeedsYou(viewer)).total).toBe(0);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    expect((await getNeedsYou(viewer)).items.map((i) => i.id)).toEqual(["brief-1"]);

    briefQuery.findFirst.mockResolvedValue(briefRow({ readAt: at("06:00") }));
    expect((await getNeedsYou({ ...viewer, viewerId: "owner" })).total).toBe(0);
  });
});

describe("qualified lead item", () => {
  const leadRow = (over: Record<string, unknown> = {}) => ({
    id: "lead-1",
    companyId: "company-1",
    status: "qualified",
    source: "whatsapp",
    name: "Ayşe Yılmaz",
    chatId: "chat-9",
    sourceAgentId: "agent-customer",
    createdAt: at("08:00"),
    sourceAgent: { id: "agent-customer", name: "Karşılama", kind: "customer" },
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    briefQuery.findFirst.mockResolvedValue(undefined);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.cronJobs.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([leadRow()] as never);
    leadEventsQuery.findMany.mockResolvedValue([
      { recordId: "lead-1", toStatus: "gathered", at: at("08:05") },
      { recordId: "lead-1", toStatus: "qualified", at: at("08:15") },
      { recordId: "lead-1", toStatus: "qualified", at: at("09:00") },
    ]);
  });

  it("lists a qualified inbound lead at tier 1, dated by its first qualified event", async () => {
    const list = await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
    expect(list.items).toEqual([
      expect.objectContaining({
        id: "lead:lead-1",
        type: "qualified_lead",
        title: "Yeni nitelikli başvuru",
        agentName: "Karşılama",
        tier: 1,
        href: "/messaging?chatId=chat-9",
        createdAt: at("08:15"),
        chatId: "chat-9",
      }),
    ]);
  });

  it.each(["meeting", "delivered", "rejected", "gathered", "won"])(
    "drops the item when the status is %s",
    async (status) => {
      vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([leadRow({ status })] as never);
      const list = await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
      expect(list.total).toBe(0);
    },
  );

  it("never lists an outbound lead", async () => {
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([leadRow({ source: "outbound" })] as never);
    const list = await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
    expect(list.total).toBe(0);
  });

  it("drops outbound rows and orders newest first in SQL, so they never use up the 50-row cap", async () => {
    await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
    const args = vi.mocked(db.query.companyRecords.findMany).mock.calls[0]?.[0] as unknown as {
      where: SQL;
      orderBy: (
        table: typeof companyRecords,
        ops: { asc: typeof asc; desc: typeof desc },
      ) => SQL[];
      limit: number;
    };
    expect(args.limit).toBe(50);
    const dialect = new PgDialect();
    const where = dialect.sqlToQuery(args.where);
    expect(where.sql).toMatch(/"company_records"\."source" <> \$\d+/);
    expect(where.params).toContain("outbound");
    const order = dialect.sqlToQuery(
      sql.join(args.orderBy(companyRecords, { asc, desc }), sql`, `),
    );
    expect(order.sql).toBe(`"company_records"."created_at" desc`);
  });

  it("is visible to the owner only, not a non-owner member", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([] as never);
    const member = await getNeedsYou({ companyId: "company-1", viewerId: "member", ownerId: "owner" });
    expect(member.total).toBe(0);
  });

  it("routes a customer-agent question to the conversation and keeps operator questions on the session", async () => {
    vi.mocked(db.query.companyRecords.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.agentQuestions.findMany).mockResolvedValue([
      {
        id: "q-customer",
        agentId: "agent-customer",
        question: "Karşılama ajanı bir mesaja yanıt veremedi.",
        createdAt: at("08:30"),
        chatId: "chat-9",
        cronRunId: null,
        agent: { id: "agent-customer", name: "Karşılama", kind: "customer" },
        cronRun: null,
      },
      {
        id: "q-operator",
        agentId: "agent-op",
        question: "Which city?",
        createdAt: at("08:00"),
        chatId: "chat-2",
        cronRunId: null,
        agent: { id: "agent-op", name: "Lead finder", kind: "operator" },
        cronRun: null,
      },
    ] as never);

    const owner = await getNeedsYou({ companyId: "company-1", viewerId: "owner", ownerId: "owner" });
    const byId = new Map(owner.items.map((i) => [i.id, i.href]));
    expect(byId.get("q-customer")).toBe("/messaging?chatId=chat-9");
    expect(byId.get("q-operator")).toBe("/operator?agentId=agent-op&chatId=chat-2");

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([] as never);
    const member = await getNeedsYou({ companyId: "company-1", viewerId: "member", ownerId: "owner" });
    expect(member.items.map((i) => i.id)).toEqual(["q-operator"]);
  });
});
