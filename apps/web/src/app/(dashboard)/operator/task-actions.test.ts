import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireSession } from "@/lib/auth-server";
import {
  createTask as createTaskOp,
  updateTask as updateTaskOp,
  completeTask as completeTaskOp,
  reopenTask as reopenTaskOp,
  deleteTask as deleteTaskOp,
  createProject as createProjectOp,
  updateProject as updateProjectOp,
  archiveProject as archiveProjectOp,
} from "@relay/agent-ops";
import { revalidatePath } from "next/cache";
import {
  archiveProject,
  createProject,
  createTask,
  deleteTask,
  renameProject,
  updateTask,
} from "./task-actions";

vi.mock("@relay/agent-ops", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const taskId = "990e8400-e29b-41d4-a716-446655440010";
const projectId = "990e8400-e29b-41d4-a716-446655440020";

const session = {
  user: { id: "user-1", name: "Ada", email: "ada@relay.dev", image: null },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue(session as never);
});

describe("createTask", () => {
  it("calls agent-ops with the session user and revalidates /operator", async () => {
    vi.mocked(createTaskOp).mockResolvedValue({ id: taskId } as never);
    const input = {
      companyId,
      title: "Call the supplier",
      projectId,
      priority: "high" as const,
      dueDate: "2026-09-20",
    };
    const result = await createTask(input);
    expect(createTaskOp).toHaveBeenCalledWith("user-1", input);
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
    expect(result).toEqual({ id: taskId });
  });

  it("rejects an empty title without calling agent-ops", async () => {
    await expect(createTask({ companyId, title: "   " })).rejects.toThrow();
    await expect(createTask({ companyId, title: "" })).rejects.toThrow();
    expect(createTaskOp).not.toHaveBeenCalled();
  });

  it("rejects a bad date without calling agent-ops", async () => {
    await expect(
      createTask({ companyId, title: "X", dueDate: "20-09-2026" }),
    ).rejects.toThrow();
    await expect(
      createTask({ companyId, title: "X", dueDate: "2026-02-30" }),
    ).rejects.toThrow();
    await expect(
      createTask({ companyId, title: "X", dueDate: "not-a-date" }),
    ).rejects.toThrow();
    expect(createTaskOp).not.toHaveBeenCalled();
  });

  it("rejects an unknown priority without calling agent-ops", async () => {
    await expect(
      createTask({
        companyId,
        title: "X",
        // @ts-expect-error unknown priority must fail validation
        priority: "urgent",
      }),
    ).rejects.toThrow();
    expect(createTaskOp).not.toHaveBeenCalled();
  });

  it("propagates agent-ops authz errors", async () => {
    vi.mocked(createTaskOp).mockRejectedValue(new Error("Unauthorized"));
    await expect(createTask({ companyId, title: "X" })).rejects.toThrow(
      "Unauthorized",
    );
  });
});

describe("updateTask", () => {
  it("calls agent-ops update with the session user (id, data form)", async () => {
    vi.mocked(updateTaskOp).mockResolvedValue({ id: taskId } as never);
    await updateTask(taskId, { title: "Renamed", priority: "low" });
    expect(updateTaskOp).toHaveBeenCalledWith("user-1", taskId, {
      title: "Renamed",
      priority: "low",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });

  it("calls agent-ops update with the session user (object form)", async () => {
    vi.mocked(updateTaskOp).mockResolvedValue({ id: taskId } as never);
    await updateTask({ taskId, notes: "hello", dueDate: "2026-10-01" });
    expect(updateTaskOp).toHaveBeenCalledWith("user-1", taskId, {
      notes: "hello",
      dueDate: "2026-10-01",
    });
  });

  it("routes status done through completeTask, not updateTask", async () => {
    vi.mocked(completeTaskOp).mockResolvedValue({ task: { id: taskId } } as never);
    await updateTask(taskId, { status: "done" });
    expect(completeTaskOp).toHaveBeenCalledWith("user-1", taskId);
    expect(updateTaskOp).not.toHaveBeenCalled();
  });

  it("passes an inline status change to agent-ops update", async () => {
    vi.mocked(updateTaskOp).mockResolvedValue({ id: taskId } as never);
    await updateTask(taskId, { status: "doing" });
    expect(updateTaskOp).toHaveBeenCalledWith("user-1", taskId, {
      status: "doing",
    });
  });

  it.each(["todo", "doing", "blocked"] as const)(
    "reopens before setting status %s so a done task loses completedAt",
    async (status) => {
      vi.mocked(reopenTaskOp).mockResolvedValue({ id: taskId } as never);
      vi.mocked(updateTaskOp).mockResolvedValue({ id: taskId } as never);
      await updateTask(taskId, { status });
      expect(reopenTaskOp).toHaveBeenCalledWith("user-1", taskId);
      expect(updateTaskOp).toHaveBeenCalledWith("user-1", taskId, { status });
      expect(vi.mocked(reopenTaskOp).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(updateTaskOp).mock.invocationCallOrder[0],
      );
    },
  );

  it("does not reopen when only fields change", async () => {
    vi.mocked(updateTaskOp).mockResolvedValue({ id: taskId } as never);
    await updateTask(taskId, { title: "Renamed" });
    expect(reopenTaskOp).not.toHaveBeenCalled();
  });

  it("rejects bad input without calling agent-ops", async () => {
    await expect(updateTask(taskId, { title: "" })).rejects.toThrow();
    await expect(updateTask(taskId, { dueDate: "2026-13-01" })).rejects.toThrow();
    await expect(
      updateTask(taskId, {
        // @ts-expect-error unknown priority must fail validation
        priority: "p0",
      }),
    ).rejects.toThrow();
    expect(updateTaskOp).not.toHaveBeenCalled();
    expect(completeTaskOp).not.toHaveBeenCalled();
  });
});

describe("deleteTask", () => {
  it("calls agent-ops with the session user and revalidates", async () => {
    vi.mocked(deleteTaskOp).mockResolvedValue(undefined as never);
    await deleteTask(taskId);
    expect(deleteTaskOp).toHaveBeenCalledWith("user-1", taskId);
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });
});

describe("projects", () => {
  it("createProject calls agent-ops with the session user", async () => {
    vi.mocked(createProjectOp).mockResolvedValue({ id: projectId } as never);
    const result = await createProject({ companyId, name: "Launch" });
    expect(createProjectOp).toHaveBeenCalledWith("user-1", {
      companyId,
      name: "Launch",
    });
    expect(result).toEqual({ id: projectId });
  });

  it("createProject rejects an empty name", async () => {
    await expect(createProject({ companyId, name: " " })).rejects.toThrow();
    expect(createProjectOp).not.toHaveBeenCalled();
  });

  it("renameProject calls agent-ops updateProject with the new name", async () => {
    vi.mocked(updateProjectOp).mockResolvedValue({ id: projectId } as never);
    await renameProject(projectId, "Renamed");
    expect(updateProjectOp).toHaveBeenCalledWith("user-1", projectId, {
      name: "Renamed",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });

  it("renameProject rejects an empty name", async () => {
    await expect(renameProject(projectId, "")).rejects.toThrow();
    expect(updateProjectOp).not.toHaveBeenCalled();
  });

  it("archiveProject calls agent-ops with the session user", async () => {
    vi.mocked(archiveProjectOp).mockResolvedValue({ id: projectId } as never);
    await archiveProject(projectId);
    expect(archiveProjectOp).toHaveBeenCalledWith("user-1", projectId);
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });
});
