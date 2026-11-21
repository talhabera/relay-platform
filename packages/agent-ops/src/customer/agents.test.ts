import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireAgentAccess, requireCompanyAccess } from "../auth/access";
import {
  createCustomerAgent,
  deleteCustomerAgent,
  getCustomerAgent,
  listCustomerAgents,
  updateCustomerAgent,
} from "./agents";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: { agents: { findMany: vi.fn(), findFirst: vi.fn() } },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      select: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyAccess: vi.fn(),
  requireAgentAccess: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";

const customerAgent = {
  id: "agent-1",
  name: "Support Bot",
  description: "Helps customers",
  instructions: "Be helpful",
  companyId,
  isActive: true,
  responseLength: "medium" as const,
  language: "en" as const,
  memoryEnabled: true,
  persona: "friendly" as const,
  kind: "customer" as const,
  model: "haiku" as const,
  createdByUserId: null,
  packageSlug: null,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const operatorAgent = {
  ...customerAgent,
  id: "agent-2",
  kind: "operator" as const,
};

function mockSelectCounts(counts: number[]) {
  let callIndex = 0;
  const where = vi.fn().mockImplementation(() => {
    const count = counts[callIndex] ?? 0;
    callIndex += 1;
    return Promise.resolve([{ count }]);
  });
  const from = vi.fn(() => ({ where }));
  vi.mocked(db.select).mockReturnValue({ from } as never);
  return { from, where };
}

describe("listCustomerAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns customer agents for the company", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.agents.findMany).mockResolvedValue([customerAgent] as never);

    const result = await listCustomerAgents("owner-1", companyId);

    expect(result.agents).toEqual([
      {
        id: "agent-1",
        name: "Support Bot",
        description: "Helps customers",
        model: "haiku",
        isActive: true,
        persona: "friendly",
        language: "en",
        responseLength: "medium",
        memoryEnabled: true,
      },
    ]);
    expect(requireCompanyAccess).toHaveBeenCalledWith("owner-1", companyId);
  });
});

describe("getCustomerAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the agent with related counts", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    mockSelectCounts([2, 1, 3]);

    const result = await getCustomerAgent("owner-1", "agent-1");

    expect(result).toMatchObject({
      id: "agent-1",
      name: "Support Bot",
      channelCount: 2,
      integrationCount: 1,
      knowledgeCount: 3,
    });
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", "agent-1");
    expect(db.select).toHaveBeenCalledTimes(3);
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(getCustomerAgent("owner-1", "agent-2")).rejects.toThrow(
      "Only customer agents in this company can be accessed",
    );
    expect(db.select).not.toHaveBeenCalled();
  });
});

describe("createCustomerAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a customer agent with default model", async () => {
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: "agent-new" }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createCustomerAgent("owner-1", {
      name: "Support Bot",
      description: "Helps customers",
      companyId,
    });

    expect(result).toEqual({ id: "agent-new" });
    expect(requireCompanyAccess).toHaveBeenCalledWith("owner-1", companyId);
    expect(values).toHaveBeenCalledWith({
      name: "Support Bot",
      description: "Helps customers",
      companyId,
      kind: "customer",
      model: "haiku",
    });
  });
});

describe("updateCustomerAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a customer agent", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateCustomerAgent("owner-1", "agent-1", {
      name: "Renamed Bot",
    });

    expect(result).toEqual({ id: "agent-1" });
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", "agent-1");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Renamed Bot",
        updatedAt: expect.any(Date),
      }),
    );
    expect(where).toHaveBeenCalled();
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(
      updateCustomerAgent("owner-1", "agent-2", { name: "Nope" }),
    ).rejects.toThrow("Only customer agents in this company can be updated");
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("deleteCustomerAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a customer agent", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    const result = await deleteCustomerAgent("owner-1", "agent-1");

    expect(result).toEqual({ id: "agent-1" });
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", "agent-1");
    expect(where).toHaveBeenCalled();
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(deleteCustomerAgent("owner-1", "agent-2")).rejects.toThrow(
      "Only customer agents in this company can be deleted",
    );
    expect(db.delete).not.toHaveBeenCalled();
  });
});
