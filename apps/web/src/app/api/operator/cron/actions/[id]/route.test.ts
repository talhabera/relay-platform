import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/auth-server";
import { db } from "@/db";
import { requireCheckpointApprove } from "@/lib/operator/access";
import { pokeCronContinue } from "@/lib/operator/cron-continue";
import { resolveCheckpoint } from "@/lib/operator/resolve-action";
import { POST } from "./route";

vi.mock("@/lib/operator/access", () => ({
  requireCheckpointApprove: vi.fn(),
}));

vi.mock("@/lib/operator/cron-continue", () => ({
  pokeCronContinue: vi.fn(),
}));

vi.mock("@/lib/operator/resolve-action", () => ({
  resolveCheckpoint: vi.fn(),
}));

const mockSession = {
  user: { id: "editor-1", name: "Editor", email: "editor@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const pending = {
  id: "pending-1",
  chatId: null,
  cronRunId: "run-1",
  agentId: "agent-1",
  status: "pending",
};

function makeRequest(body: Record<string, unknown>) {
  return new Request(
    "http://localhost:3000/api/operator/cron/actions/pending-1",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

const params = { params: Promise.resolve({ id: "pending-1" }) };

describe("POST /api/operator/cron/actions/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireCheckpointApprove).mockResolvedValue({
      session: mockSession,
      agent: { id: "agent-1", companyId: "company-1", kind: "operator" },
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

  it("returns 403 when the caller cannot approve on the agent", async () => {
    vi.mocked(requireCheckpointApprove).mockRejectedValue(
      new Error("Unauthorized: You can't approve checkpoints on this operator agent"),
    );

    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(403);
    expect(pokeCronContinue).not.toHaveBeenCalled();
  });

  it("pokes cron continue after a successful resolve", async () => {
    const res = await POST(makeRequest({ action: "approve" }), params);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "approved" });
    expect(requireCheckpointApprove).toHaveBeenCalledWith("agent-1");
    expect(pokeCronContinue).toHaveBeenCalledWith("run-1");
  });

  it("discard resumes the run with a discarded tool result", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "discarded",
      executeResult: { status: "discarded" },
      checkpoint: pending,
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const res = await POST(makeRequest({ action: "discard" }), params);
    expect(res.status).toBe(200);
    expect(values).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith({
      runId: "run-1",
      role: "tool",
      content: JSON.stringify({
        kind: "checkpoint_result",
        checkpointId: "pending-1",
        status: "discarded",
      }),
    });
    expect(pokeCronContinue).toHaveBeenCalledWith("run-1");
  });

  it("Ask for changes posts the reply box feedback to the run and resumes it", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "changes_requested",
      executeResult: { status: "changes_requested", feedback: "Mention the pilot" },
      checkpoint: pending,
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const res = await POST(
      makeRequest({ action: "ask_for_changes", feedback: "Mention the pilot" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(values).toHaveBeenLastCalledWith({
      runId: "run-1",
      role: "user",
      content: "Mention the pilot",
    });
    expect(pokeCronContinue).toHaveBeenCalledWith("run-1");
  });

  it("a repeat Refresh writes nothing and does not poke again", async () => {
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
    expect(pokeCronContinue).not.toHaveBeenCalled();
  });

  it("the first Refresh posts the direction and pokes once", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: true,
      status: "stale",
      executeResult: { status: "refresh_requested" },
      checkpoint: pending,
      alreadyRequested: false,
    } as never);
    const values = vi.fn();
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await POST(makeRequest({ action: "refresh" }), params);
    expect(values).toHaveBeenCalledTimes(2);
    expect(pokeCronContinue).toHaveBeenCalledTimes(1);
  });

  it("does not resume the run on a conflict", async () => {
    vi.mocked(resolveCheckpoint).mockResolvedValue({
      ok: false,
      httpStatus: 409,
      status: "approved",
    });
    const res = await POST(makeRequest({ action: "discard" }), params);
    expect(res.status).toBe(409);
    expect(pokeCronContinue).not.toHaveBeenCalled();
  });
});
