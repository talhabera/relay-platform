import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireCompanyMembership } from "../auth/access";
import { addBriefItemAsTask, setBriefItemStatus } from "./daily-briefs";
import { completeTask } from "./tasks";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        projects: { findFirst: vi.fn() },
      },
      transaction: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyMembership: vi.fn(),
}));

vi.mock("./tasks", () => ({
  completeTask: vi.fn(),
}));

const userId = "user-1";
const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const briefId = "660e8400-e29b-41d4-a716-446655440001";
const taskId = "770e8400-e29b-41d4-a716-446655440002";
const newTaskId = "880e8400-e29b-41d4-a716-446655440003";
const projectId = "990e8400-e29b-41d4-a716-446655440004";

type BriefItem = {
  rank: number;
  kind: "do" | "setup" | "decide";
  title: string;
  why: string;
  href: string | null;
  taskId?: string | null;
  status?: "open" | "done" | "dismissed";
};

let briefRow: { id: string; companyId: string; items: BriefItem[] } | null;

function items(): BriefItem[] {
  return [
    { rank: 1, kind: "do", title: "Approve outreach", why: "2 leads wait", href: "/needs-you", taskId },
    { rank: 2, kind: "setup", title: "Reconnect Instagram", why: "Token expired", href: "/settings/connectors" },
  ];
}

/** Stateful tx: `set({ items })` writes back onto briefRow, like the real row. */
function setupTx() {
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn((values: { items?: BriefItem[] }) => {
    if (briefRow && values.items) briefRow.items = values.items;
    return { where: updateWhere };
  });
  const insertReturning = vi.fn().mockResolvedValue([{ id: newTaskId, companyId }]);
  const insertValues = vi.fn(() => ({ returning: insertReturning }));
  const forFn = vi.fn(async () => (briefRow ? [{ ...briefRow, items: briefRow.items }] : []));
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ for: forFn })),
      })),
    })),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  vi.mocked(db.transaction).mockImplementation(async (callback) =>
    callback(tx as never),
  );
  return { tx, updateSet, updateWhere, insertValues, forFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  briefRow = { id: briefId, companyId, items: items() };
  vi.mocked(requireCompanyMembership).mockResolvedValue({
    userId,
    company: { id: companyId, ownerId: userId, timezone: "UTC" },
  } as never);
  vi.mocked(completeTask).mockResolvedValue({ task: { id: taskId }, followUp: null } as never);
});

describe("setBriefItemStatus", () => {
  it("refuses a brief of another company as not found", async () => {
    briefRow = { id: briefId, companyId: otherCompanyId, items: items() };
    const { tx } = setupTx();

    await expect(
      setBriefItemStatus(userId, { companyId, briefId, rank: 1, status: "done" }),
    ).rejects.toThrow(/not found/i);
    expect(requireCompanyMembership).toHaveBeenCalledWith(userId, companyId);
    expect(tx.update).not.toHaveBeenCalled();
    expect(completeTask).not.toHaveBeenCalled();
  });

  it("refuses when membership is rejected and opens no transaction", async () => {
    setupTx();
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("Unauthorized"));

    await expect(
      setBriefItemStatus(userId, { companyId, briefId, rank: 1, status: "done" }),
    ).rejects.toThrow("Unauthorized");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("refuses an unknown rank", async () => {
    const { tx } = setupTx();

    await expect(
      setBriefItemStatus(userId, { companyId, briefId, rank: 99, status: "done" }),
    ).rejects.toThrow(/not found/i);
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("Done completes the linked task and marks only that item done", async () => {
    const { updateSet, forFn } = setupTx();

    await setBriefItemStatus(userId, { companyId, briefId, rank: 1, status: "done" });

    expect(forFn).toHaveBeenCalledWith("update");
    expect(completeTask).toHaveBeenCalledWith(userId, taskId);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({ rank: 1, status: "done", taskId }),
          expect.objectContaining({ rank: 2 }),
        ],
        updatedAt: expect.any(Date),
      }),
    );
    expect(briefRow?.items[1].status).toBeUndefined();
  });

  it("Done without a task only marks the item", async () => {
    setupTx();

    await setBriefItemStatus(userId, { companyId, briefId, rank: 2, status: "done" });

    expect(completeTask).not.toHaveBeenCalled();
    expect(briefRow?.items.find((i) => i.rank === 2)?.status).toBe("done");
    expect(briefRow?.items.find((i) => i.rank === 1)?.status).toBeUndefined();
  });

  it("Dismiss sets dismissed and open undoes it, without touching tasks", async () => {
    setupTx();

    await setBriefItemStatus(userId, { companyId, briefId, rank: 1, status: "dismissed" });
    expect(briefRow?.items[0].status).toBe("dismissed");
    expect(completeTask).not.toHaveBeenCalled();

    await setBriefItemStatus(userId, { companyId, briefId, rank: 1, status: "open" });
    expect(briefRow?.items[0].status).toBe("open");
    expect(completeTask).not.toHaveBeenCalled();
  });
});

describe("addBriefItemAsTask", () => {
  it("creates a brief-sourced task from the item and links it on the item", async () => {
    const { insertValues, updateSet } = setupTx();

    const task = await addBriefItemAsTask(userId, { companyId, briefId, rank: 2 });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        title: "Reconnect Instagram",
        notes: "Token expired",
        source: "brief",
        briefId,
        createdByUserId: userId,
      }),
    );
    expect(task).toEqual(expect.objectContaining({ id: newTaskId }));
    expect(briefRow?.items.find((i) => i.rank === 2)?.taskId).toBe(newTaskId);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ updatedAt: expect.any(Date) }),
    );
  });

  it("refuses Add as task a second time for the same item", async () => {
    const { tx } = setupTx();

    await addBriefItemAsTask(userId, { companyId, briefId, rank: 2 });
    await expect(
      addBriefItemAsTask(userId, { companyId, briefId, rank: 2 }),
    ).rejects.toThrow(/already/i);
    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it("refuses an item that already has a taskId, an unknown rank and another company's brief", async () => {
    const { tx } = setupTx();

    await expect(
      addBriefItemAsTask(userId, { companyId, briefId, rank: 1 }),
    ).rejects.toThrow(/already/i);
    await expect(
      addBriefItemAsTask(userId, { companyId, briefId, rank: 99 }),
    ).rejects.toThrow(/not found/i);

    briefRow = { id: briefId, companyId: otherCompanyId, items: items() };
    await expect(
      addBriefItemAsTask(userId, { companyId, briefId, rank: 2 }),
    ).rejects.toThrow(/not found/i);
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it("refuses a project from another company and accepts one of this company", async () => {
    const { tx, insertValues } = setupTx();
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId: otherCompanyId,
    } as never);

    await expect(
      addBriefItemAsTask(userId, { companyId, briefId, rank: 2, projectId }),
    ).rejects.toThrow("Project not found");
    expect(tx.insert).not.toHaveBeenCalled();

    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId,
    } as never);
    await addBriefItemAsTask(userId, { companyId, briefId, rank: 2, projectId });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ projectId }));
  });
});
