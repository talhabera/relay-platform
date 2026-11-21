import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@relay/db";
import { requireCompanyMembership } from "../auth/access";
import {
  completeTask,
  createTask,
  deleteTask,
  getTask,
  listTasks,
  reopenTask,
  updateTask,
} from "./tasks";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        tasks: { findFirst: vi.fn(), findMany: vi.fn() },
        projects: { findFirst: vi.fn(), findMany: vi.fn() },
        companyMembers: { findFirst: vi.fn(), findMany: vi.fn() },
      },
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("../auth/access", () => ({
  requireCompanyMembership: vi.fn(),
}));

const userId = "user-1";
const ownerId = "owner-1";
const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const taskId = "660e8400-e29b-41d4-a716-446655440001";
const projectId = "770e8400-e29b-41d4-a716-446655440002";

const baseTask = {
  id: taskId,
  companyId,
  projectId,
  title: "Call client",
  notes: "notes",
  status: "todo",
  priority: "high",
  assigneeUserId: ownerId,
  dueDate: "2026-01-31",
  recurrence: "monthly",
  source: "manual",
  briefId: null,
  createdByUserId: userId,
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

function mockInsert(row: unknown = { id: "new-task" }) {
  const returning = vi.fn().mockResolvedValue([row]);
  const values = vi.fn(() => ({ returning }));
  vi.mocked(db.insert).mockReturnValue({ values } as never);
  return { values, returning };
}

function mockUpdateWhere() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where };
}

function mockUpdateReturning(rows: unknown[]) {
  const returning = vi.fn().mockResolvedValue(rows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  vi.mocked(db.update).mockReturnValue({ set } as never);
  return { set, where, returning };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireCompanyMembership).mockResolvedValue({
    userId,
    company: { id: companyId, ownerId, timezone: "UTC" },
  } as never);
});

describe("listTasks", () => {
  it("excludes done by default and orders doing/todo/blocked, priority, due date", async () => {
    vi.mocked(db.query.tasks.findMany).mockResolvedValue([
      { ...baseTask, id: "t-done", status: "done" },
      { ...baseTask, id: "t-todo-low", status: "todo", priority: "low", dueDate: "2026-01-01" },
      { ...baseTask, id: "t-doing", status: "doing", priority: "low", dueDate: null },
      { ...baseTask, id: "t-todo-high-null", status: "todo", priority: "high", dueDate: null },
      { ...baseTask, id: "t-todo-high", status: "todo", priority: "high", dueDate: "2026-02-01" },
    ] as never);

    const rows = await listTasks(userId, { companyId });
    expect(rows.map((t) => t.id)).toEqual([
      "t-doing",
      "t-todo-high",
      "t-todo-high-null",
      "t-todo-low",
    ]);

    const withDone = await listTasks(userId, { companyId, status: "done" });
    expect(withDone.map((t) => t.id)).toEqual(["t-done"]);
  });

  it("refuses when membership is rejected and queries nothing", async () => {
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("Unauthorized"));

    await expect(listTasks(userId, { companyId })).rejects.toThrow("Unauthorized");
    expect(db.query.tasks.findMany).not.toHaveBeenCalled();
  });
});

describe("getTask", () => {
  it("returns the task for a member", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
    await expect(getTask(userId, taskId)).resolves.toEqual(baseTask);
    expect(requireCompanyMembership).toHaveBeenCalledWith(userId, companyId);
  });

  it("treats another company's task as not found", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue({
      ...baseTask,
      companyId: otherCompanyId,
    } as never);

    await expect(getTask(userId, taskId)).rejects.toThrow("Task not found");
  });

  it("throws Task not found when missing", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(undefined);
    await expect(getTask(userId, taskId)).rejects.toThrow("Task not found");
  });
});

describe("createTask", () => {
  it("creates a manual task created by the caller", async () => {
    const { values } = mockInsert({ id: taskId });
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId,
    } as never);

    await createTask(userId, { companyId, title: "Call client", projectId });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        title: "Call client",
        projectId,
        source: "manual",
        createdByUserId: userId,
      }),
    );
  });

  it("accepts the company owner as assignee without a member row", async () => {
    mockInsert();
    await createTask(userId, { companyId, title: "T", assigneeUserId: ownerId });
    expect(db.query.companyMembers.findFirst).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it("accepts a member assignee and refuses others", async () => {
    mockInsert();
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      userId: "member-1",
      role: "member",
    } as never);
    await createTask(userId, { companyId, title: "T", assigneeUserId: "member-1" });
    expect(db.insert).toHaveBeenCalled();

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    await expect(
      createTask(userId, { companyId, title: "T", assigneeUserId: "stranger" }),
    ).rejects.toThrow(/assignee/i);

    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      userId: "client-1",
      role: "client",
    } as never);
    await expect(
      createTask(userId, { companyId, title: "T", assigneeUserId: "client-1" }),
    ).rejects.toThrow(/assignee/i);
  });

  it("refuses a project from another company", async () => {
    mockInsert();
    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId: otherCompanyId,
    } as never);

    await expect(
      createTask(userId, { companyId, title: "T", projectId }),
    ).rejects.toThrow("Project not found");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("refuses when membership is rejected and writes nothing", async () => {
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("Unauthorized"));
    await expect(createTask(userId, { companyId, title: "T" })).rejects.toThrow("Unauthorized");
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.query.tasks.findMany).not.toHaveBeenCalled();
  });
});

describe("updateTask", () => {
  beforeEach(() => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
  });

  it("refuses status done", async () => {
    mockUpdateWhere();
    await expect(
      updateTask(userId, taskId, { status: "done" as never }),
    ).rejects.toThrow(/done/);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("updates fields, clears assignee with null, sets updatedAt", async () => {
    const { set } = mockUpdateWhere();
    await updateTask(userId, taskId, {
      title: "New",
      status: "doing",
      assigneeUserId: null,
      dueDate: "2026-02-01",
    });
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New",
        status: "doing",
        assigneeUserId: null,
        dueDate: "2026-02-01",
        updatedAt: expect.any(Date),
      }),
    );
  });

  it("refuses a non-member assignee and another company's project", async () => {
    mockUpdateWhere();
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);
    await expect(
      updateTask(userId, taskId, { assigneeUserId: "stranger" }),
    ).rejects.toThrow(/assignee/i);

    vi.mocked(db.query.projects.findFirst).mockResolvedValue({
      id: projectId,
      companyId: otherCompanyId,
    } as never);
    await expect(updateTask(userId, taskId, { projectId })).rejects.toThrow("Project not found");
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("completeTask", () => {
  it("is idempotent on an already done task", async () => {
    const done = { ...baseTask, status: "done", completedAt: new Date() };
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(done as never);

    const result = await completeTask(userId, taskId);

    expect(result).toEqual({ task: done, followUp: null });
    expect(db.update).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates exactly one follow-up for a recurring task with copied fields", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
    const completed = { ...baseTask, status: "done", completedAt: new Date() };
    mockUpdateReturning([completed]);
    const { values } = mockInsert({ id: "follow-1" });

    const result = await completeTask(userId, taskId);

    expect(result.task).toEqual(completed);
    expect(result.followUp).toEqual({ id: "follow-1" });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId,
        title: baseTask.title,
        notes: baseTask.notes,
        projectId,
        priority: "high",
        assigneeUserId: ownerId,
        recurrence: "monthly",
        status: "todo",
        source: "manual",
        createdByUserId: userId,
        dueDate: "2026-02-28",
      }),
    );

    // Second completion (now done) inserts nothing more.
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(completed as never);
    await completeTask(userId, taskId);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it("creates no follow-up for a non-recurring task", async () => {
    const task = { ...baseTask, recurrence: "none" };
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(task as never);
    mockUpdateReturning([{ ...task, status: "done" }]);

    const result = await completeTask(userId, taskId);

    expect(result.followUp).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates no follow-up when the conditional update loses a race", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
    mockUpdateReturning([]);

    const result = await completeTask(userId, taskId);

    expect(result.followUp).toBeNull();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.query.tasks.findFirst).toHaveBeenCalledTimes(2);
  });
});

describe("reopenTask", () => {
  it("reopens a done task and returns a non-done task unchanged", async () => {
    const done = { ...baseTask, status: "done", completedAt: new Date() };
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(done as never);
    const { set } = mockUpdateWhere();

    const reopened = await reopenTask(userId, taskId);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "todo", completedAt: null }),
    );
    expect(reopened.status).toBe("todo");

    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
    const unchanged = await reopenTask(userId, taskId);
    expect(unchanged).toEqual(baseTask);
    expect(db.update).toHaveBeenCalledTimes(1);
  });
});

describe("deleteTask", () => {
  function mockDelete() {
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);
    return where;
  }

  it("allows the creator and the company owner, refuses others", async () => {
    vi.mocked(db.query.tasks.findFirst).mockResolvedValue(baseTask as never);
    mockDelete();
    await deleteTask(userId, taskId);
    expect(db.delete).toHaveBeenCalledTimes(1);

    await deleteTask(ownerId, taskId);
    expect(db.delete).toHaveBeenCalledTimes(2);

    await expect(deleteTask("someone-else", taskId)).rejects.toThrow(Error);
    expect(db.delete).toHaveBeenCalledTimes(2);
  });
});
