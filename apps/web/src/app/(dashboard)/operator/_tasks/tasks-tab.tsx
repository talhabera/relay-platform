"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { Chip, Icon, StatusChip } from "@/components/v2/primitives";
import { cn } from "@/lib/utils";
import type { AssigneeView, ProjectView, TaskView } from "./task-views";
import type { TaskPriority, TaskRecurrence, TaskStatus } from "@/lib/validators/task";
import {
  archiveProject,
  createProject,
  createTask,
  deleteTask,
  renameProject,
  updateTask,
} from "../task-actions";
import { formatDueDate, groupTasks, isOverdue, type TaskGroup } from "./task-groups";

const LIST_URL = "/operator?tab=tasks";
const NONE = "__none__";

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  blocked: "Blocked",
  done: "Done",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "High",
  normal: "Normal",
  low: "Low",
};

const RECURRENCE_LABELS: Record<TaskRecurrence, string> = {
  none: "Does not repeat",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export type TasksTabProps = {
  companyId: string;
  timeZone: string;
  /** Company-local today (`YYYY-MM-DD`) used for grouping. */
  today: string;
  tasks: TaskView[];
  projects: ProjectView[];
  assignees: AssigneeView[];
  selectedTaskId: string | null;
};

function taskHref(taskId: string) {
  return `${LIST_URL}&task=${encodeURIComponent(taskId)}`;
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="type-label uppercase text-muted-foreground">
      {children}
    </label>
  );
}

export function TasksTab({
  companyId,
  timeZone,
  today,
  tasks,
  projects,
  assignees,
  selectedTaskId,
}: TasksTabProps) {
  const router = useRouter();
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [doneOpen, setDoneOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const activeProjects = projects.filter((project) => project.status === "active");
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const filtered = tasks.filter((task) => {
    if (projectFilter === "all") return true;
    if (projectFilter === NONE) return task.projectId === null;
    return task.projectId === projectFilter;
  });
  const groups = groupTasks(filtered, today);
  const openCount = filtered.filter((task) => task.status !== "done").length;
  const overdueCount = groups.find((group) => group.id === "overdue")?.tasks.length ?? 0;
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? null;

  async function handleStatusChange(task: TaskView, status: TaskStatus) {
    if (status === task.status) return;
    try {
      await updateTask(task.id, { status });
      toast.success(status === "done" ? "Task done" : "Task updated");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update task");
    }
  }

  return (
    <>
      <section
        aria-labelledby="tasks-title"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-elevation-1"
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id="tasks-title" className="type-h2 text-foreground">
              Tasks
            </h2>
            <p className="type-small text-muted-foreground">
              Work for the company, grouped by due date · times in {timeZone}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setManageOpen((open) => !open)}
            aria-expanded={manageOpen}
          >
            Manage projects
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip asStatic variant="selected" size="md" icon="list-checks">
            {openCount} open {openCount === 1 ? "task" : "tasks"}
          </Chip>
          {overdueCount > 0 ? (
            <StatusChip tone="error">{overdueCount} overdue</StatusChip>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2" aria-label="Filter by project">
          <Chip
            size="md"
            variant={projectFilter === "all" ? "selected" : "default"}
            onClick={() => setProjectFilter("all")}
          >
            All projects
          </Chip>
          {activeProjects.map((project) => (
            <Chip
              key={project.id}
              size="md"
              variant={projectFilter === project.id ? "selected" : "default"}
              onClick={() => setProjectFilter(project.id)}
            >
              {project.name}
            </Chip>
          ))}
          <Chip
            size="md"
            variant={projectFilter === NONE ? "selected" : "default"}
            onClick={() => setProjectFilter(NONE)}
          >
            No project
          </Chip>
        </div>

        {manageOpen ? (
          <ProjectControls companyId={companyId} projects={activeProjects} />
        ) : null}

        <QuickAdd
          companyId={companyId}
          projects={activeProjects}
          assignees={assignees}
          defaultProjectId={
            projectFilter !== "all" && projectFilter !== NONE ? projectFilter : null
          }
        />

        {filtered.length === 0 ? (
          <p className="type-small text-muted-foreground">
            No tasks here yet. Add one above.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) =>
              group.id === "done" ? (
                <DoneGroup
                  key={group.id}
                  group={group}
                  open={doneOpen}
                  onToggle={() => setDoneOpen((open) => !open)}
                  today={today}
                  projectNames={projectNames}
                  onOpen={(task) => router.push(taskHref(task.id))}
                  onStatusChange={handleStatusChange}
                />
              ) : group.tasks.length > 0 ? (
                <TaskGroupSection
                  key={group.id}
                  group={group}
                  today={today}
                  projectNames={projectNames}
                  onOpen={(task) => router.push(taskHref(task.id))}
                  onStatusChange={handleStatusChange}
                />
              ) : null,
            )}
          </div>
        )}

        <div className="flex items-start gap-2">
          <Icon name="info" size={16} className="mt-px shrink-0 text-muted-foreground" />
          <p className="type-caption text-muted-foreground">
            Repeating tasks open their next copy when you mark them done. Done
            tasks stay at the bottom.
          </p>
        </div>
      </section>

      <Sheet
        open={selectedTask !== null}
        onOpenChange={(open) => {
          if (!open) router.push(LIST_URL);
        }}
      >
        <SheetContent className="w-full gap-5 sm:max-w-[560px]">
          {selectedTask ? (
            <TaskDetail
              key={selectedTask.id}
              task={selectedTask}
              projects={projects}
              assignees={assignees}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

type GroupSectionProps = {
  group: TaskGroup<TaskView>;
  today: string;
  projectNames: Map<string, string>;
  onOpen: (task: TaskView) => void;
  onStatusChange: (task: TaskView, status: TaskStatus) => void;
};

function TaskGroupSection({ group, today, projectNames, onOpen, onStatusChange }: GroupSectionProps) {
  return (
    <section aria-labelledby={`task-group-${group.id}`} className="flex flex-col gap-2">
      <h3 id={`task-group-${group.id}`} className="type-label uppercase text-muted-foreground">
        {group.label} · {group.tasks.length}
      </h3>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {group.tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            projectName={task.projectId ? (projectNames.get(task.projectId) ?? null) : null}
            onOpen={onOpen}
            onStatusChange={onStatusChange}
          />
        ))}
      </ul>
    </section>
  );
}

function DoneGroup({
  group,
  open,
  onToggle,
  today,
  projectNames,
  onOpen,
  onStatusChange,
}: GroupSectionProps & { open: boolean; onToggle: () => void }) {
  if (group.tasks.length === 0) return null;
  return (
    <section aria-labelledby="task-group-done" className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-fit items-center gap-2 rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={16} className="text-muted-foreground" />
        <span id="task-group-done" className="type-label uppercase text-muted-foreground">
          Done · {group.tasks.length}
        </span>
      </button>
      {open ? (
        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {group.tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              today={today}
              projectName={task.projectId ? (projectNames.get(task.projectId) ?? null) : null}
              onOpen={onOpen}
              onStatusChange={onStatusChange}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type TaskRowProps = {
  task: TaskView;
  today: string;
  projectName: string | null;
  onOpen: (task: TaskView) => void;
  onStatusChange: (task: TaskView, status: TaskStatus) => void;
};

function TaskRow({ task, today, projectName, onOpen, onStatusChange }: TaskRowProps) {
  const dueLabel = formatDueDate(task.dueDate, today);
  const overdue = isOverdue(task, today);
  const done = task.status === "done";
  const meta = [
    projectName,
    task.assigneeName,
    task.recurrence !== "none" ? RECURRENCE_LABELS[task.recurrence] : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <Select
        value={task.status}
        onValueChange={(value) => onStatusChange(task, value as TaskStatus)}
      >
        <SelectTrigger aria-label={`Status for ${task.title}`} className="w-[8.5rem] shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((status) => (
            <SelectItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <button
        type="button"
        onClick={() => onOpen(task)}
        className={cn(
          "min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
          done && "text-muted-foreground line-through",
        )}
      >
        <span className="type-body block truncate">{task.title}</span>
        {meta.length > 0 ? (
          <span className="type-caption block truncate text-muted-foreground">
            {meta.join(" · ")}
          </span>
        ) : null}
      </button>

      {task.priority === "high" ? (
        <StatusChip tone="needs-you">High</StatusChip>
      ) : task.priority === "low" ? (
        <Chip asStatic size="sm">Low</Chip>
      ) : null}
      {dueLabel ? (
        <span
          className={cn(
            "type-small inline-flex shrink-0 items-center gap-1",
            overdue ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          <Icon name="calendar" size={14} />
          {dueLabel}
        </span>
      ) : null}
    </li>
  );
}

function QuickAdd({
  companyId,
  projects,
  assignees,
  defaultProjectId,
}: {
  companyId: string;
  projects: ProjectView[];
  assignees: AssigneeView[];
  defaultProjectId: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<string>(defaultProjectId ?? NONE);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [assigneeUserId, setAssigneeUserId] = useState<string>(NONE);
  const [adding, setAdding] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Give the task a title");
      return;
    }
    setAdding(true);
    try {
      await createTask({
        companyId,
        title: title.trim(),
        projectId: projectId === NONE ? null : projectId,
        dueDate: dueDate || null,
        priority,
        assigneeUserId: assigneeUserId === NONE ? null : assigneeUserId,
      });
      toast.success("Task added");
      setTitle("");
      setDueDate("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add task");
    } finally {
      setAdding(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-surface-raised p-3"
    >
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <FieldLabel htmlFor="quick-add-title">New task</FieldLabel>
        <Input
          id="quick-add-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Project</FieldLabel>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger aria-label="Project" className="w-40">
            <SelectValue placeholder="No project" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>No project</SelectItem>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="quick-add-due">Due</FieldLabel>
        <Input
          id="quick-add-due"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Priority</FieldLabel>
        <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
          <SelectTrigger aria-label="Priority" className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((value) => (
              <SelectItem key={value} value={value}>
                {PRIORITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <FieldLabel>Assignee</FieldLabel>
        <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
          <SelectTrigger aria-label="Assignee" className="w-40">
            <SelectValue placeholder="Unassigned" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Unassigned</SelectItem>
            {assignees.map((person) => (
              <SelectItem key={person.id} value={person.id}>
                {person.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={adding}>
        Add task
      </Button>
    </form>
  );
}

function ProjectControls({
  companyId,
  projects,
}: {
  companyId: string;
  projects: ProjectView[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Give the project a name");
      return;
    }
    setCreating(true);
    try {
      await createProject({ companyId, name: name.trim() });
      toast.success("Project created");
      setName("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border p-3">
      <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <FieldLabel htmlFor="new-project-name">New project</FieldLabel>
          <Input
            id="new-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Project name"
          />
        </div>
        <Button type="submit" variant="outline" disabled={creating}>
          Create project
        </Button>
      </form>
      {projects.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {projects.map((project) => (
            // The name in the key resets the row's draft when a refresh brings a new name.
            <ProjectRow key={`${project.id}:${project.name}`} project={project} />
          ))}
        </ul>
      ) : (
        <p className="type-caption text-muted-foreground">No projects yet.</p>
      )}
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectView }) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== project.name && name.trim() !== "";

  async function handleRename() {
    setBusy(true);
    try {
      await renameProject(project.id, name.trim());
      toast.success("Project renamed");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to rename project");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!window.confirm(`Archive "${project.name}"? Its tasks keep the link but the project leaves the filters.`)) return;
    setBusy(true);
    try {
      await archiveProject(project.id);
      toast.success("Project archived");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to archive project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Name for ${project.name}`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-48 flex-1"
      />
      <Button type="button" variant="outline" size="sm" disabled={!dirty || busy} onClick={handleRename}>
        Rename
      </Button>
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={handleArchive}>
        <Icon name="archive" size={14} />
        Archive
      </Button>
    </li>
  );
}

function TaskDetail({
  task,
  projects,
  assignees,
}: {
  task: TaskView;
  projects: ProjectView[];
  assignees: AssigneeView[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [status, setStatus] = useState<TaskStatus>(task.status);
  const [priority, setPriority] = useState<TaskPriority>(task.priority);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [projectId, setProjectId] = useState<string>(task.projectId ?? NONE);
  const [assigneeUserId, setAssigneeUserId] = useState<string>(task.assigneeUserId ?? NONE);
  const [recurrence, setRecurrence] = useState<TaskRecurrence>(task.recurrence);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const dirty =
    title !== task.title ||
    notes !== (task.notes ?? "") ||
    status !== task.status ||
    priority !== task.priority ||
    dueDate !== (task.dueDate ?? "") ||
    projectId !== (task.projectId ?? NONE) ||
    assigneeUserId !== (task.assigneeUserId ?? NONE) ||
    recurrence !== task.recurrence;

  async function handleSave() {
    if (!title.trim()) {
      toast.error("Give the task a title");
      return;
    }
    setSaving(true);
    try {
      await updateTask(task.id, {
        title: title.trim(),
        notes: notes.trim() ? notes : null,
        status,
        priority,
        dueDate: dueDate || null,
        projectId: projectId === NONE ? null : projectId,
        assigneeUserId: assigneeUserId === NONE ? null : assigneeUserId,
        recurrence,
      });
      toast.success("Task saved");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save task");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    setDeleting(true);
    try {
      await deleteTask(task.id);
      toast.success("Task deleted");
      router.push(LIST_URL);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete task");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1 pr-10">
        <SheetTitle className="type-h3 text-foreground">Task</SheetTitle>
        <SheetDescription className="type-small text-muted-foreground">
          {STATUS_LABELS[task.status]}
          {task.assigneeName ? ` · ${task.assigneeName}` : ""}
        </SheetDescription>
      </div>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="task-title">Title</FieldLabel>
          <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Status</FieldLabel>
            <Select value={status} onValueChange={(value) => setStatus(value as TaskStatus)}>
              <SelectTrigger aria-label="Status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_LABELS) as TaskStatus[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Priority</FieldLabel>
            <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
              <SelectTrigger aria-label="Priority" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRIORITY_LABELS) as TaskPriority[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {PRIORITY_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="task-due">Due date</FieldLabel>
            <Input
              id="task-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Repeats</FieldLabel>
            <Select value={recurrence} onValueChange={(value) => setRecurrence(value as TaskRecurrence)}>
              <SelectTrigger aria-label="Recurrence" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(RECURRENCE_LABELS) as TaskRecurrence[]).map((value) => (
                  <SelectItem key={value} value={value}>
                    {RECURRENCE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Project</FieldLabel>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Project" className="w-full">
                <SelectValue placeholder="No project" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No project</SelectItem>
                {projects
                  .filter((project) => project.status === "active" || project.id === task.projectId)
                  .map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.status === "archived" ? `${project.name} (archived)` : project.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel>Assignee</FieldLabel>
            <Select value={assigneeUserId} onValueChange={setAssigneeUserId}>
              <SelectTrigger aria-label="Assignee" className="w-full">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Unassigned</SelectItem>
                {assignees.map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
          <Textarea
            id="task-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={6}
            placeholder="Anything worth remembering about this task"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={handleSave} disabled={!dirty || saving || deleting}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <span className="min-w-0 flex-1" aria-hidden />
        <Button
          type="button"
          variant="ghost"
          onClick={handleDelete}
          disabled={deleting || saving}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 size={16} />
          Delete task
        </Button>
      </div>
    </>
  );
}
