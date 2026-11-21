import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { getSession, requireSession } from "@/lib/auth-server";
import { GET } from "./route";

// S45: the cards a viewer sees on a customer conversation's lead_delivery
// checkpoints, through the real access checks. Only the database is faked.

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const chatId = "770e8400-e29b-41d4-a716-446655440002";

const company = { id: companyId, name: "Acme Villas", ownerId: "owner-1" };
const customerAgent = {
  id: agentId,
  companyId,
  kind: "customer" as const,
  createdByUserId: "creator-1",
  company,
};
const customerChat = {
  id: chatId,
  companyId,
  agentId,
  channelType: "whatsapp" as const,
};

const card = {
  id: "bb0e8400-e29b-41d4-a716-446655440011",
  companyId,
  agentId,
  chatId,
  cronRunId: null,
  recordId: "lead-1",
  kind: "lead_delivery" as const,
  payload: {
    kind: "lead_delivery" as const,
    leadId: "lead-1",
    channel: "whatsapp" as const,
    recipient: "+905551112233",
    summary: "Ayse, villa, May",
    reason: "Qualified inbound lead, fit 82",
  },
  status: "pending" as const,
  supersededBy: null,
  attemptCount: 1,
  executeResult: null,
  createdAt: new Date("2026-10-03T08:00:00.000Z"),
  resolvedAt: null,
  refreshRequestedAt: null,
};

function asUser(userId: string) {
  const session = {
    user: { id: userId, name: "U", email: `${userId}@relay.dev` },
    session: { expiresAt: new Date("2026-12-01T00:00:00.000Z") },
  };
  vi.mocked(getSession).mockResolvedValue(session as never);
  vi.mocked(requireSession).mockResolvedValue(session as never);
}

function member(role: "member" | "client", operator = true) {
  return {
    companyId,
    userId: "member-1",
    role,
    pagePermissions: { operator },
  };
}

function list(query = `chatId=${chatId}`) {
  return GET(new Request(`http://localhost:3000/api/operator/checkpoints?${query}`));
}

async function cards(res: Response) {
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    checkpoints: { state: string; actions: string[] }[];
  };
  return body.checkpoints;
}

describe("GET /api/operator/checkpoints on a customer chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(customerChat as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([card] as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(customerAgent as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(undefined);
  });

  it("owner: pending card with Approve and Discard", async () => {
    asUser("owner-1");
    const [view] = await cards(await list());
    expect(view.state).toBe("pending");
    expect(view.actions).toEqual(["approve", "discard"]);
  });

  it("agent creator who is a member can approve", async () => {
    asUser("creator-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(
      { ...member("member", false), userId: "creator-1" } as never,
    );
    const [view] = await cards(await list());
    expect(view.actions).toEqual(["approve", "discard"]);
  });

  it("member with canApprove on the agent can approve", async () => {
    asUser("member-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(member("member") as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      { agentId, userId: "member-1", canApprove: true } as never,
    );
    const [view] = await cards(await list());
    expect(view.state).toBe("pending");
    expect(view.actions).toEqual(["approve", "discard"]);
  });

  it("member without canApprove sees the read-only card", async () => {
    asUser("member-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(member("member") as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      { agentId, userId: "member-1", canApprove: false } as never,
    );
    const [view] = await cards(await list());
    expect(view.state).toBe("read-only");
    expect(view.actions).toEqual([]);
  });

  it("client users never see the cards", async () => {
    asUser("member-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(member("client") as never);
    const res = await list();
    expect(res.status).toBe(403);
  });

  it("strangers are refused", async () => {
    asUser("stranger");
    const res = await list();
    expect(res.status).toBe(403);
  });

  it("needs exactly one of chatId or runId", async () => {
    asUser("owner-1");
    expect((await list("")).status).toBe(400);
    expect((await list(`chatId=${chatId}&runId=x`)).status).toBe(400);
  });

  it("401 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await list()).status).toBe(401);
  });
});
