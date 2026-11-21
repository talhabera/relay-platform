import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTasks: vi.fn(),
  getTask: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  loadWorkspaceState: vi.fn(),
}));

vi.mock("@relay/agent-ops/operator/tasks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@relay/agent-ops/operator/tasks")>();
  return {
    ...actual,
    listTasks: mocks.listTasks,
    getTask: mocks.getTask,
    createTask: mocks.createTask,
    updateTask: mocks.updateTask,
    completeTask: mocks.completeTask,
  };
});

vi.mock("./workspace-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-state")>();
  return { ...actual, loadWorkspaceState: mocks.loadWorkspaceState };
});

import { makeManagerTools } from "./task-tools";

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const otherCompanyId = "550e8400-e29b-41d4-a716-446655440099";
const userId = "user-1";
const taskId = "660e8400-e29b-41d4-a716-446655440001";

const fullTask = {
  id: taskId,
  companyId,
  projectId: "770e8400-e29b-41d4-a716-446655440002",
  title: "Call client",
  notes: "secret notes",
  status: "todo",
  priority: "high",
  assigneeUserId: "owner-1",
  dueDate: "2026-01-31",
  recurrence: "none",
  source: "manual",
  briefId: null,
  createdByUserId: userId,
  completedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

const taskSummary = {
  id: taskId,
  title: "Call client",
  status: "todo",
  dueDate: "2026-01-31",
  href: `/operator?tab=tasks&task=${taskId}`,
};

function tools() {
  return makeManagerTools({ companyId, userId });
}

function parse(tool: { inputSchema: unknown }, value: unknown) {
  return (
    tool.inputSchema as {
      safeParse: (v: unknown) => { success: boolean };
    }
  ).safeParse(value);
}

const ctx = { toolCallId: "call-1", messages: [], abortSignal: undefined };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTasks.mockResolvedValue([fullTask]);
  mocks.getTask.mockResolvedValue(fullTask);
  mocks.createTask.mockResolvedValue(fullTask);
  mocks.updateTask.mockResolvedValue(fullTask);
  mocks.completeTask.mockResolvedValue({ task: fullTask, followUp: null });
  mocks.loadWorkspaceState.mockResolvedValue({ stub: true });
});

describe("manager session tools", () => {
  it("returns exactly the five session tools, with no brief or delete tool", () => {
    expect(Object.keys(tools()).sort()).toEqual(
      [
        "completeTask",
        "createTask",
        "listTasks",
        "readWorkspaceState",
        "updateTask",
      ].sort(),
    );
  });

  it("readWorkspaceState reads the session company", async () => {
    const result = await tools().readWorkspaceState.execute!({}, ctx);

    expect(mocks.loadWorkspaceState).toHaveBeenCalledWith(companyId);
    expect(result).toEqual({ stub: true });
  });

  it("listTasks acts as the session user in the session company and trims rows", async () => {
    const result = await tools().listTasks.execute!({ status: "todo" }, ctx);

    expect(mocks.listTasks).toHaveBeenCalledWith(userId, {
      companyId,
      status: "todo",
    });
    expect(result).toEqual({ ok: true, tasks: [taskSummary] });
    expect(JSON.stringify(result)).not.toContain("secret notes");
    expect(JSON.stringify(result)).not.toContain(companyId);
  });

  it("createTask binds companyId and returns only the task summary", async () => {
    const result = await tools().createTask.execute!(
      { title: "Call client", dueDate: "2026-01-31" },
      ctx,
    );

    expect(mocks.createTask).toHaveBeenCalledWith(userId, {
      companyId,
      title: "Call client",
      dueDate: "2026-01-31",
    });
    expect(result).toEqual({ ok: true, task: taskSummary });
  });

  it("updateTask binds the session user and splits taskId from the fields", async () => {
    const result = await tools().updateTask.execute!(
      { taskId, title: "Call client", status: "doing" },
      ctx,
    );

    expect(mocks.updateTask).toHaveBeenCalledWith(userId, taskId, {
      title: "Call client",
      status: "doing",
    });
    expect(result).toEqual({ ok: true, task: taskSummary });
  });

  it("completeTask binds the session user and trims task and follow-up", async () => {
    const followUpId = "660e8400-e29b-41d4-a716-446655440009";
    mocks.completeTask.mockResolvedValue({
      task: { ...fullTask, status: "done" },
      followUp: { ...fullTask, id: followUpId, dueDate: "2026-02-28" },
    });

    const result = await tools().completeTask.execute!({ taskId }, ctx);

    expect(mocks.completeTask).toHaveBeenCalledWith(userId, taskId);
    expect(result).toEqual({
      ok: true,
      task: { ...taskSummary, status: "done" },
      followUp: {
        ...taskSummary,
        id: followUpId,
        dueDate: "2026-02-28",
        href: `/operator?tab=tasks&task=${followUpId}`,
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret notes");
  });

  it("gives a not-found result, not data, for a task from another company", async () => {
    mocks.getTask.mockResolvedValue({ ...fullTask, companyId: otherCompanyId });

    const updated = await tools().updateTask.execute!(
      { taskId, title: "Nope" },
      ctx,
    );
    const completed = await tools().completeTask.execute!({ taskId }, ctx);

    for (const result of [updated, completed]) {
      expect(result).toEqual({
        ok: false,
        error: expect.stringMatching(/not found/i),
      });
      expect(JSON.stringify(result)).not.toContain("Call client");
    }
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.completeTask).not.toHaveBeenCalled();
  });

  it("gives a not-found result when the task lookup refuses the id", async () => {
    mocks.getTask.mockRejectedValue(new Error("Task not found"));

    const result = await tools().completeTask.execute!({ taskId }, ctx);

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
    expect(mocks.completeTask).not.toHaveBeenCalled();
  });

  it("turns an agent-ops refusal into an error result, not a throw", async () => {
    mocks.updateTask.mockRejectedValue(new Error("Task not found"));

    const result = await tools().updateTask.execute!(
      { taskId, title: "Nope" },
      ctx,
    );

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/not found/i),
    });
  });
});

describe("manager session tool inputs", () => {
  const validInputs: Record<string, Record<string, unknown>> = {
    readWorkspaceState: {},
    listTasks: {},
    createTask: { title: "Call client" },
    updateTask: { taskId, title: "Call client" },
    completeTask: { taskId },
  };

  it.each(Object.keys(validInputs))(
    "%s accepts its bound-session input",
    (name) => {
      const tool = tools()[name as keyof ReturnType<typeof tools>];
      expect(parse(tool, validInputs[name]).success).toBe(true);
    },
  );

  it.each(Object.keys(validInputs))(
    "%s rejects a companyId or userId key",
    (name) => {
      const tool = tools()[name as keyof ReturnType<typeof tools>];
      expect(parse(tool, { ...validInputs[name], companyId }).success).toBe(
        false,
      );
      expect(
        parse(tool, { ...validInputs[name], userId: "user-2" }).success,
      ).toBe(false);
    },
  );

  it("updateTask rejects status done; completing goes through completeTask", () => {
    expect(parse(tools().updateTask, { taskId, status: "done" }).success).toBe(
      false,
    );
  });
});
