import { z } from "zod";

/**
 * Web-layer validation for Operator tasks and projects.
 * Mirrors the agent-ops / @relay/db enums locally so this file stays safe
 * for the client bundle. Agent-ops re-validates and does the authz.
 */
export const TASK_STATUSES = ["todo", "doing", "blocked", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "normal", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_RECURRENCES = ["none", "daily", "weekly", "monthly"] as const;
export type TaskRecurrence = (typeof TASK_RECURRENCES)[number];

function isValidCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const dueDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "dueDate must be YYYY-MM-DD")
  .refine(isValidCalendarDate, "dueDate must be a valid calendar date");

/** Empty form values become null; missing values stay undefined. */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const nullableDueDate = z.preprocess(
  emptyToNull,
  dueDateSchema.nullable().optional(),
);
const nullableId = z.preprocess(
  emptyToNull,
  z.string().min(1).nullable().optional(),
);
const nullableNotes = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? null : value),
  z.string().max(10000).nullable().optional(),
);

export const createTaskSchema = z.object({
  companyId: z.string().min(1),
  title: z.string().trim().min(1, "title is required").max(500),
  notes: nullableNotes,
  projectId: nullableId,
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeUserId: nullableId,
  dueDate: nullableDueDate,
  recurrence: z.enum(TASK_RECURRENCES).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().trim().min(1, "title is required").max(500).optional(),
  notes: nullableNotes,
  projectId: nullableId,
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  assigneeUserId: nullableId,
  dueDate: nullableDueDate,
  recurrence: z.enum(TASK_RECURRENCES).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Fields of an update without the task id (for `updateTask(id, data)` calls). */
export const updateTaskFieldsSchema = updateTaskSchema.omit({ taskId: true });
export type UpdateTaskFieldsInput = z.infer<typeof updateTaskFieldsSchema>;

export const taskIdSchema = z.object({ taskId: z.string().min(1) });
export const deleteTaskSchema = taskIdSchema;
export const completeTaskSchema = taskIdSchema;
export const reopenTaskSchema = taskIdSchema;
export type TaskIdInput = z.infer<typeof taskIdSchema>;

export const createProjectSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().trim().min(1, "name is required").max(200),
  description: nullableNotes,
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "name is required").max(200).optional(),
  description: nullableNotes,
  position: z.number().int().optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const updateProjectFieldsSchema = updateProjectSchema.omit({
  projectId: true,
});
export type UpdateProjectFieldsInput = z.infer<
  typeof updateProjectFieldsSchema
>;

export const renameProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(1, "name is required").max(200),
});

export type RenameProjectInput = z.infer<typeof renameProjectSchema>;

export const projectIdSchema = z.object({ projectId: z.string().min(1) });
export const archiveProjectSchema = projectIdSchema;
export type ProjectIdInput = z.infer<typeof projectIdSchema>;

/** Free-form string maps (Zod v4 record syntax), kept for parity with repo validators. */
export const stringRecordSchema = z.record(z.string(), z.string());
