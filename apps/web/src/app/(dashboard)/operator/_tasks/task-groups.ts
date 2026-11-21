/**
 * Pure grouping of tasks by company-local due date.
 *
 * `today` is the company-local `YYYY-MM-DD` (see `localTodayString`), so
 * grouping never depends on the viewer's browser timezone. String
 * comparison on `YYYY-MM-DD` values is chronological.
 */
export type TaskGroupId =
  | "overdue"
  | "today"
  | "thisWeek"
  | "later"
  | "noDate"
  | "done";

export const TASK_GROUP_ORDER: readonly TaskGroupId[] = [
  "overdue",
  "today",
  "thisWeek",
  "later",
  "noDate",
  "done",
] as const;

export const TASK_GROUP_LABELS: Record<TaskGroupId, string> = {
  overdue: "Overdue",
  today: "Today",
  thisWeek: "This week",
  later: "Later",
  noDate: "No date",
  done: "Done",
};

/** Smallest shape `groupTasks` needs; full task views satisfy it. */
export type GroupableTask = {
  id: string;
  status: string;
  dueDate: string | null | undefined;
};

export type TaskGroup<T extends GroupableTask = GroupableTask> = {
  id: TaskGroupId;
  label: string;
  tasks: T[];
};

/** Company-local today as `YYYY-MM-DD` in `timeZone`. */
export function localTodayString(
  now: Date = new Date(),
  timeZone: string = "UTC",
): string {
  const tz = safeTaskTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** The timezone if Intl knows it, else UTC. */
export function safeTaskTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Group for one task. Done always lands in `done`. "This week" is the
 * seven days after today (today+1 .. today+7 inclusive); anything later
 * is `later`, and a missing due date is `noDate`.
 */
export function taskGroupId(task: GroupableTask, today: string): TaskGroupId {
  if (task.status === "done") return "done";
  if (!task.dueDate) return "noDate";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  if (task.dueDate <= addDaysYmd(today, 7)) return "thisWeek";
  return "later";
}

/**
 * Groups tasks in display order (Overdue, Today, This week, Later,
 * No date, Done), preserving input order inside each group. Empty
 * groups are included; the UI hides them (and collapses Done).
 */
export function groupTasks<T extends GroupableTask>(
  tasks: readonly T[],
  today: string,
): TaskGroup<T>[] {
  const buckets = new Map<TaskGroupId, T[]>(
    TASK_GROUP_ORDER.map((id) => [id, [] as T[]]),
  );
  for (const task of tasks) {
    buckets.get(taskGroupId(task, today))?.push(task);
  }
  return TASK_GROUP_ORDER.map((id) => ({
    id,
    label: TASK_GROUP_LABELS[id],
    tasks: buckets.get(id) ?? [],
  }));
}

/** Alias kept descriptive for callers that think in due dates. */
export const groupTasksByDueDate = groupTasks;

/** Short due label in the company timezone, e.g. "Today", "Tomorrow", "Mon 12 Jan". */
export function formatDueDate(
  dueDate: string | null | undefined,
  today: string,
): string | null {
  if (!dueDate) return null;
  if (dueDate === today) return "Today";
  if (dueDate === addDaysYmd(today, 1)) return "Tomorrow";
  if (dueDate === addDaysYmd(today, -1)) return "Yesterday";
  const [year, month, day] = dueDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

export function isOverdue(task: GroupableTask, today: string): boolean {
  return taskGroupId(task, today) === "overdue";
}
