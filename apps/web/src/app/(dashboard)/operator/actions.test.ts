import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-server";
import { revalidatePath } from "next/cache";
import {
  createOperatorAgent as createOperatorAgentOp,
  forkOperatorVersion as forkOperatorVersionOp,
  grantApprover,
  grantEditor,
  revokeApprover,
  revokeEditor,
} from "@relay/agent-ops";
import {
  createOperatorAgent,
  forkOperatorVersion,
  setOperatorAgentUserApprove,
  setOperatorAgentUserEdit,
} from "./actions";

vi.mock("@relay/agent-ops", () => ({
  createOperatorAgent: vi.fn(),
  forkOperatorVersion: vi.fn(),
  updateOperatorVersion: vi.fn(),
  promoteOperatorVersion: vi.fn(),
  grantEditor: vi.fn(),
  revokeEditor: vi.fn(),
  grantApprover: vi.fn(),
  revokeApprover: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const agentId = "660e8400-e29b-41d4-a716-446655440001";
const parentVersionId = "770e8400-e29b-41d4-a716-446655440002";

const session = {
  user: { id: "user-1", name: "Ada", email: "ada@relay.dev", image: null },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

describe("createOperatorAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("delegates to agent-ops with session user id", async () => {
    vi.mocked(createOperatorAgentOp).mockResolvedValue({
      id: agentId,
      versionId: "880e8400-e29b-41d4-a716-446655440003",
    });

    const result = await createOperatorAgent({
      companyId,
      name: "Ops Agent",
      description: "Handles internal workflows",
    });

    expect(createOperatorAgentOp).toHaveBeenCalledWith("user-1", {
      companyId,
      name: "Ops Agent",
      description: "Handles internal workflows",
    });
    expect(result).toEqual({
      id: agentId,
      versionId: "880e8400-e29b-41d4-a716-446655440003",
    });
  });
});

describe("forkOperatorVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("delegates fork to agent-ops", async () => {
    vi.mocked(forkOperatorVersionOp).mockResolvedValue({
      id: "fork-version-1",
    });

    const result = await forkOperatorVersion(agentId, parentVersionId, "v2");

    expect(forkOperatorVersionOp).toHaveBeenCalledWith(
      "user-1",
      agentId,
      parentVersionId,
      "v2",
      undefined,
    );
    expect(result).toEqual({ id: "fork-version-1" });
    expect(revalidatePath).toHaveBeenCalledWith("/agents/operator");
  });

  it("passes the change note through", async () => {
    vi.mocked(forkOperatorVersionOp).mockResolvedValue({ id: "fork-version-2" });

    await forkOperatorVersion(agentId, parentVersionId, "v3", "Stricter size criteria");

    expect(forkOperatorVersionOp).toHaveBeenCalledWith(
      "user-1",
      agentId,
      parentVersionId,
      "v3",
      "Stricter size criteria",
    );
  });

  it("propagates version name uniqueness errors from agent-ops", async () => {
    vi.mocked(forkOperatorVersionOp).mockRejectedValue(
      new Error("Version name already exists"),
    );

    await expect(
      forkOperatorVersion(agentId, parentVersionId, "v2"),
    ).rejects.toThrow("Version name already exists");
  });
});

describe("Access tab toggles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session as never);
  });

  it("Edit on/off grants or revokes edit as the session user", async () => {
    await setOperatorAgentUserEdit(agentId, "member-1", true);
    expect(grantEditor).toHaveBeenCalledWith("user-1", agentId, "member-1");
    await setOperatorAgentUserEdit(agentId, "member-1", false);
    expect(revokeEditor).toHaveBeenCalledWith("user-1", agentId, "member-1");
    expect(revalidatePath).toHaveBeenCalledWith("/agents/operator");
  });

  it("Approve on/off goes through the owner-only approver ops", async () => {
    await setOperatorAgentUserApprove(agentId, "member-1", true);
    expect(grantApprover).toHaveBeenCalledWith("user-1", agentId, "member-1");
    await setOperatorAgentUserApprove(agentId, "member-1", false);
    expect(revokeApprover).toHaveBeenCalledWith("user-1", agentId, "member-1");
  });

  it("surfaces the owner-only refusal from agent-ops", async () => {
    vi.mocked(grantApprover).mockRejectedValue(
      new Error("Unauthorized: Only the company owner can grant or revoke approve"),
    );
    await expect(setOperatorAgentUserApprove(agentId, "member-1", true)).rejects.toThrow(
      "Only the company owner",
    );
  });
});
