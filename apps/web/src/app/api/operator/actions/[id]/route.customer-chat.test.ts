import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { chats, checkpoints, messages } from "@/db/schema";
import { checkpointArtifactHash } from "@relay/db";
import { getSession, requireSession } from "@/lib/auth-server";
import { POST } from "./route";

// W3GAP2: a lead_delivery card on the lead's customer chat, approved through
// the real access check and the real resolve path. Only the database, the
// lead bookkeeping and the worker's HTTP endpoint are faked.

const { markLeadDelivered } = vi.hoisted(() => ({
  markLeadDelivered: vi.fn(),
}));
vi.mock("@/lib/leads", () => ({
  markLeadDelivered,
  transitionLeadStatus: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const checkpointId = "bb0e8400-e29b-41d4-a716-446655440011";
const customerAgentId = "660e8400-e29b-41d4-a716-446655440001";
const customerChatId = "770e8400-e29b-41d4-a716-446655440002";

const company = { id: companyId, name: "Acme Villas", ownerId: "owner-1" };
const customerAgent = {
  id: customerAgentId,
  companyId,
  kind: "customer" as const,
  createdByUserId: "owner-1",
  company,
};
const customerChat = {
  id: customerChatId,
  companyId,
  agentId: customerAgentId,
  channelType: "whatsapp" as const,
  userId: null,
};

const delivery = {
  kind: "lead_delivery" as const,
  leadId: "lead-1",
  channel: "whatsapp" as const,
  recipient: "+905551112233",
  summary: "Ayse, villa, May",
  reason: "Qualified inbound lead, fit 82",
};

const card = {
  id: checkpointId,
  companyId,
  agentId: customerAgentId,
  chatId: customerChatId,
  cronRunId: null,
  recordId: "lead-1",
  kind: "lead_delivery" as const,
  payload: delivery,
  endpointSnapshot: null,
  status: "pending" as const,
  supersededBy: null,
  attemptCount: 1,
  artifactHash: checkpointArtifactHash(delivery),
  executeResult: null,
  sendReceipt: null,
  createdAt: new Date("2026-10-03T08:00:00.000Z"),
  resolvedAt: null,
  resolvedByUserId: null,
  refreshRequestedAt: null,
};

function sessionFor(userId: string) {
  return {
    user: { id: userId, name: "U", email: `${userId}@relay.dev` },
    session: { expiresAt: new Date("2026-12-01T00:00:00.000Z") },
  };
}

function asUser(userId: string) {
  vi.mocked(getSession).mockResolvedValue(sessionFor(userId) as never);
  vi.mocked(requireSession).mockResolvedValue(sessionFor(userId) as never);
}

const updatedTables: unknown[] = [];

function approve() {
  return POST(
    new Request(`http://localhost:3000/api/operator/actions/${checkpointId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    }),
    { params: Promise.resolve({ id: checkpointId }) },
  );
}

describe("POST /api/operator/actions/[id] on a customer chat (W3GAP2)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    updatedTables.length = 0;
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(card as never);
    vi.mocked(db.query.checkpoints.findMany).mockResolvedValue([]);
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(customerChat as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(customerAgent as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(undefined);
    vi.mocked(db.update).mockImplementation(
      (table: unknown) =>
        ({
          set: () => {
            updatedTables.push(table);
            const result = Promise.resolve(undefined) as Promise<undefined> & {
              returning: () => Promise<{ id: string }[]>;
            };
            result.returning = async () => [{ id: checkpointId }];
            return { where: () => result };
          },
        }) as never,
    );
    markLeadDelivered.mockResolvedValue({ delivered: true });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ mode: "sent", messageId: "wamid-1" })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lets the owner approve, and the worker sends once", async () => {
    asUser("owner-1");

    const res = await approve();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "approved" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://worker:3001/internal/lead-delivery",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ checkpointId });
    expect(markLeadDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ companyId, leadId: "lead-1", userId: "owner-1" }),
    );
    // Not an agent session: no tool result in the customer's transcript, and
    // the customer chat's status is left alone.
    expect(vi.mocked(db.insert).mock.calls.map((c) => c[0])).not.toContain(messages);
    expect(updatedTables).toContain(checkpoints);
    expect(updatedTables).not.toContain(chats);
  });

  it("refuses a member without canApprove on the proposing agent", async () => {
    asUser("member-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      companyId,
      userId: "member-1",
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      agentId: customerAgentId,
      userId: "member-1",
      canEdit: true,
      canApprove: false,
    } as never);

    const res = await approve();

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("lets a member with canApprove on the proposing agent approve", async () => {
    asUser("member-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      companyId,
      userId: "member-1",
      role: "member",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      agentId: customerAgentId,
      userId: "member-1",
      canEdit: false,
      canApprove: true,
    } as never);

    const res = await approve();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a client user", async () => {
    asUser("client-1");
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      companyId,
      userId: "client-1",
      role: "client",
      pagePermissions: { operator: true },
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      agentId: customerAgentId,
      userId: "client-1",
      canEdit: false,
      canApprove: true,
    } as never);

    const res = await approve();

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a user with no tie to the company", async () => {
    asUser("stranger-1");

    const res = await approve();

    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
