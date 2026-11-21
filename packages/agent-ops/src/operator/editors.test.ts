import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireOperatorAgentAccess, requireOperatorAgentEdit } from "../auth/access";
import {
  grantApprover,
  grantEditor,
  listEditors,
  revokeApprover,
  revokeEditor,
} from "./editors";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        companyMembers: { findFirst: vi.fn() },
        operatorAgentEditors: { findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  isCompanyOwner: vi.fn((userId: string, company: { ownerId: string }) =>
    userId === company.ownerId,
  ),
  requireOperatorAgentAccess: vi.fn(),
  requireOperatorAgentEdit: vi.fn(),
}));

const userId = "editor-granter";
const agentId = "22222222-2222-4222-8222-222222222222";
const targetUserId = "target-member";
const companyId = "11111111-1111-4111-8111-111111111111";

const agent = {
  id: agentId,
  companyId,
  createdByUserId: "creator-user",
  company: { id: companyId, ownerId: "owner-user" },
};

function mockInsert() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return { values, onConflictDoUpdate };
}

function mockUpdateAndDelete() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where: updateWhere }));
  vi.mocked(db.update).mockReturnValue({ set } as never);
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  vi.mocked(db.delete).mockReturnValue({ where: deleteWhere } as never);
  return { set, updateWhere, deleteWhere };
}

const memberRow = { id: "member-row", role: "member" };

describe("listEditors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      userId,
      agent,
    } as never);
  });

  it("returns agent users with their flags", async () => {
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([
      {
        userId: targetUserId,
        canEdit: false,
        canApprove: true,
        user: { name: "Member", email: "member@example.com" },
      },
    ] as never);

    const editors = await listEditors(userId, agentId);

    expect(editors).toEqual([
      {
        userId: targetUserId,
        name: "Member",
        email: "member@example.com",
        canEdit: false,
        canApprove: true,
      },
    ]);
  });
});

describe("grantEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent,
    } as never);
  });

  it("rejects granting edit to the agent creator", async () => {
    await expect(
      grantEditor(userId, agentId, agent.createdByUserId),
    ).rejects.toThrow("Agent creator already has edit");

    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects non-members", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(grantEditor(userId, agentId, targetUserId)).rejects.toThrow(
      "User is not a member of this company",
    );
  });

  it("rejects client users", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-row",
      role: "client",
    } as never);

    await expect(grantEditor(userId, agentId, targetUserId)).rejects.toThrow(
      "Client users cannot be agent users",
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("inserts edit without approve, and only sets canEdit on an existing row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(memberRow as never);
    const { values, onConflictDoUpdate } = mockInsert();

    await expect(grantEditor(userId, agentId, targetUserId)).resolves.toBeUndefined();

    expect(values).toHaveBeenCalledWith({
      agentId,
      userId: targetUserId,
      canEdit: true,
      canApprove: false,
      grantedByUserId: userId,
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { canEdit: true } }),
    );
  });
});

describe("revokeEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId,
      agent,
    } as never);
  });

  it("clears canEdit, then drops the row only if it has no flags left", async () => {
    const { set, updateWhere, deleteWhere } = mockUpdateAndDelete();

    await revokeEditor(userId, agentId, targetUserId);

    expect(set).toHaveBeenCalledWith({ canEdit: false });
    expect(updateWhere).toHaveBeenCalled();
    expect(deleteWhere).toHaveBeenCalled();
  });
});

describe("grantApprover / revokeApprover (owner only)", () => {
  const ownerId = agent.company.ownerId;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      userId: ownerId,
      agent,
    } as never);
  });

  it("refuses a non-owner, even one with edit", async () => {
    await expect(
      grantApprover(userId, agentId, targetUserId),
    ).rejects.toThrow("Only the company owner");
    await expect(
      revokeApprover(userId, agentId, targetUserId),
    ).rejects.toThrow("Only the company owner");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it("refuses the agent creator and the owner as targets", async () => {
    await expect(
      grantApprover(ownerId, agentId, agent.createdByUserId),
    ).rejects.toThrow("Agent creator already approves");
    await expect(grantApprover(ownerId, agentId, ownerId)).rejects.toThrow(
      "Owner already approves",
    );
  });

  it("refuses client users", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-row",
      role: "client",
    } as never);
    await expect(grantApprover(ownerId, agentId, targetUserId)).rejects.toThrow(
      "Client users cannot be agent users",
    );
  });

  it("inserts approve without edit, and only sets canApprove on an existing row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(memberRow as never);
    const { values, onConflictDoUpdate } = mockInsert();

    await grantApprover(ownerId, agentId, targetUserId);

    expect(values).toHaveBeenCalledWith({
      agentId,
      userId: targetUserId,
      canEdit: false,
      canApprove: true,
      grantedByUserId: ownerId,
    });
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ set: { canApprove: true } }),
    );
  });

  it("revoke clears canApprove and drops an empty row", async () => {
    const { set, deleteWhere } = mockUpdateAndDelete();

    await revokeApprover(ownerId, agentId, targetUserId);

    expect(set).toHaveBeenCalledWith({ canApprove: false });
    expect(deleteWhere).toHaveBeenCalled();
  });
});
