import { tool } from "ai";
import { z } from "zod";
import {
  completeTask,
  completeTaskSchema,
  createTask,
  createTaskSchema,
  getTask,
  listTasks,
  listTasksSchema,
  updateTask,
  updateTaskSchema,
} from "@relay/agent-ops/operator/tasks";
import { READ_WORKSPACE_STATE_TOOL } from "./daily-brief-tool";
import { loadWorkspaceState, taskHref } from "./workspace-state";

export { READ_WORKSPACE_STATE_TOOL };

export const LIST_TASKS_TOOL = "listTasks";
export const CREATE_TASK_TOOL = "createTask";
export const UPDATE_TASK_TOOL = "updateTask";
export const COMPLETE_TASK_TOOL = "completeTask";

// Session tools reuse the agent-ops schemas minus the company: companyId and
// the acting userId come from the session, never from the model. Strict
// objects, so a companyId or userId key in a tool call is refused.
export const listTasksToolInputSchema = z.strictObject(
  listTasksSchema.omit({ companyId: true }).shape,
);
export const createTaskToolInputSchema = z.strictObject(
  createTaskSchema.omit({ companyId: true }).shape,
);
export const updateTaskToolInputSchema = z.strictObject({
  taskId: z.string().min(1),
  ...updateTaskSchema.shape,
});
export const completeTaskToolInputSchema = z.strictObject(
  completeTaskSchema.shape,
);

type TaskRowLike = {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
};

/** What a tool result may carry about a task: no notes, no company or user ids. */
function toTaskResult(task: TaskRowLike) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    dueDate: task.dueDate ?? null,
    href: taskHref(task.id),
  };
}

const TASK_NOT_FOUND = { ok: false as const, error: "Task not found" };

function errorResult(error: unknown) {
  return {
    ok: false as const,
    error: error instanceof Error ? error.message : "Task operation failed",
  };
}

/**
 * An id from another company is "not found", never data: acting as the
 * session user is not enough when that user belongs to several companies,
 * so the task must also sit in the session's company before it is touched.
 */
async function sessionTaskError(
  userId: string,
  companyId: string,
  taskId: string,
): Promise<{ ok: false; error: string } | null> {
  let task: { companyId?: string } | null | undefined;
  try {
    task = (await getTask(userId, taskId)) as
      | { companyId?: string }
      | null
      | undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return /not found|unauthorized/i.test(message)
      ? TASK_NOT_FOUND
      : errorResult(error);
  }
  if (task?.companyId && task.companyId !== companyId) return TASK_NOT_FOUND;
  return null;
}

/**
 * Daily Manager tools for an Operator session: the workspace snapshot plus
 * task list/create/update/complete, acting as the session user so the
 * agent-ops membership checks apply. `postDailyBrief` stays cron-only.
 */
export function makeManagerTools({
  companyId,
  userId,
}: {
  companyId: string;
  userId: string;
}) {
  return {
    [READ_WORKSPACE_STATE_TOOL]: tool({
      description:
        "Read a snapshot of what needs attention in this company: tasks (overdue, due today, doing and blocked, with open, unassigned and done-yesterday counts and open and overdue counts per active project), the last brief's items and where the reader left them (open, done or dismissed), paused and failed Schedules, open questions and approvals, Inbox counts, weekly targets, packages and connectors. Ids, names, counts and in-app links only.",
      inputSchema: z.strictObject({}),
      execute: async () => loadWorkspaceState(companyId),
    }),

    [LIST_TASKS_TOOL]: tool({
      description:
        "List this company's tasks, optionally filtered by project, status, assignee or due date. Done tasks are left out unless includeDone is set or status is done.",
      inputSchema: listTasksToolInputSchema,
      execute: async (input) => {
        try {
          const rows = await listTasks(userId, { companyId, ...input });
          return { ok: true as const, tasks: rows.map(toTaskResult) };
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    [CREATE_TASK_TOOL]: tool({
      description: "Create a task in this company.",
      inputSchema: createTaskToolInputSchema,
      execute: async (input) => {
        try {
          const task = await createTask(userId, { companyId, ...input });
          return { ok: true as const, task: toTaskResult(task) };
        } catch (error) {
          return errorResult(error);
        }
      },
    }),

    [UPDATE_TASK_TOOL]: tool({
      description:
        "Update a task's title, notes, project, status (todo, doing or blocked), priority, assignee, due date or recurrence. Use completeTask to mark a task done.",
      inputSchema: updateTaskToolInputSchema,
      execute: async ({ taskId, ...fields }) => {
        const refused = await sessionTaskError(userId, companyId, taskId);
        if (refused) return refused;
        try {
          const task = await updateTask(userId, taskId, fields);
          return { ok: true as const, task: toTaskResult(task) };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          return /unauthorized/i.test(message)
            ? TASK_NOT_FOUND
            : errorResult(error);
        }
      },
    }),

    [COMPLETE_TASK_TOOL]: tool({
      description:
        "Mark a task done. Safe to call on a task that is already done. A recurring task spawns its next occurrence, returned as followUp.",
      inputSchema: completeTaskToolInputSchema,
      execute: async ({ taskId }) => {
        const refused = await sessionTaskError(userId, companyId, taskId);
        if (refused) return refused;
        try {
          const { task, followUp } = await completeTask(userId, taskId);
          return {
            ok: true as const,
            task: toTaskResult(task),
            followUp: followUp ? toTaskResult(followUp) : null,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          return /unauthorized/i.test(message)
            ? TASK_NOT_FOUND
            : errorResult(error);
        }
      },
    }),
  };
}

export const makeTaskTools = makeManagerTools;

export type ManagerTools = ReturnType<typeof makeManagerTools>;
