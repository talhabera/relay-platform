import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireOperatorAgentEdit } from "../auth/access";
import { forkOperatorVersion } from "./agents";
import {
  getLiveVersion,
  nextLiveStatuses,
  promoteOperatorVersion,
} from "./versions";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agentVersions: { findFirst: vi.fn(), findMany: vi.fn() },
        agents: { findMany: vi.fn(), findFirst: vi.fn() },
        operatorAgentEditors: { findFirst: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireOperatorAgentEdit: vi.fn(),
}));

describe("nextLiveStatuses", () => {
  it("drafts the current live and lives the target", () => {
    expect(nextLiveStatuses("ver-old", "ver-new")).toEqual({
      demoteId: "ver-old",
      promoteId: "ver-new",
    });
  });

  it("is a no-op when promoting the already-live version", () => {
    expect(nextLiveStatuses("ver-1", "ver-1")).toBeNull();
  });
});

describe("getLiveVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the live version for an agent", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
      id: "ver-live",
      agentId: "agent-1",
      status: "live",
    } as never);

    const result = await getLiveVersion("agent-1");

    expect(result).toEqual({ id: "ver-live", agentId: "agent-1", status: "live" });
    expect(db.query.agentVersions.findFirst).toHaveBeenCalled();
  });
});

describe("promoteOperatorVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: { id: "agent-1" },
    } as never);
  });

  it("demotes the current live version and promotes the target in a transaction", async () => {
    const draftVersion = {
      id: "ver-draft",
      agentId: "agent-1",
      status: "draft" as const,
    };
    const liveVersion = {
      id: "ver-live",
      agentId: "agent-1",
      status: "live" as const,
    };

    vi.mocked(db.query.agentVersions.findFirst)
      .mockResolvedValueOnce(draftVersion as never)
      .mockResolvedValueOnce(liveVersion as never);

    const demoteWhere = vi.fn().mockResolvedValue(undefined);
    const demoteSet = vi.fn(() => ({ where: demoteWhere }));
    const promoteWhere = vi.fn().mockResolvedValue(undefined);
    const promoteSet = vi.fn(() => ({ where: promoteWhere }));
    const txUpdate = vi
      .fn()
      .mockReturnValueOnce({ set: demoteSet })
      .mockReturnValueOnce({ set: promoteSet });

    vi.mocked(db.transaction).mockImplementation(async (callback) =>
      callback({ update: txUpdate } as never),
    );

    const result = await promoteOperatorVersion("editor-1", "ver-draft");

    expect(result).toEqual({ versionId: "ver-draft" });
    expect(requireOperatorAgentEdit).toHaveBeenCalledWith("editor-1", "agent-1");
    expect(demoteSet).toHaveBeenCalledWith({ status: "draft" });
    expect(promoteSet).toHaveBeenCalledWith({ status: "live" });
    expect(demoteWhere).toHaveBeenCalledTimes(1);
    expect(promoteWhere).toHaveBeenCalledTimes(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("returns without updating when the target is already live", async () => {
    const liveVersion = {
      id: "ver-live",
      agentId: "agent-1",
      status: "live" as const,
    };

    vi.mocked(db.query.agentVersions.findFirst)
      .mockResolvedValueOnce(liveVersion as never)
      .mockResolvedValueOnce(liveVersion as never);

    const result = await promoteOperatorVersion("editor-1", "ver-live");

    expect(result).toEqual({ versionId: "ver-live" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("throws when the version does not exist", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue(undefined);

    await expect(promoteOperatorVersion("editor-1", "missing")).rejects.toThrow(
      "Version not found",
    );
  });
});

describe("forkOperatorVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperatorAgentEdit).mockResolvedValue({
      userId: "editor-1",
      agent: { id: "agent-1" },
    } as never);
  });

  it("copies instructions, toggles, and model", async () => {
    const parent = {
      id: "ver-parent",
      agentId: "agent-1",
      instructions: "Do things",
      toolToggles: {
        webSearch: true,
        excel: false,
        companyMemory: false,
        proposeAction: false,
      },
      model: "sonnet" as const,
    };

    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue(parent as never);

    const versionReturning = vi.fn().mockResolvedValue([{ id: "ver-new" }]);
    const versionValues = vi.fn(() => ({ returning: versionReturning }));
    vi.mocked(db.insert).mockReturnValueOnce({ values: versionValues } as never);

    const result = await forkOperatorVersion(
      "editor-1",
      "agent-1",
      "ver-parent",
      "v2",
    );

    expect(result).toEqual({ id: "ver-new" });
    expect(versionValues).toHaveBeenCalledWith({
      agentId: "agent-1",
      name: "v2",
      parentVersionId: "ver-parent",
      instructions: "Do things",
      toolToggles: parent.toolToggles,
      status: "draft",
      model: "sonnet",
      changeNote: null,
      createdByUserId: "editor-1",
    });
  });

  it("stores a trimmed change note from the fork dialog", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
      id: "ver-parent",
      agentId: "agent-1",
      instructions: "",
      toolToggles: {},
      model: "haiku",
    } as never);

    const returning = vi.fn().mockResolvedValue([{ id: "ver-new" }]);
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValueOnce({ values } as never);

    await forkOperatorVersion(
      "editor-1",
      "agent-1",
      "ver-parent",
      "v3",
      "  Stricter size criteria  ",
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ name: "v3", changeNote: "Stricter size criteria" }),
    );
  });

  it("maps unique version name violations to a friendly error", async () => {
    vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue({
      id: "ver-parent",
      agentId: "agent-1",
      instructions: "",
      toolToggles: {},
      model: "haiku",
    } as never);

    const returning = vi.fn().mockRejectedValue({ code: "23505" });
    const values = vi.fn(() => ({ returning }));
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await expect(
      forkOperatorVersion("editor-1", "agent-1", "ver-parent", "v2"),
    ).rejects.toThrow("Version name already exists");
  });
});
