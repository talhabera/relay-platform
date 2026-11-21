import { and, eq, lte, ne } from "drizzle-orm";
import {
  companyMembers,
  db,
  projects,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  TASK_STATUSES,
  tasks,
} from "@relay/db";
import { z } from "zod";
import { requireCompanyMembership } from "../auth/access";
import { followUpDueDate, localToday } from "../shared/recurrence";

const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD");

export const listTasksSchema = z.object({
  companyId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  status: z.enum(TASK_STATUSES).optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  dueBefore: dueDateSchema.optional(),
  includeDone: z.boolean().optional(),
});

export const createTaskSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().min(1),
  notes: z.string().nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  recurrence: z.enum(TASK_RECURRENCES).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  status: z.enum(["todo", "doing", "blocked"]).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  recurrence: z.enum(TASK_RECURRENCES).optional(),
});

export const getTaskSchema = z.object({ taskId: z.string().min(1) });
export const completeTaskSchema = getTaskSchema;
export const reopenTaskSchema = getTaskSchema;
export const deleteTaskSchema = getTaskSchema;

export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

type TaskRow = typeof tasks.$inferSelect;
type Company = Awaited<ReturnType<typeof requireCompanyMembership>>["company"];

const STATUS_ORDER: Record<string, number> = {
  doing: 0,
  todo: 1,
  blocked: 2,
  done: 3,
};
const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

async function assertAssignee(
  company: Company,
  companyId: string,
  assigneeUserId: string | null | undefined,
) {
  if (assigneeUserId === undefined || assigneeUserId === null) return;
  if (assigneeUserId === company.ownerId) return;

  const membership = await db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, companyId),
      eq(companyMembers.userId, assigneeUserId),
      eq(companyMembers.role, "member"),
    ),
  });

  const role = (membership as { role?: string } | undefined)?.role;
  if (!membership || (role !== undefined && role !== "member")) {
    throw new Error(
      "Invalid assignee: assigneeUserId must be the company owner or a member of this company",
    );
  }
}

async function assertProject(
  companyId: string,
  projectId: string | null | undefined,
) {
  if (projectId === undefined || projectId === null) return;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project || project.companyId !== companyId) {
    throw new Error("Project not found");
  }
}

async function loadTaskForUser(userId: string, taskId: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
  });

  if (!task) {
    throw new Error("Task not found");
  }

  const { company } = await requireCompanyMembership(userId, task.companyId);

  if (company.id && company.id !== task.companyId) {
    throw new Error("Task not found");
  }

  return { task: task as TaskRow, company };
}

function resolveTaskArgs(
  idOrData: string | Record<string, unknown>,
  maybeData?: Record<string, unknown>,
): { taskId: string; data: Record<string, unknown> } {
  if (typeof idOrData === "string") {
    return { taskId: idOrData, data: maybeData ?? {} };
  }
  const { taskId, id, ...rest } = idOrData as {
    taskId?: string;
    id?: string;
  };
  return {
    taskId: (taskId ?? id) as string,
    data: { ...rest, ...(maybeData ?? {}) },
  };
}

async function insertTask(values: typeof tasks.$inferInsert) {
  const [row] = await db.insert(tasks).values(values).returning();
  return row as TaskRow;
}

export async function listTasks(
  userId: string,
  filters: Parameters<typeof listTasksSchema.parse>[0],
) {
  const parsed = listTasksSchema.parse(filters);
  await requireCompanyMembership(userId, parsed.companyId);

  const conditions = [eq(tasks.companyId, parsed.companyId)];
  if (parsed.projectId !== undefined && parsed.projectId !== null) {
    conditions.push(eq(tasks.projectId, parsed.projectId));
  }
  if (parsed.status !== undefined) {
    conditions.push(eq(tasks.status, parsed.status));
  } else if (!parsed.includeDone) {
    conditions.push(ne(tasks.status, "done"));
  }
  if (parsed.assigneeUserId !== undefined && parsed.assigneeUserId !== null) {
    conditions.push(eq(tasks.assigneeUserId, parsed.assigneeUserId));
  }
  if (parsed.dueBefore !== undefined) {
    conditions.push(lte(tasks.dueDate, parsed.dueBefore));
  }

  const rows = (await db.query.tasks.findMany({
    where: and(...conditions),
  })) as TaskRow[];

  const filtered = rows.filter((row) => {
    if (
      parsed.projectId !== undefined &&
      parsed.projectId !== null &&
      row.projectId !== undefined &&
      row.projectId !== parsed.projectId
    ) {
      return false;
    }
    if (parsed.status !== undefined) {
      if (row.status !== undefined && row.status !== parsed.status) return false;
    } else if (!parsed.includeDone && row.status === "done") {
      return false;
    }
    if (
      parsed.assigneeUserId !== undefined &&
      parsed.assigneeUserId !== null &&
      row.assigneeUserId !== undefined &&
      row.assigneeUserId !== parsed.assigneeUserId
    ) {
      return false;
    }
    if (parsed.dueBefore !== undefined && row.dueDate !== undefined) {
      if (row.dueDate === null || row.dueDate > parsed.dueBefore) return false;
    }
    return true;
  });

  return filtered.sort((a, b) => {
    const byStatus =
      (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
    if (byStatus !== 0) return byStatus;
    const byPriority =
      (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
    if (byPriority !== 0) return byPriority;
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate < b.dueDate ? -1 : 1;
    }
    if (a.dueDate && !b.dueDate) return -1;
    if (!a.dueDate && b.dueDate) return 1;
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });
}

export async function getTask(
  userId: string,
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const { taskId } = resolveTaskArgs(
    taskIdOrData as string | Record<string, unknown>,
  );
  const { task } = await loadTaskForUser(userId, taskId);
  return task;
}

export async function createTask(
  userId: string,
  data: Parameters<typeof createTaskSchema.parse>[0],
) {
  const parsed = createTaskSchema.parse(data);
  const { company } = await requireCompanyMembership(userId, parsed.companyId);

  await assertProject(parsed.companyId, parsed.projectId);
  await assertAssignee(company, parsed.companyId, parsed.assigneeUserId);

  return insertTask({
    companyId: parsed.companyId,
    title: parsed.title,
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
    ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
    ...(parsed.assigneeUserId !== undefined
      ? { assigneeUserId: parsed.assigneeUserId }
      : {}),
    ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
    ...(parsed.recurrence !== undefined
      ? { recurrence: parsed.recurrence }
      : {}),
    source: "manual",
    createdByUserId: userId,
  });
}

export async function updateTask(
  userId: string,
  taskId: string,
  data: Parameters<typeof updateTaskSchema.parse>[0],
): Promise<TaskRow>;
export async function updateTask(
  userId: string,
  data: { taskId: string } & Record<string, unknown>,
): Promise<TaskRow>;
export async function updateTask(
  userId: string,
  idOrData: string | ({ taskId: string } & Record<string, unknown>),
  maybeData?: Parameters<typeof updateTaskSchema.parse>[0],
) {
  const { taskId, data } = resolveTaskArgs(
    idOrData as string | Record<string, unknown>,
    maybeData as Record<string, unknown> | undefined,
  );

  if ((data as { status?: string }).status === "done") {
    throw new Error(
      "status done is not allowed in updateTask; use completeTask to complete a task",
    );
  }

  const { task, company } = await loadTaskForUser(userId, taskId);
  const parsed = updateTaskSchema.parse(data);

  await assertProject(task.companyId, parsed.projectId);
  await assertAssignee(company, task.companyId, parsed.assigneeUserId);

  const updatedAt = new Date();
  const setValues = {
    ...(parsed.title !== undefined ? { title: parsed.title } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    ...(parsed.projectId !== undefined ? { projectId: parsed.projectId } : {}),
    ...(parsed.status !== undefined ? { status: parsed.status } : {}),
    ...(parsed.priority !== undefined ? { priority: parsed.priority } : {}),
    ...(parsed.assigneeUserId !== undefined
      ? { assigneeUserId: parsed.assigneeUserId }
      : {}),
    ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
    ...(parsed.recurrence !== undefined
      ? { recurrence: parsed.recurrence }
      : {}),
    updatedAt,
  };

  await db.update(tasks).set(setValues).where(eq(tasks.id, task.id));

  return { ...task, ...setValues };
}

export async function completeTask(
  userId: string,
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const { taskId } = resolveTaskArgs(
    taskIdOrData as string | Record<string, unknown>,
  );
  const { task, company } = await loadTaskForUser(userId, taskId);

  if (task.status === "done") {
    return { task, followUp: null as TaskRow | null };
  }

  const now = new Date();
  const [completed] = await db
    .update(tasks)
    .set({ status: "done", completedAt: now, updatedAt: now })
    .where(and(eq(tasks.id, task.id), ne(tasks.status, "done")))
    .returning();

  if (!completed) {
    const reloaded = await db.query.tasks.findFirst({
      where: eq(tasks.id, task.id),
    });
    return {
      task: (reloaded ?? task) as TaskRow,
      followUp: null as TaskRow | null,
    };
  }

  let followUp: TaskRow | null = null;
  if (task.recurrence && task.recurrence !== "none") {
    const recurrence = task.recurrence as "daily" | "weekly" | "monthly";
    followUp = await insertTask({
      companyId: task.companyId,
      title: task.title,
      notes: task.notes ?? null,
      projectId: task.projectId ?? null,
      priority: task.priority,
      assigneeUserId: task.assigneeUserId ?? null,
      recurrence,
      status: "todo",
      source: "manual",
      createdByUserId: task.createdByUserId ?? null,
      dueDate: followUpDueDate(
        recurrence,
        task.dueDate ?? null,
        localToday(company.timezone ?? "UTC"),
      ),
    });
  }

  return { task: completed, followUp };
}

export async function reopenTask(
  userId: string,
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const { taskId } = resolveTaskArgs(
    taskIdOrData as string | Record<string, unknown>,
  );
  const { task } = await loadTaskForUser(userId, taskId);

  if (task.status !== "done") {
    return task;
  }

  const updatedAt = new Date();
  await db
    .update(tasks)
    .set({ status: "todo", completedAt: null, updatedAt })
    .where(eq(tasks.id, task.id));

  return { ...task, status: "todo" as const, completedAt: null, updatedAt };
}

export async function deleteTask(
  userId: string,
  taskIdOrData: string | { taskId: string } | { id: string },
) {
  const { taskId } = resolveTaskArgs(
    taskIdOrData as string | Record<string, unknown>,
  );
  const { task, company } = await loadTaskForUser(userId, taskId);

  if (task.createdByUserId !== userId && company.ownerId !== userId) {
    throw new Error(
      "Unauthorized: only the task creator or the company owner can delete this task",
    );
  }

  await db.delete(tasks).where(eq(tasks.id, task.id));
}
