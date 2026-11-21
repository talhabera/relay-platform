import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import {
  canApproveCheckpoint,
  isCompanyOwner,
  requireAgentAccess,
  requireCheckpointApprove,
  requireCompanyAccess,
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "./access";

vi.mock("@relay/db", () => ({
  agents: { id: "agents" },
  companies: { id: "companies" },
  companyMembers: { companyId: "companyMembers.companyId", userId: "companyMembers.userId" },
  operatorAgentEditors: {
    agentId: "operatorAgentEditors.agentId",
    userId: "operatorAgentEditors.userId",
  },
  db: {
    query: {
      companies: { findFirst: vi.fn() },
      companyMembers: { findFirst: vi.fn() },
      agents: { findFirst: vi.fn() },
      operatorAgentEditors: { findFirst: vi.fn() },
    },
  },
}));

const company = {
  id: "company-1",
  name: "Acme",
  ownerId: "owner-1",
};

const memberUserId = "user-1";

const operatorAgent = {
  id: "agent-1",
  name: "Ops Agent",
  companyId: company.id,
  kind: "operator" as const,
  createdByUserId: "creator-1",
  company,
};

const customerAgent = {
  ...operatorAgent,
  id: "agent-2",
  kind: "customer" as const,
};

describe("isCompanyOwner", () => {
  it("returns true when userId matches company.ownerId", () => {
    expect(isCompanyOwner("owner-1", company)).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(isCompanyOwner(memberUserId, company)).toBe(false);
  });
});

describe("requireCompanyAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds for the company owner", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);

    await expect(
      requireCompanyAccess(company.ownerId, company.id),
    ).resolves.toEqual({ userId: company.ownerId, company });
  });

  it("throws for a non-owner", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);

    await expect(requireCompanyAccess(memberUserId, company.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("throws when the company does not exist", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);

    await expect(requireCompanyAccess(company.ownerId, company.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });
});

describe("requireCompanyMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds when the user has a company_members row", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: memberUserId,
    } as never);

    await expect(requireCompanyMembership(memberUserId, company.id)).resolves.toEqual({
      userId: memberUserId,
      company,
    });
  });

  it("succeeds when the user is the company owner without a member row", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);

    await expect(
      requireCompanyMembership(company.ownerId, company.id),
    ).resolves.toEqual({ userId: company.ownerId, company });
    expect(db.query.companyMembers.findFirst).not.toHaveBeenCalled();
  });

  it("throws when the user is neither owner nor member", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(requireCompanyMembership(memberUserId, company.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });
});

describe("requireAgentAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("succeeds when the user owns the agent company", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);

    await expect(
      requireAgentAccess(company.ownerId, operatorAgent.id),
    ).resolves.toEqual({ userId: company.ownerId, agent: operatorAgent });
  });

  it("throws when the user does not own the agent company", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);

    await expect(requireAgentAccess(memberUserId, operatorAgent.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });
});

describe("requireOperatorAgentAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws for a customer agent", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(customerAgent as never);

    await expect(
      requireOperatorAgentAccess(memberUserId, customerAgent.id),
    ).rejects.toThrow("Unauthorized:");
  });

  it("succeeds for an operator agent when the user is a company member", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: memberUserId,
    } as never);

    await expect(
      requireOperatorAgentAccess(memberUserId, operatorAgent.id),
    ).resolves.toEqual({ userId: memberUserId, agent: operatorAgent });
  });
});

describe("requireOperatorAgentEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: memberUserId,
    } as never);
  });

  it("throws when the user is a member but not creator or editor", async () => {
    await expect(
      requireOperatorAgentEdit(memberUserId, operatorAgent.id),
    ).rejects.toThrow("Unauthorized:");
  });

  it("succeeds when the user is the agent creator", async () => {
    const creatorId = operatorAgent.createdByUserId!;
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: creatorId,
    } as never);

    await expect(
      requireOperatorAgentEdit(creatorId, operatorAgent.id),
    ).resolves.toEqual({ userId: creatorId, agent: operatorAgent });
    expect(db.query.operatorAgentEditors.findFirst).not.toHaveBeenCalled();
  });

  it("succeeds when the user has an agent user row with canEdit", async () => {
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      id: "editor-1",
      agentId: operatorAgent.id,
      userId: memberUserId,
      canEdit: true,
      canApprove: false,
    } as never);

    await expect(
      requireOperatorAgentEdit(memberUserId, operatorAgent.id),
    ).resolves.toEqual({ userId: memberUserId, agent: operatorAgent });
  });

  it("throws for an approve-only agent user row (canEdit false)", async () => {
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      id: "editor-1",
      agentId: operatorAgent.id,
      userId: memberUserId,
      canEdit: false,
      canApprove: true,
    } as never);

    await expect(
      requireOperatorAgentEdit(memberUserId, operatorAgent.id),
    ).rejects.toThrow("Unauthorized:");
  });

  it("throws when membership was revoked before edit check", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(
      requireOperatorAgentEdit(memberUserId, operatorAgent.id),
    ).rejects.toThrow("Unauthorized:");
    expect(db.query.operatorAgentEditors.findFirst).not.toHaveBeenCalled();
  });
});

describe("client rows fail every member helper (worker included)", () => {
  const clientRow = {
    id: "member-client",
    companyId: company.id,
    userId: memberUserId,
    role: "client",
    pagePermissions: { operator: true },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(clientRow as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      agentId: operatorAgent.id,
      userId: memberUserId,
      canEdit: true,
      canApprove: true,
    } as never);
  });

  it.each([
    ["requireCompanyMembership", () => requireCompanyMembership(memberUserId, company.id)],
    ["requireOperatorAgentAccess", () => requireOperatorAgentAccess(memberUserId, operatorAgent.id)],
    ["requireOperatorAgentEdit", () => requireOperatorAgentEdit(memberUserId, operatorAgent.id)],
    ["requireCheckpointApprove", () => requireCheckpointApprove(memberUserId, operatorAgent.id)],
  ] as const)("%s refuses a client row", async (_name, run) => {
    await expect(run()).rejects.toThrow("Unauthorized:");
  });
});

// Approve-rights matrix (spec 2026-10-02-approve-rights, decisions 2 and 6).
// approve = Approve/Reject/Retry/Discard; steer = Send back / Refresh / answer
// an agent question, which any operator-agent user may do.
describe("approve rights matrix", () => {
  type Actor =
    | "owner"
    | "creator"
    | "approver"
    | "nonApprover"
    | "approverWithoutOperatorPage"
    | "client";

  const ids: Record<Actor, string> = {
    owner: company.ownerId,
    creator: operatorAgent.createdByUserId,
    approver: "approver-1",
    nonApprover: "editor-only-1",
    approverWithoutOperatorPage: "approver-no-page-1",
    client: "client-1",
  };

  const memberRow = (role: string, operator: boolean) => ({
    id: "row",
    companyId: company.id,
    role,
    pagePermissions: { operator, agents: false, messaging: false, analytics: false },
  });

  const rows: Record<Actor, { membership: unknown; agentUser: unknown }> = {
    owner: { membership: undefined, agentUser: undefined },
    creator: { membership: memberRow("member", true), agentUser: undefined },
    approver: {
      membership: memberRow("member", true),
      agentUser: { canEdit: false, canApprove: true },
    },
    nonApprover: {
      membership: memberRow("member", true),
      agentUser: { canEdit: true, canApprove: false },
    },
    approverWithoutOperatorPage: {
      membership: memberRow("member", false),
      agentUser: { canEdit: false, canApprove: true },
    },
    client: {
      membership: memberRow("client", true),
      agentUser: { canEdit: true, canApprove: true },
    },
  };

  const expected: Record<Actor, { approve: boolean; steer: boolean }> = {
    owner: { approve: true, steer: true },
    creator: { approve: true, steer: true },
    approver: { approve: true, steer: true },
    nonApprover: { approve: false, steer: true },
    approverWithoutOperatorPage: { approve: false, steer: true },
    client: { approve: false, steer: false },
  };

  function arrange(actor: Actor) {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(
      rows[actor].membership as never,
    );
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      rows[actor].agentUser as never,
    );
  }

  beforeEach(() => {
    vi.resetAllMocks();
  });

  for (const actor of Object.keys(expected) as Actor[]) {
    it(`approve ${expected[actor].approve ? "passes" : "refuses"} ${actor}`, async () => {
      arrange(actor);
      const run = requireCheckpointApprove(ids[actor], operatorAgent.id);
      if (expected[actor].approve) {
        await expect(run).resolves.toEqual({ userId: ids[actor], agent: operatorAgent });
      } else {
        await expect(run).rejects.toThrow("Unauthorized:");
      }
    });

    it(`steer ${expected[actor].steer ? "passes" : "refuses"} ${actor}`, async () => {
      arrange(actor);
      const run = requireOperatorAgentAccess(ids[actor], operatorAgent.id);
      if (expected[actor].steer) {
        await expect(run).resolves.toBeDefined();
      } else {
        await expect(run).rejects.toThrow("Unauthorized:");
      }
    });

    it(`canApproveCheckpoint agrees with requireCheckpointApprove for ${actor}`, () => {
      expect(
        canApproveCheckpoint({
          userId: ids[actor],
          company,
          agent: operatorAgent,
          membership: rows[actor].membership as never,
          agentUser: rows[actor].agentUser as never,
        }),
      ).toBe(expected[actor].approve);
    });
  }

  it("refuses a user with no membership", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    await expect(
      requireCheckpointApprove("stranger", operatorAgent.id),
    ).rejects.toThrow("Unauthorized:");
  });

  it("refuses a customer agent", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(customerAgent as never);
    await expect(
      requireCheckpointApprove(company.ownerId, customerAgent.id),
    ).rejects.toThrow("Unauthorized:");
  });
});
