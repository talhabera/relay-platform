import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/auth-server";
import { db } from "@/db";
import {
  requireCustomerChatCheckpointApprove,
  requireOperatorSessionApprove,
} from "@/lib/operator/access";
import { resolveCheckpoint } from "@/lib/operator/resolve-action";
import { POST } from "./route";

vi.mock("@/lib/operator/access", () => ({
  requireOperatorSessionApprove: vi.fn(),
  requireCustomerChatCheckpointApprove: vi.fn(),
}));

vi.mock("@/lib/operator/resolve-action", () => ({
  resolveCheckpoint: vi.fn(),
}));

const mockSession = {
  user: { id: "user-1", name: "Starter", email: "starter@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const pending = {
  id: "pending-1",
  companyId: "company-1",
  chatId: "chat-1",
  cronRunId: null,
  agentId: "agent-1",
  status: "pending",
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/operator/actions/pending-1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "pending-1" }) };

describe("POST /api/operator/actions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireOperatorSessionApprove).mockResolvedValue({
      session: mockSession,
    } as never);
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      pending as never,
    );
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "approved",
      executeResult: { mode: "copy" },
      checkpoint: pending,
    } as never);
  });

  it("returns 401 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(401);
    expect(resolveCheckpoint).not.toHaveBeenCalled();
  });

  it("returns 404 when the action is missing", async () => {
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(undefined);

    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(404);
  });

  it("returns 403 when the caller is not the session starter", async () => {
    vi.mocked(requireOperatorSessionApprove).mockRejectedValue(
      new Error("Unauthorized"),
    );

    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(403);
    expect(resolveCheckpoint).not.toHaveBeenCalled();
  });

  it("returns 200 with approved status", async () => {
    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "approved" });
    expect(requireOperatorSessionApprove).toHaveBeenCalledWith("chat-1");
    expect(resolveCheckpoint).toHaveBeenCalledWith({
      checkpointId: "pending-1",
      action: "approve",
      feedback: undefined,
      userId: mockSession.user.id,
    });
  });

  it("returns 409 when resolve reports a conflict", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: false,
      httpStatus: 409,
      status: "approved",
    });

    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({ status: "approved" });
  });
});

describe("POST /api/operator/actions/[id] actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireOperatorSessionApprove).mockResolvedValue({
      session: mockSession,
    } as never);
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      pending as never,
    );
  });

  it("maps the old reject action to discard", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "discarded",
      executeResult: { status: "discarded" },
      checkpoint: pending,
    } as never);

    const res = await POST(makeRequest({ action: "reject" }), params);
    expect(res.status).toBe(200);
    expect(resolveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ action: "discard" }),
    );
  });

  it("passes Ask for changes feedback through", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "changes_requested",
      executeResult: { status: "changes_requested", feedback: "Shorter" },
      checkpoint: pending,
    } as never);

    const res = await POST(
      makeRequest({ action: "ask_for_changes", feedback: "Shorter" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(resolveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ask_for_changes", feedback: "Shorter" }),
    );
  });

  it("a repeat Refresh does not write a second tool result", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "stale",
      executeResult: { status: "refresh_requested" },
      checkpoint: pending,
      alreadyRequested: true,
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const res = await POST(makeRequest({ action: "refresh" }), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "stale" });
    expect(values).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    const res = await POST(makeRequest({ action: "send" }), params);
    expect(res.status).toBe(400);
    expect(resolveCheckpoint).not.toHaveBeenCalled();
  });
});

describe("POST /api/operator/actions/[id] picks the check by parent kind (W3GAP2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireOperatorSessionApprove).mockResolvedValue({
      session: mockSession,
    } as never);
    vi.mocked(requireCustomerChatCheckpointApprove).mockResolvedValue({
      session: mockSession,
    } as never);
    vi.mocked(db.query.checkpoints.findFirst).mockResolvedValue(
      pending as never,
    );
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "approved",
      executeResult: { mode: "sent" },
      checkpoint: pending,
    } as never);
  });

  it("an operator-chat card still uses the session check and writes the tool result", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      channelType: "operator",
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const res = await POST(makeRequest({ action: "approve" }), params);

    expect(res.status).toBe(200);
    expect(requireOperatorSessionApprove).toHaveBeenCalledWith("chat-1");
    expect(requireCustomerChatCheckpointApprove).not.toHaveBeenCalled();
    expect(resolveCheckpoint).toHaveBeenCalledWith({
      checkpointId: "pending-1",
      action: "approve",
      feedback: undefined,
      userId: mockSession.user.id,
    });
    expect(values).toHaveBeenCalledTimes(1);
  });

  it("an operator-chat card is refused when the session check fails", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      channelType: "operator",
    } as never);
    vi.mocked(requireOperatorSessionApprove).mockRejectedValue(
      new Error("Unauthorized"),
    );

    const res = await POST(makeRequest({ action: "approve" }), params);

    expect(res.status).toBe(403);
    expect(requireCustomerChatCheckpointApprove).not.toHaveBeenCalled();
  });

  it("a customer-chat card uses the customer-chat check and skips the transcript", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      channelType: "widget",
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const res = await POST(makeRequest({ action: "approve" }), params);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "approved" });
    expect(requireCustomerChatCheckpointApprove).toHaveBeenCalledWith({
      chatId: "chat-1",
      agentId: "agent-1",
      companyId: "company-1",
    });
    expect(requireOperatorSessionApprove).not.toHaveBeenCalled();
    expect(resolveCheckpoint).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve", syncSession: false }),
    );
    expect(values).not.toHaveBeenCalled();
  });

  it("a customer-chat card is refused when the customer-chat check fails", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      channelType: "whatsapp",
    } as never);
    vi.mocked(requireCustomerChatCheckpointApprove).mockRejectedValue(
      new Error("Unauthorized"),
    );

    const res = await POST(makeRequest({ action: "approve" }), params);

    expect(res.status).toBe(403);
    expect(resolveCheckpoint).not.toHaveBeenCalled();
  });

  it("a customer-chat card takes no Ask for changes (no agent loop answers)", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      channelType: "whatsapp",
    } as never);

    const res = await POST(
      makeRequest({ action: "ask_for_changes", feedback: "Shorter" }),
      params,
    );

    expect(res.status).toBe(400);
    expect(resolveCheckpoint).not.toHaveBeenCalled();
  });
});
