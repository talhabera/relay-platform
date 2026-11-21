import { describe, expect, it } from "vitest";
import {
  TASK_GROUP_ORDER,
  addDaysYmd,
  formatDueDate,
  groupTasks,
  localTodayString,
  taskGroupId,
  type GroupableTask,
} from "./task-groups";

const today = "2026-09-15";

function task(partial: Partial<GroupableTask> & { id: string }): GroupableTask {
  return { status: "todo", dueDate: null, ...partial };
}

function idsByGroup(tasks: GroupableTask[], day = today) {
  return Object.fromEntries(
    groupTasks(tasks, day).map((group) => [group.id, group.tasks.map((t) => t.id)]),
  );
}

describe("groupTasks", () => {
  it("returns groups in display order with labels", () => {
    const groups = groupTasks([], today);
    expect(groups.map((g) => g.id)).toEqual([...TASK_GROUP_ORDER]);
    expect(groups.map((g) => g.label)).toEqual([
      "Overdue",
      "Today",
      "This week",
      "Later",
      "No date",
      "Done",
    ]);
  });

  it("puts past-due open tasks in Overdue and today's in Today", () => {
    const grouped = idsByGroup([
      task({ id: "a", dueDate: "2026-09-14" }),
      task({ id: "b", dueDate: "2026-01-01", status: "doing" }),
      task({ id: "c", dueDate: today }),
    ]);
    expect(grouped.overdue).toEqual(["a", "b"]);
    expect(grouped.today).toEqual(["c"]);
  });

  it("puts the next seven days in This week and day eight in Later", () => {
    const grouped = idsByGroup([
      task({ id: "tomorrow", dueDate: "2026-09-16" }),
      task({ id: "plus7", dueDate: "2026-09-22" }),
      task({ id: "plus8", dueDate: "2026-09-23" }),
      task({ id: "far", dueDate: "2027-01-01" }),
    ]);
    expect(grouped.thisWeek).toEqual(["tomorrow", "plus7"]);
    expect(grouped.later).toEqual(["plus8", "far"]);
  });

  it("puts tasks without a due date in No date", () => {
    const grouped = idsByGroup([
      task({ id: "null", dueDate: null }),
      task({ id: "undef", dueDate: undefined }),
    ]);
    expect(grouped.noDate).toEqual(["null", "undef"]);
  });

  it("puts done tasks in Done whatever their due date", () => {
    const grouped = idsByGroup([
      task({ id: "overdue-done", status: "done", dueDate: "2020-01-01" }),
      task({ id: "future-done", status: "done", dueDate: "2030-01-01" }),
      task({ id: "nodate-done", status: "done", dueDate: null }),
    ]);
    expect(grouped.done).toEqual(["overdue-done", "future-done", "nodate-done"]);
    expect(grouped.overdue).toEqual([]);
  });

  it("treats blocked tasks like other open tasks", () => {
    expect(taskGroupId(task({ id: "x", status: "blocked", dueDate: "2026-09-01" }), today)).toBe(
      "overdue",
    );
  });

  it("preserves input order inside a group", () => {
    const grouped = idsByGroup([
      task({ id: "second", dueDate: today }),
      task({ id: "first", dueDate: "2026-09-01" }),
      task({ id: "third", dueDate: today }),
    ]);
    expect(grouped.today).toEqual(["second", "third"]);
  });
});

describe("midnight boundaries in the company timezone", () => {
  it("localTodayString rolls over at local midnight, not UTC midnight", () => {
    // 23:30 UTC is already 02:30 the next day in Istanbul (UTC+3).
    const instant = new Date("2026-09-15T23:30:00.000Z");
    expect(localTodayString(instant, "Europe/Istanbul")).toBe("2026-09-16");
    expect(localTodayString(instant, "UTC")).toBe("2026-09-15");
    // The same instant is still the evening of the 15th in New York.
    expect(localTodayString(instant, "America/New_York")).toBe("2026-09-15");
  });

  it("a task due on the local today is Today just after local midnight", () => {
    const justAfterMidnightIstanbul = new Date("2026-09-15T21:00:01.000Z"); // 00:00:01 +03
    const localToday = localTodayString(justAfterMidnightIstanbul, "Europe/Istanbul");
    expect(localToday).toBe("2026-09-16");
    expect(taskGroupId(task({ id: "x", dueDate: "2026-09-16" }), localToday)).toBe("today");
    expect(taskGroupId(task({ id: "y", dueDate: "2026-09-15" }), localToday)).toBe("overdue");
  });

  it("a task due today stays Today one second before local midnight", () => {
    const justBeforeMidnightIstanbul = new Date("2026-09-15T20:59:59.000Z"); // 23:59:59 +03
    const localToday = localTodayString(justBeforeMidnightIstanbul, "Europe/Istanbul");
    expect(localToday).toBe("2026-09-15");
    expect(taskGroupId(task({ id: "x", dueDate: "2026-09-15" }), localToday)).toBe("today");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(localTodayString(new Date("2026-09-15T23:30:00.000Z"), "Not/AZone")).toBe(
      "2026-09-15",
    );
  });
});

describe("addDaysYmd and formatDueDate", () => {
  it("crosses month and year boundaries", () => {
    expect(addDaysYmd("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDaysYmd("2026-12-31", 7)).toBe("2027-01-07");
    expect(addDaysYmd("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("labels relative days and formats other dates", () => {
    expect(formatDueDate(today, today)).toBe("Today");
    expect(formatDueDate("2026-09-16", today)).toBe("Tomorrow");
    expect(formatDueDate("2026-09-14", today)).toBe("Yesterday");
    expect(formatDueDate("2026-09-21", today)).toBe("Mon 21 Sep");
    expect(formatDueDate(null, today)).toBeNull();
  });
});
