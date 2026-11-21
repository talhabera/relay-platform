import { eq } from "drizzle-orm";
import { listProjects, listTasks } from "@relay/agent-ops";
import { db } from "@/db";
import { companyMembers, users } from "@/db/schema";
import {
  toProjectView,
  toTaskView,
  type AssigneeView,
  type ProjectView,
  type TaskView,
} from "./task-views";

export type TasksTabData = {
  tasks: TaskView[];
  projects: ProjectView[];
  assignees: AssigneeView[];
};

function personName(user: { name?: string | null; email?: string | null } | null | undefined) {
  return user?.name?.trim() || user?.email?.trim() || "Unknown";
}

/**
 * Tasks and projects come from agent-ops (it does the authz); no Drizzle
 * call in the web layer touches tasks or projects. The assignee list is
 * the company owner plus its members, like the Settings member list.
 */
export async function loadTasksTab({
  userId,
  companyId,
  ownerId,
}: {
  userId: string;
  companyId: string;
  ownerId: string;
}): Promise<TasksTabData> {
  const [taskRows, projectRows, owner, members] = await Promise.all([
    listTasks(userId, { companyId, includeDone: true }),
    listProjects(userId, { companyId, includeArchived: true }),
    db.query.users.findFirst({ where: eq(users.id, ownerId) }),
    db.query.companyMembers.findMany({
      where: eq(companyMembers.companyId, companyId),
      with: { user: true },
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    }),
  ]);

  const assignees: AssigneeView[] = [];
  const names = new Map<string, string>();
  if (owner) {
    const name = personName(owner);
    assignees.push({ id: owner.id, name });
    names.set(owner.id, name);
  }
  for (const member of members) {
    if (member.role !== "member") continue;
    if (!member.user || names.has(member.user.id)) continue;
    const name = personName(member.user);
    assignees.push({ id: member.user.id, name });
    names.set(member.user.id, name);
  }

  return {
    tasks: taskRows.map((task) =>
      toTaskView(
        task,
        task.assigneeUserId ? (names.get(task.assigneeUserId) ?? null) : null,
      ),
    ),
    projects: projectRows.map(toProjectView),
    assignees,
  };
}
