import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireSession } from "@/lib/auth-server";
import {
  isCompanyOwner,
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
  requireOperatorSessionApprove,
} from "./access";

const session = {
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@relay.dev",
    image: null,
  },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const company = {
  id: "company-1",
  name: "Acme",
  ownerId: "owner-1",
};

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
    expect(isCompanyOwner("user-1", company)).toBe(false);
  });
});

describe("requireCompanyMembership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session);
  });

  it("succeeds when the user has a company_members row", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
    } as never);

    await expect(requireCompanyMembership(company.id)).resolves.toEqual({
      session,
      company,
    });
  });

  it("succeeds when the user is the company owner without a member row", async () => {
    const ownerSession = {
      ...session,
      user: { ...session.user, id: company.ownerId },
    };
    vi.mocked(requireSession).mockResolvedValue(ownerSession);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);

    await expect(requireCompanyMembership(company.id)).resolves.toEqual({
      session: ownerSession,
      company,
    });
    expect(db.query.companyMembers.findFirst).not.toHaveBeenCalled();
  });

  it("throws when the user is neither owner nor member", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(requireCompanyMembership(company.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });
});

describe("requireOperatorAgentAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session);
  });

  it("throws for a customer agent", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      customerAgent as never,
    );

    await expect(requireOperatorAgentAccess(customerAgent.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("succeeds for an operator agent when the user is a company member", async () => {
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      operatorAgent as never,
    );
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
    } as never);

    await expect(requireOperatorAgentAccess(operatorAgent.id)).resolves.toEqual({
      session,
      agent: operatorAgent,
    });
  });
});

describe("requireOperatorAgentEdit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      operatorAgent as never,
    );
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
    } as never);
  });

  it("throws when the user is a member but not creator or editor", async () => {
    await expect(requireOperatorAgentEdit(operatorAgent.id)).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("succeeds when the user is the agent creator", async () => {
    const creatorSession = {
      ...session,
      user: { ...session.user, id: operatorAgent.createdByUserId! },
    };
    vi.mocked(requireSession).mockResolvedValue(creatorSession);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: creatorSession.user.id,
    } as never);

    await expect(requireOperatorAgentEdit(operatorAgent.id)).resolves.toEqual({
      session: creatorSession,
      agent: operatorAgent,
    });
    expect(db.query.operatorAgentEditors.findFirst).not.toHaveBeenCalled();
  });

  it("succeeds when the user has an agent user row with canEdit", async () => {
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      id: "editor-1",
      agentId: operatorAgent.id,
      userId: session.user.id,
      canEdit: true,
      canApprove: false,
    } as never);

    await expect(requireOperatorAgentEdit(operatorAgent.id)).resolves.toEqual({
      session,
      agent: operatorAgent,
    });
  });

  it("throws when the user has an editor grant but membership was revoked", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(requireOperatorAgentEdit(operatorAgent.id)).rejects.toThrow(
      "Unauthorized:",
    );
    expect(db.query.operatorAgentEditors.findFirst).not.toHaveBeenCalled();
  });
});

describe("requireOperatorSessionApprove", () => {
  const operatorChat = {
    id: "chat-1",
    userId: session.user.id,
    companyId: company.id,
    agentId: operatorAgent.id,
    channelType: "operator",
  };

  function approverRow(canApprove: boolean) {
    return {
      id: "editor-1",
      agentId: operatorAgent.id,
      userId: session.user.id,
      canEdit: false,
      canApprove,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue(session);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      role: "member",
      pagePermissions: { operator: true, agents: false, messaging: false, analytics: false },
    } as never);
  });

  it("succeeds when the user can approve on the session's agent", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(operatorChat as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      approverRow(true) as never,
    );

    await expect(requireOperatorSessionApprove("chat-1")).resolves.toEqual({
      session,
      chat: operatorChat,
    });
  });

  it("lets an approver act on another member's session", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...operatorChat,
      userId: "other-user",
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      approverRow(true) as never,
    );

    await expect(requireOperatorSessionApprove("chat-1")).resolves.toBeDefined();
  });

  it("refuses a non-approver, even on their own session", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(operatorChat as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      approverRow(false) as never,
    );

    await expect(requireOperatorSessionApprove("chat-1")).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("lets the company owner approve without an agent user row", async () => {
    const ownerSession = { ...session, user: { ...session.user, id: company.ownerId } };
    vi.mocked(requireSession).mockResolvedValue(ownerSession);
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(operatorChat as never);

    await expect(requireOperatorSessionApprove("chat-1")).resolves.toBeDefined();
    expect(db.query.operatorAgentEditors.findFirst).not.toHaveBeenCalled();
  });

  it("rejects retired master chats", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...operatorChat,
      channelType: "master",
    } as never);

    await expect(requireOperatorSessionApprove("chat-1")).rejects.toThrow(
      "Unauthorized: Invalid operator session",
    );
  });

  it("throws when the chat is not an operator session", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...operatorChat,
      channelType: "web",
    } as never);

    await expect(requireOperatorSessionApprove("chat-1")).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("throws when the chat belongs to another company than its agent", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...operatorChat,
      companyId: "company-2",
    } as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(
      approverRow(true) as never,
    );

    await expect(requireOperatorSessionApprove("chat-1")).rejects.toThrow(
      "Unauthorized:",
    );
  });

  it("throws when the user is no longer a company member", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(operatorChat as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(requireOperatorSessionApprove("chat-1")).rejects.toThrow(
      "Unauthorized:",
    );
  });
});
