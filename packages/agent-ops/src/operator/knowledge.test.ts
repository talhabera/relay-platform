import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireOperatorAgentEdit } from "../auth/access";
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
  requireOperatorAgentEdit: vi.fn(),
}));

const companyId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const knowledgeId = "33333333-3333-4333-8333-333333333333";

const operatorAgent = {
  id: agentId,
  companyId,
  kind: "operator" as const,
};

const customerAgent = {
  id: agentId,
  companyId,
  kind: "customer" as const,
};

const knowledgeEntry = {
  id: knowledgeId,
  name: "Runbook",
  description: "Ops notes",
  agentId,
  companyId,
  type: "api" as const,
  content: "Step 1: check logs",
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

  it("returns knowledge entries for an operator agent", async () => {
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);
    vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([
      knowledgeEntry,
    ] as never);

    const result = await listKnowledge("editor-1", agentId);

    expect(result.entries).toEqual([
      {
        id: knowledgeId,
        name: "Runbook",
        description: "Ops notes",
        type: "api",
        content: "Step 1: check logs",
        sourceUrl: null,
        metadata: null,
        status: "ready",
        errorMessage: null,
        createdAt: knowledgeEntry.createdAt,
        updatedAt: knowledgeEntry.updatedAt,
      },
    ]);
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith("editor-1", agentId);
  });

  it("rejects customer agents", async () => {
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "owner-1",
      agent: customerAgent,
    } as never);

    await expect(listKnowledge("owner-1", agentId)).rejects.toThrow(
      "Only operator agents can be accessed",
    );
    expect(db.query.knowledgeBase.findMany).not.toHaveBeenCalled();
  });
});

describe("createTextKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates api knowledge with ready status", async () => {
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await createTextKnowledge("editor-1", {
      name: "Runbook",
      description: "Ops notes",
      agentId,
      companyId,
      type: "api",
      content: "Step 1: check logs",
    });

    expect(result).toEqual({ id: knowledgeId });
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith("editor-1", agentId);
    expect(values).toHaveBeenCalledWith({
      name: "Runbook",
      description: "Ops notes",
      agentId,
      companyId,
      type: "api",
      content: "Step 1: check logs",
      fileType: null,
      fileSize: null,
      status: "ready",
    });
  });

  it("stores Add text as a text/plain file row", async () => {
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await createTextKnowledge("editor-1", {
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
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await createTextKnowledge("editor-1", {
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
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: knowledgeId }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    const result = await beginWebsiteKnowledge("editor-1", {
      url: "https://example.com/runbook",
      name: "Runbook",
      agentId,
      companyId,
    });

    expect(result).toEqual({ id: knowledgeId, status: "processing" });
    expect(values).toHaveBeenCalledWith({
      name: "Runbook",
      description: null,
      agentId,
      companyId,
      type: "website",
      sourceUrl: "https://example.com/runbook",
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
      sourceUrl: "https://example.com/runbook",
    } as never);
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const metadata = {
      title: "Runbook",
      domain: "example.com",
      wordCount: 100,
      fetchedAt: "2026-01-01T00:00:00.000Z",
    };

    const result = await completeWebsiteKnowledge("editor-1", knowledgeId, {
      content: "# Runbook",
      metadata,
      name: "Example Runbook",
    });

    expect(result).toEqual({ id: knowledgeId, status: "ready" });
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith("editor-1", agentId);
    expect(set).toHaveBeenCalledWith({
      content: "# Runbook",
      metadata,
      name: "Example Runbook",
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
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await failWebsiteKnowledge(
      "editor-1",
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

  it("updates knowledge entry fields", async () => {
    vi.mocked(db.query.knowledgeBase.findFirst).mockResolvedValue(
      knowledgeEntry as never,
    );
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn(() => ({ where }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    const result = await updateKnowledge("editor-1", knowledgeId, {
      name: "Updated Runbook",
    });

    expect(result).toEqual({ id: knowledgeId });
    expect(set).toHaveBeenCalledWith({
      name: "Updated Runbook",
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
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: operatorAgent,
    } as never);

    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    const result = await deleteKnowledge("editor-1", knowledgeId);

    expect(result).toEqual({ id: knowledgeId });
    expect(where).toHaveBeenCalled();
  });
});
