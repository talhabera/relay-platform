import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireAgentAccess, requireCompanyAccess } from "../auth/access";
import {
  beginWebsiteKnowledge,
  completeWebsiteKnowledge,
  createTextKnowledge,
  deleteKnowledge,
  failWebsiteKnowledge,
  listKnowledge,
  updateKnowledge,
} from "./knowledge";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agents: { findFirst: vi.fn() },
        knowledgeBase: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyAccess: vi.fn(),
  requireAgentAccess: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const knowledgeId = "33333333-3333-4333-8333-333333333333";

const customerAgent = {
  id: agentId,
  companyId,
  kind: "customer" as const,
};

const operatorAgent = {
  id: agentId,
  companyId,
  kind: "operator" as const,
};

const knowledgeEntry = {
  id: knowledgeId,
  name: "FAQ",
  description: "Common questions",
  agentId,
  companyId,
  type: "api" as const,
  content: "Answer 1: Yes",
  fileType: null,
  fileSize: null,
  sourceUrl: null,
  metadata: null,
  errorMessage: null,
  status: "ready" as const,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("listKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns knowledge entries with content for a customer agent", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([
      knowledgeEntry,
    ] as never);

    const result = await listKnowledge("owner-1", agentId);

    expect(result.entries).toEqual([
      {
        id: knowledgeId,
        name: "FAQ",
        description: "Common questions",
        type: "api",
        content: "Answer 1: Yes",
        sourceUrl: null,
        metadata: null,
        status: "ready",
        errorMessage: null,
        createdAt: knowledgeEntry.createdAt,
        updatedAt: knowledgeEntry.updatedAt,
      },
    ]);
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", agentId);
  });

  it("rejects operator agents", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: operatorAgent,
    } as never);

    await expect(listKnowledge("owner-1", agentId)).rejects.toThrow(
      "Only customer agents in this company can be accessed",
    );
    expect(db.query.knowledgeBase.findMany).not.toHaveBeenCalled();
  });
});

describe("createTextKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates api knowledge with ready status", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createTextKnowledge("owner-1", {
      name: "FAQ",
      description: "Common questions",
      agentId,
      companyId,
      type: "api",
      content: "Answer 1: Yes",
    });

    expect(result).toEqual({ id: knowledgeId });
    expect(requireAgentAccess).toHaveBeenCalledWith("owner-1", agentId);
    expect(requireCompanyAccess).toHaveBeenCalledWith("owner-1", companyId);
    expect(values).toHaveBeenCalledWith({
      name: "FAQ",
      description: "Common questions",
      agentId,
      companyId,
      type: "api",
      content: "Answer 1: Yes",
      fileType: null,
      fileSize: null,
      status: "ready",
    });
  });

  it("stores Add text as a text/plain file row", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await createTextKnowledge("owner-1", {
      name: "Goals",
      agentId,
      companyId,
      type: "file",
      content: "Ship the brief",
      fileType: "text/plain",
    });

    expect(values).toHaveBeenCalledWith({
      name: "Goals",
      description: null,
      agentId,
      companyId,
      type: "file",
      content: "Ship the brief",
      fileType: "text/plain",
      fileSize: null,
      status: "ready",
    });
  });

  it("stores an uploaded file with its type and size", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await createTextKnowledge("owner-1", {
      name: "Doc.md",
      agentId,
      companyId,
      type: "file",
      content: "# Doc",
      fileType: "text/markdown",
      fileSize: 1024,
    });

    expect(values).toHaveBeenCalledWith({
      name: "Doc.md",
      description: null,
      agentId,
      companyId,
      type: "file",
      content: "# Doc",
      fileType: "text/markdown",
      fileSize: 1024,
      status: "ready",
    });
  });
});

describe("beginWebsiteKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a processing website row", async () => {
    vi.mocked(requireAgentAccess).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await beginWebsiteKnowledge("owner-1", {
      url: "https://example.com/docs",
      name: "Docs",
      agentId,
      companyId,
    });

    expect(result).toEqual({ id: knowledgeId, status: "processing" });
    expect(values).toHaveBeenCalledWith({
      name: "Docs",
      description: null,
      agentId,
      companyId,
      type: "website",
      sourceUrl: "https://example.com/docs",
      status: "processing",
    });
  });
});

describe("completeWebsiteKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks website knowledge ready with fetched content", async () => {
    vi.mocked(db.query.knowledgeBase.findFirst).mockResolvedValue({
      ...knowledgeEntry,
      type: "website",
      status: "processing",
      sourceUrl: "https://example.com/docs",
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      customerAgent as never,
    );

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const metadata = {
      title: "Docs",
      domain: "example.com",
      wordCount: 100,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = await completeWebsiteKnowledge("owner-1", knowledgeId, {
      content: "# Docs",
      metadata,
      name: "Example Docs",
    });

    expect(result).toEqual({ id: knowledgeId, status: "ready" });
    expect(requireCompanyAccess).toHaveBeenCalledWith("owner-1", companyId);
    expect(set).toHaveBeenCalledWith({
      content: "# Docs",
      metadata,
      name: "Example Docs",
      status: "ready",
      updatedAt: expect.any(Date),
    });
  });
});

describe("failWebsiteKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks website knowledge as error", async () => {
    vi.mocked(db.query.knowledgeBase.findFirst).mockResolvedValue({
      ...knowledgeEntry,
      type: "website",
      status: "processing",
    } as never);
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      customerAgent as never,
    );

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await failWebsiteKnowledge(
      "owner-1",
      knowledgeId,
      "Fetch failed",
    );

    expect(result).toEqual({ id: knowledgeId, status: "error" });
    expect(set).toHaveBeenCalledWith({
      status: "error",
      errorMessage: "Fetch failed",
      updatedAt: expect.any(Date),
    });
  });
});

describe("updateKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a knowledge entry", async () => {
    vi.mocked(db.query.knowledgeBase.findFirst).mockResolvedValue(
      knowledgeEntry as never,
    );
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      customerAgent as never,
    );

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateKnowledge("owner-1", knowledgeId, {
      name: "Updated FAQ",
    });

    expect(result).toEqual({ id: knowledgeId });
    expect(set).toHaveBeenCalledWith({
      name: "Updated FAQ",
      updatedAt: expect.any(Date),
    });
  });
});

describe("deleteKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a knowledge entry", async () => {
    vi.mocked(db.query.knowledgeBase.findFirst).mockResolvedValue(
      knowledgeEntry as never,
    );
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      userId: "owner-1",
      company: { id: companyId },
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      customerAgent as never,
    );

    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    const result = await deleteKnowledge("owner-1", knowledgeId);

    expect(result).toEqual({ id: knowledgeId });
    expect(where).toHaveBeenCalled();
  });
});
