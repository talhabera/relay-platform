"use server";

import { revalidatePath } from "next/cache";
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
import { requireSession } from "@/lib/auth-server";
import {
  createProjectSchema,
  createTaskSchema,
  renameProjectSchema,
  updateProjectFieldsSchema,
  updateProjectSchema,
  updateTaskFieldsSchema,
  updateTaskSchema,
  type CreateProjectInput,
  type CreateTaskInput,
  type RenameProjectInput,
  type UpdateProjectFieldsInput,
  type UpdateProjectInput,
  type UpdateTaskFieldsInput,
  type UpdateTaskInput,
} from "@/lib/validators/task";

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

function resolveIdAndData<T extends Record<string, unknown>>(
  idOrData: string | ({ taskId?: string; projectId?: string; id?: string } & T),
  maybeData: T | undefined,
  key: "taskId" | "projectId",
): { id: string; data: T } {
  if (typeof idOrData === "string") {
    return { id: idOrData, data: (maybeData ?? {}) as T };
  }
  const { taskId, projectId, id, ...rest } = idOrData;
  const resolved = (key === "taskId" ? taskId : projectId) ?? id;
  return {
    id: resolved as string,
    data: { ...(rest as T), ...(maybeData ?? {}) },
  };
}

export async function createTask(data: CreateTaskInput) {
  const session = await requireSession();
  const parsed = stripUndefined(createTaskSchema.parse(data));
  const result = await createTaskOp(session.user.id, parsed);
  revalidatePath("/operator");
  return result;
}

export async function updateTask(
  taskId: string,
  data: UpdateTaskFieldsInput,
): Promise<unknown>;
export async function updateTask(data: UpdateTaskInput): Promise<unknown>;
export async function updateTask(
  idOrData: string | UpdateTaskInput,
  maybeData?: UpdateTaskFieldsInput,
) {
  const session = await requireSession();
  const { id: taskId, data: raw } = resolveIdAndData(
    idOrData as never,
    maybeData as Record<string, unknown> | undefined,
    "taskId",
  );
  const parsed = updateTaskSchema.parse({ taskId, ...raw });
  const { taskId: _taskId, status, ...restFields } = parsed;
  const fields = stripUndefined(restFields);
  const hasFields = Object.values(fields).some((v) => v !== undefined);

  // Validate field shape on its own too, so bad input fails before any call.
  updateTaskFieldsSchema.parse({ ...fields, ...(status ? { status } : {}) });

  let result: unknown = undefined;
  if (status === "done") {
    // Agent-ops rejects `done` in updateTask; completion goes via completeTask.
    if (hasFields) {
      result = await updateTaskOp(session.user.id, taskId, fields);
    }
    result = await completeTaskOp(session.user.id, taskId);
  } else if (hasFields || status !== undefined) {
    if (status !== undefined) {
      // Leaving done must clear completedAt, which only reopenTask does.
      // reopenTask is a no-op when the task is not done.
      await reopenTaskOp(session.user.id, taskId);
    }
    result = await updateTaskOp(session.user.id, taskId, {
      ...fields,
      ...(status !== undefined ? { status } : {}),
    });
  }
  revalidatePath("/operator");
  return result;
}

export async function completeTask(
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const session = await requireSession();
  const { id: taskId } = resolveIdAndData(taskIdOrData as never, undefined, "taskId");
  const result = await completeTaskOp(session.user.id, taskId);
  revalidatePath("/operator");
  return result;
}

export async function reopenTask(
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const session = await requireSession();
  const { id: taskId } = resolveIdAndData(taskIdOrData as never, undefined, "taskId");
  const result = await reopenTaskOp(session.user.id, taskId);
  revalidatePath("/operator");
  return result;
}

export async function deleteTask(
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const session = await requireSession();
  const { id: taskId } = resolveIdAndData(taskIdOrData as never, undefined, "taskId");
  await deleteTaskOp(session.user.id, taskId);
  revalidatePath("/operator");
}

export async function createProject(data: CreateProjectInput) {
  const session = await requireSession();
  const parsed = stripUndefined(createProjectSchema.parse(data));
  const result = await createProjectOp(session.user.id, parsed);
  revalidatePath("/operator");
  return result;
}

export async function updateProject(
  projectId: string,
  data: UpdateProjectFieldsInput,
): Promise<unknown>;
export async function updateProject(data: UpdateProjectInput): Promise<unknown>;
export async function updateProject(
  idOrData: string | UpdateProjectInput,
  maybeData?: UpdateProjectFieldsInput,
) {
  const session = await requireSession();
  const { id: projectId, data: raw } = resolveIdAndData(
    idOrData as never,
    maybeData as Record<string, unknown> | undefined,
    "projectId",
  );
  const parsed = updateProjectSchema.parse({ projectId, ...raw });
  const { projectId: _projectId, ...restFields } = parsed;
  const fields = stripUndefined(restFields);
  updateProjectFieldsSchema.parse(fields);
  const result = await updateProjectOp(session.user.id, projectId, fields);
  revalidatePath("/operator");
  return result;
}

export async function renameProject(
  projectIdOrData: string | RenameProjectInput,
  maybeName?: string,
) {
  const session = await requireSession();
  const input =
    typeof projectIdOrData === "string"
      ? { projectId: projectIdOrData, name: maybeName as string }
      : projectIdOrData;
  const parsed = renameProjectSchema.parse(input);
  const result = await updateProjectOp(session.user.id, parsed.projectId, {
    name: parsed.name,
  });
  revalidatePath("/operator");
  return result;
}

export async function archiveProject(
  projectIdOrData: string | { projectId: string } | { id: string },
) {
  const session = await requireSession();
  const { id: projectId } = resolveIdAndData(
    projectIdOrData as never,
    undefined,
    "projectId",
  );
  const result = await archiveProjectOp(session.user.id, projectId);
  revalidatePath("/operator");
  return result;
}
