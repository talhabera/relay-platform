/**
 * Client-side projections for the Tasks tab. Tasks and projects carry no
 * config column, but the rows still cross the flight boundary, so only the
 * fields the tab renders are projected and dates are serialised to strings.
 */

/** A task as the browser is allowed to see it. */
export type TaskView = {
  id: string;
  title: string;
  notes: string | null;
  status: "todo" | "doing" | "blocked" | "done";
  priority: "high" | "normal" | "low";
  projectId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  dueDate: string | null;
  recurrence: "none" | "daily" | "weekly" | "monthly";
  completedAt: string | null;
  createdAt: string;
};

type TaskRowLike = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskView["status"];
  priority: TaskView["priority"];
  projectId: string | null;
  assigneeUserId: string | null;
  dueDate: string | null;
  recurrence: TaskView["recurrence"];
  completedAt: Date | string | null;
  createdAt: Date | string;
};

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Project a task row down to what the client may hold. */
export function toTaskView(
  task: TaskRowLike,
  assigneeName: string | null = null,
): TaskView {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    projectId: task.projectId,
    assigneeUserId: task.assigneeUserId,
    assigneeName,
    dueDate: task.dueDate,
    recurrence: task.recurrence,
    completedAt: toIso(task.completedAt),
    createdAt: toIso(task.createdAt) ?? "",
  };
}

/** A project as the browser is allowed to see it. */
export type ProjectView = {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  position: number;
};

type ProjectRowLike = {
  id: string;
  name: string;
  description: string | null;
  status: ProjectView["status"];
  position: number;
};

/** Project a project row down to what the client may hold. */
export function toProjectView(project: ProjectRowLike): ProjectView {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    position: project.position,
  };
}

/** A company person the assignee picker may offer. */
export type AssigneeView = {
  id: string;
  name: string;
};
