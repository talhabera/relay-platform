import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import {
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "../auth/access";
import {
  createOperatorAgent,
  getOperatorAgent,
  listOperatorAgents,
  updateOperatorVersion,
} from "./agents";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agents: { findMany: vi.fn(), findFirst: vi.fn() },
        agentVersions: { findMany: vi.fn(), findFirst: vi.fn() },
        operatorAgentEditors: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyMembership: vi.fn(),
  requireOperatorAgentAccess: vi.fn(),
  requireOperatorAgentEdit: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";

const operatorAgent = {
  id: agentId,
  name: "Ops Agent",
  description: "Internal",
  companyId,
  kind: "operator" as const,
  packageSlug: null,
  createdByUserId: "creator-1",
  versions: [
    {
      id: "ver-live",
      name: "v1",
      status: "live" as const,
      model: "haiku" as const,
      parentVersionId: null,
      createdAt: new Date("2026-01-01"),
    },
    {
      id: "ver-draft",
      name: "v2",
      status: "draft" as const,
      model: "sonnet" as const,
      parentVersionId: "ver-live",
      createdAt: new Date("2026-01-02"),
    },
  ],
};

describe("listOperatorAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      userId: "member-1",
      company: { id: companyId },
    } as never);
  });

  it("returns operator agents with versions and canEdit", async () => {
    vi.mocked(db.query.agents.findMany).mockResolvedValue([operatorAgent] as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
      id: "editor-1",
      agentId,
      userId: "member-1",
      canEdit: true,
      canApprove: true,
    } as never);

    const result = await listOperatorAgents("member-1", companyId);

    expect(result.agents).toEqual([
      {
        id: agentId,
        name: "Ops Agent",
        description: "Internal",
        packageSlug: null,
        createdByUserId: "creator-1",
        canEdit: true,
        versions: [
          {
            id: "ver-live",
            name: "v1",
            status: "live",
            model: "haiku",
            parentVersionId: null,
            createdAt: operatorAgent.versions[0].createdAt,
          },
          {
            id: "ver-draft",
            name: "v2",
            status: "draft",
            model: "sonnet",
            parentVersionId: "ver-live",
            createdAt: operatorAgent.versions[1].createdAt,
          },
        ],
      },
    ]);
    expect(requireCompanyMembership).toHaveBeenCalledWith("member-1", companyId);
  });

  it("marks canEdit false for members without edit access", async () => {
    vi.mocked(db.query.agents.findMany).mockResolvedValue([operatorAgent] as never);
    vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue(undefined);

    const result = await listOperatorAgents("viewer-1", companyId);

    expect(result.agents[0]?.canEdit).toBe(false);
  });
});

describe("getOperatorAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentAccess).mockResolvedValue({
      userId: "member-1",
      agent: operatorAgent,
    } as never);
  });

  it("returns versions and editors with user names", async () => {
    vi.mocked(db.query.agentVersions.findMany).mockResolvedValue([
      {
        id: "ver-live",
        name: "v1",
        status: "live",
        model: "haiku",
        instructions: "Help",
        toolToggles: {
          webSearch: false,
          excel: false,
          companyMemory: false,
          proposeAction: false,
        },
        parentVersionId: null,
        createdAt: new Date("2026-01-01"),
      },
    ] as never);
    vi.mocked(db.query.operatorAgentEditors.findMany).mockResolvedValue([
      {
        userId: "editor-1",
        user: { id: "editor-1", name: "Editor", email: "editor@example.com" },
      },
    ] as never);

    const result = await getOperatorAgent("member-1", agentId);

    expect(result).toMatchObject({
      id: agentId,
      name: "Ops Agent",
      editors: [
        {
          userId: "editor-1",
          name: "Editor",
          email: "editor@example.com",
        },
      ],
      versions: [{ id: "ver-live", name: "v1", status: "live" }],
    });
    expect(requireOperatorAgentAccess).toHaveBeenCalledWith("member-1", agentId);
  });
});

describe("createOperatorAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      userId: "creator-1",
      company: { id: companyId },
    } as never);
  });

  it("creates an operator agent with a live v1 version", async () => {
    const agentReturning = vi.fn().mockResolvedValue([{ id: agentId }]);
    const agentValues = vi.fn(() => ({ returning: agentReturning }));
    const versionReturning = vi.fn().mockResolvedValue([{ id: "ver-live" }]);
    const versionValues = vi.fn(() => ({ returning: versionReturning }));
    vi.mocked(db.insert)
      .mockReturnValueOnce({ values: agentValues } as never)
      .mockReturnValueOnce({ values: versionValues } as never);

    const result = await createOperatorAgent("creator-1", {
      companyId,
      name: "Ops Agent",
      description: "Internal",
    });

    expect(result).toEqual({ id: agentId, versionId: "ver-live" });
    expect(agentValues).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ops Agent",
        description: "Internal",
        companyId,
        kind: "operator",
        createdByUserId: "creator-1",
      }),
    );
    expect(versionValues).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId,
        name: "v1",
        instructions: "",
        status: "live",
        model: "haiku",
        createdByUserId: "creator-1",
      }),
    );
  });
});

describe("updateOperatorVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);
  });

  it("updates a draft version", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
      id: "ver-draft",
      agentId,
      status: "draft",
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateOperatorVersion("editor-1", "ver-draft", {
      instructions: "Updated",
      model: "opus",
    });

    expect(result).toEqual({ versionId: "ver-draft" });
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith("editor-1", agentId);
    expect(set).toHaveBeenCalledWith({
      instructions: "Updated",
      model: "opus",
    });
  });
});
