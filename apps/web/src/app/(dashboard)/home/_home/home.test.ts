import { describe, expect, it } from "vitest";

import type { PagePermissions } from "@relay/db/schema";
import { HOME_TILE_KEYS, type WorkflowView } from "@/lib/fixtures/interfaces";
import type { NeedsYouItemLike } from "@/lib/operator/needs-you-view";
import { localDayRange } from "@/lib/time";

import {
  briefTitle,
  buildBriefTile,
  buildLeadEngineRows,
  buildMyTasksTile,
  buildTodayRows,
  homeDateLabel,
  homeGreeting,
  needsYouMoreLabel,
  pickLeadWorkflow,
  setupSteps,
  todayTitle,
  type HomeBrief,
  type HomeTask,
  type TodayJob,
  type TodayRun,
} from "./home-model";
import {
  DEFAULT_HOME_TILES,
  homeColumns,
  resolveHomeTiles,
  tileVisibleTo,
  visibleHomeTiles,
  type HomeTileRow,
} from "./tiles";

const TZ = "Europe/Berlin";
const d = (iso: string) => new Date(iso);
const perms = (p: Partial<PagePermissions> = {}): PagePermissions => ({
  operator: false,
  agents: false,
  messaging: false,
  analytics: false,
  ...p,
});
const owner = { isOwner: true, pagePermissions: perms() };
const member = (p: Partial<PagePermissions> = {}) => ({ isOwner: false, pagePermissions: perms(p) });

describe("home tiles", () => {
  it("defaults to Daily brief, Koleva reklam, My tasks, then the Figma order; My tasks needs Operator", () => {
    const config = resolveHomeTiles([]);
    expect(config.map((t) => t.key)).toEqual([
      "daily_brief",
      "ad_report",
      "my_tasks",
      "goal_strip",
      "agent_map",
      "needs_you",
      "today",
      "lead_engine",
    ]);
    expect(homeColumns(visibleHomeTiles(config, owner)).main[0]).toBe("daily_brief");
    expect(config.find((t) => t.key === "my_tasks")).toEqual({
      key: "my_tasks",
      visible: true,
      order: 2,
      visibility: { kind: "requires", permission: "operator" },
    });
    expect(
      config
        .filter((t) => t.key !== "my_tasks" && t.key !== "ad_report")
        .every((t) => t.visible && t.visibility.kind === "everyone"),
    ).toBe(true);
    // A member without Operator access does not get My tasks; with it, they do.
    // No member gets Koleva reklam (owners only).
    expect(visibleHomeTiles(config, member())).toHaveLength(DEFAULT_HOME_TILES.length - 2);
    expect(visibleHomeTiles(config, member())).not.toContain("my_tasks");
    expect(visibleHomeTiles(config, member({ operator: true }))).toHaveLength(DEFAULT_HOME_TILES.length - 1);
    expect(visibleHomeTiles(config, owner)).toContain("my_tasks");
    expect(visibleHomeTiles(config, owner)).toContain("ad_report");
  });

  it("ad_report: in the catalog, owners only by default, main column after Daily brief", () => {
    expect(HOME_TILE_KEYS).toContain("ad_report");
    const config = resolveHomeTiles([]);
    expect(config.find((t) => t.key === "ad_report")).toEqual({
      key: "ad_report",
      visible: true,
      order: 1,
      visibility: { kind: "owners_only" },
    });
    expect(visibleHomeTiles(config, member({ operator: true, agents: true, messaging: true, analytics: true }))).not.toContain(
      "ad_report",
    );
    expect(homeColumns(visibleHomeTiles(config, owner)).main.slice(0, 2)).toEqual(["daily_brief", "ad_report"]);
    const hidden = resolveHomeTiles([
      { tileKey: "ad_report", visible: false, position: 1, visibility: "owners_only", requiredPermission: null },
    ]);
    expect(visibleHomeTiles(hidden, owner)).not.toContain("ad_report");
  });

  it("applies stored rows over defaults and re-sorts by position", () => {
    const rows: HomeTileRow[] = [
      { tileKey: "lead_engine", visible: true, position: -1, visibility: "requires", requiredPermission: "operator" },
      { tileKey: "today", visible: false, position: 3, visibility: "everyone", requiredPermission: null },
      { tileKey: "goal_strip", visible: true, position: 0, visibility: "owners_only", requiredPermission: null },
    ];
    const config = resolveHomeTiles(rows);
    expect(config[0]).toEqual({
      key: "lead_engine",
      visible: true,
      order: -1,
      visibility: { kind: "requires", permission: "operator" },
    });
    expect(config.find((t) => t.key === "goal_strip")?.visibility).toEqual({ kind: "owners_only" });
    expect(config.find((t) => t.key === "today")?.visible).toBe(false);
  });

  it("filters by visibility: owners see all, members by permission", () => {
    expect(tileVisibleTo({ kind: "owners_only" }, owner)).toBe(true);
    expect(tileVisibleTo({ kind: "owners_only" }, member({ operator: true }))).toBe(false);
    expect(tileVisibleTo({ kind: "requires", permission: "operator" }, member())).toBe(false);
    expect(tileVisibleTo({ kind: "requires", permission: "operator" }, member({ operator: true }))).toBe(true);
    expect(tileVisibleTo({ kind: "everyone" }, member())).toBe(true);
  });

  it("hides a hidden tile from owners too and splits columns in order", () => {
    const config = resolveHomeTiles([
      { tileKey: "today", visible: false, position: 3, visibility: "everyone", requiredPermission: null },
      { tileKey: "needs_you", visible: true, position: 9, visibility: "requires", requiredPermission: "operator" },
    ]);
    const ownerKeys = visibleHomeTiles(config, owner);
    expect(ownerKeys).not.toContain("today");
    expect(homeColumns(ownerKeys)).toEqual({
      main: ["daily_brief", "ad_report", "goal_strip", "agent_map"],
      side: ["my_tasks", "lead_engine", "needs_you"],
    });
    expect(visibleHomeTiles(config, member())).not.toContain("needs_you");
  });
});

describe("home header", () => {
  const now = d("2026-09-25T05:30:00Z"); // 07:30 in Berlin, Friday
  it("greets by company time and first name", () => {
    expect(homeGreeting({ name: "Talha Bera", now, timeZone: TZ })).toBe("Good morning, Talha");
    expect(homeGreeting({ name: "Talha Bera", now: d("2026-09-25T13:00:00Z"), timeZone: TZ })).toBe(
      "Good afternoon, Talha",
    );
    expect(homeGreeting({ name: null, now, timeZone: TZ })).toBe("Good morning");
    expect(homeGreeting({ name: "Talha", now, timeZone: TZ, empty: true })).toBe("Welcome, Talha");
  });

  it("formats the date line and Today title", () => {
    expect(homeDateLabel(now, TZ)).toBe("Friday 25 Sep 2026");
    expect(todayTitle(now, TZ)).toBe("Today · Fri 25 Sep");
  });
});

describe("needs you tile", () => {
  const item = (id: string, type: NeedsYouItemLike["type"]): NeedsYouItemLike => ({
    id,
    type,
    tier: 2,
    href: "/operator",
    agentId: "a",
    agentName: "Lead Qualifier",
    title: id,
    createdAt: d("2026-09-25T05:00:00Z"),
    chatId: null,
    cronRunId: null,
    cronJobId: null,
  });

  it("summarises what is left after the top 2", () => {
    const items = [item("1", "failed_run"), item("2", "agent_question"), ...["3", "4", "5"].map((i) => item(i, "checkpoint"))];
    expect(needsYouMoreLabel(items, 2)).toBe("+3 more: 3 checkpoints");
    expect(needsYouMoreLabel([...items, item("6", "agent_question")], 2)).toBe("+4 more: 3 checkpoints, 1 question");
    expect(needsYouMoreLabel(items.slice(0, 2), 2)).toBeNull();
  });
});

describe("daily brief tile", () => {
  const now = d("2026-10-22T06:00:00Z"); // 09:00 Istanbul, Thursday
  const IST = "Europe/Istanbul";
  const brief = (over: Partial<HomeBrief> = {}): HomeBrief => ({
    id: "brief-1",
    localDate: "2026-10-22",
    summary: "Two leads wait for outreach; the Instagram connector needs a token.",
    items: [
      { rank: 2, kind: "setup", title: "Reconnect Instagram", why: "Token expired yesterday", href: "/settings/connectors" },
      { rank: 1, kind: "do", title: "Approve outreach", why: "2 qualified leads wait", href: "/needs-you" },
      { rank: 3, kind: "decide", title: "Raise the weekly target?", why: "Last 3 weeks beat it", href: null },
    ],
    readAt: null,
    createdAt: d("2026-10-22T05:30:00Z"),
    ...over,
  });

  it("titles the brief by its local date", () => {
    expect(briefTitle("2026-10-22")).toBe("Brief · Thu 22 Oct");
    expect(briefTitle("2026-01-04")).toBe("Brief · Sun 4 Jan");
  });

  it("lists items in rank order with their kind labels, unread until read", () => {
    const model = buildBriefTile({ brief: brief(), managerInstalled: true, now, timeZone: IST });
    expect(model).toMatchObject({
      state: "brief",
      id: "brief-1",
      localDate: "2026-10-22",
      title: "Brief · Thu 22 Oct",
      summary: "Two leads wait for outreach; the Instagram connector needs a token.",
      unread: true,
    });
    if (model.state !== "brief") throw new Error("expected a brief");
    expect(model.items.map((i) => [i.rank, i.kindLabel, i.href])).toEqual([
      [1, "Do today", "/needs-you"],
      [2, "Set up", "/settings/connectors"],
      [3, "Decide", null],
    ]);
    const read = buildBriefTile({ brief: brief({ readAt: now }), managerInstalled: true, now, timeZone: IST });
    expect(read.state === "brief" && read.unread).toBe(false);
  });

  it("moves dismissed items out of the visible list and exposes their count", () => {
    const model = buildBriefTile({
      brief: brief({
        items: [
          { rank: 1, kind: "do", title: "Approve outreach", why: "2 leads wait", href: "/needs-you", status: "dismissed" },
          { rank: 2, kind: "setup", title: "Reconnect Instagram", why: "Token expired", href: "/settings/connectors", status: "done", taskId: "t-1" },
          { rank: 3, kind: "decide", title: "Raise target?", why: "Beat it", href: null },
          { rank: 4, kind: "do", title: "Old news", why: "Stale", href: null, status: "dismissed" },
          { rank: 5, kind: "do", title: "Still open", why: "Now", href: null, status: "open" },
        ],
      }),
      managerInstalled: true,
      now,
      timeZone: IST,
    });
    if (model.state !== "brief") throw new Error("expected a brief");
    // Visible list keeps done + open, drops dismissed; missing status counts as open.
    expect(model.items.map((i) => [i.rank, i.status])).toEqual([
      [2, "done"],
      [3, "open"],
      [5, "open"],
    ]);
    expect(model.dismissedCount).toBe(2);
    expect(model.dismissedItems.map((i) => i.rank)).toEqual([1, 4]);
  });

  it("without a brief: when it arrives if installed, else where to install", () => {
    expect(buildBriefTile({ brief: null, managerInstalled: true, now, timeZone: IST })).toEqual({
      state: "empty",
      title: "Brief · Thu 22 Oct",
      copy: "Your first brief arrives at 08:30.",
      action: null,
    });
    expect(buildBriefTile({ brief: null, managerInstalled: false, now, timeZone: IST })).toEqual({
      state: "empty",
      title: "Brief · Thu 22 Oct",
      copy: "Install Daily manager in Settings to get a morning brief.",
      action: { href: "/settings/packages", label: "Packages" },
    });
  });

  it("counts a brief left after the top 2 in the Needs you tile", () => {
    const base = { agentId: "m", agentName: "Daily Manager", title: "x", createdAt: now, chatId: null, cronRunId: null, cronJobId: null, tier: 3 as const, href: "/home#brief" };
    const items: NeedsYouItemLike[] = ["1", "2", "3"].map((id) => ({ ...base, id, type: "brief" as const }));
    expect(needsYouMoreLabel(items, 2)).toBe("+1 more: 1 brief");
  });
});

describe("today tile", () => {
  const now = d("2026-09-25T10:00:00Z"); // 12:00 Berlin
  const day = localDayRange(now, TZ);
  const jobs: TodayJob[] = [
    { id: "gather", name: "Lead gathering", agentName: "Lead Gatherer", enabled: true, nextFireAt: d("2026-09-26T04:00:00Z") },
    { id: "qualify", name: "Lead qualification", agentName: "Lead Qualifier", enabled: true, nextFireAt: d("2026-09-26T06:00:00Z") },
    { id: "report", name: "Weekly marketing report", agentName: "Market Analyst", enabled: true, nextFireAt: d("2026-09-25T14:00:00Z") },
    { id: "off", name: "Paused", agentName: "X", enabled: false, nextFireAt: d("2026-09-25T15:00:00Z") },
  ];
  const runs: TodayRun[] = [
    { id: "r2", jobId: "qualify", status: "succeeded", fireAt: d("2026-09-25T06:00:00Z"), error: null },
    { id: "r1", jobId: "gather", status: "failed", fireAt: d("2026-09-25T04:00:00Z"), error: "Google Places quota\nstack" },
    { id: "old", jobId: "gather", status: "succeeded", fireAt: d("2026-09-24T04:00:00Z"), error: null },
  ];

  it("lists today's runs and remaining scheduled fires in time order", () => {
    const rows = buildTodayRows({ jobs, runs, day, now, timeZone: TZ });
    expect(rows.map((r) => [r.time, r.name, r.state])).toEqual([
      ["06:00", "Lead gathering", "failed"],
      ["08:00", "Lead qualification", "done"],
      ["16:00", "Weekly marketing report", "scheduled"],
    ]);
    expect(rows[0].detail).toBe("Lead Gatherer · Google Places quota");
    expect(rows[0].href).toBe("/operator?runId=r1");
    expect(rows[2].href).toBe("/operator?tab=cron&jobId=report");
  });

  it("is empty with no jobs", () => {
    expect(buildTodayRows({ jobs: [], runs: [], day, now, timeZone: TZ })).toEqual([]);
  });
});

describe("lead engine tile", () => {
  const agent = (name: string) => ({ id: name, name });
  const workflow = (over: Partial<WorkflowView>): WorkflowView => ({
    id: "w",
    companyId: "c",
    packageSlug: "revenue",
    name: "Lead engine",
    flow: "sequence",
    position: 0,
    stages: [],
    edges: [],
    inbound: null,
    target: null,
    intake: [],
    ...over,
  });
  const stage = (id: string, order: number, metricKey: WorkflowView["stages"][number]["metricKey"], name: string, agentName: string | null, metricValue: number | null) => ({
    id,
    order,
    name,
    agent: agentName ? agent(agentName) : null,
    metricKey,
    metricValue,
    pending: 0,
    state: "default" as const,
  });

  const lead = workflow({
    id: "lead",
    position: 1,
    stages: [
      stage("q", 1, "records.qualified", "Qualified", "Lead Qualifier", 44),
      stage("g", 0, "records.gathered", "Gathered", "Lead Gatherer", 146),
      stage("d", 3, "records.delivered", "Delivered to client", null, 6),
    ],
    inbound: { stageId: "q", leads: 9, conversations: 30, customerAgents: [] },
    target: { weeklyTarget: 10, metricKey: "leads.qualified_delivered", value: 6 },
  });

  it("picks the workflow with the qualified-leads target", () => {
    const content = workflow({ id: "content", stages: [stage("p", 0, "posts.scheduled_review", "Posts", "SMM", 3)] });
    expect(pickLeadWorkflow([content, lead])?.id).toBe("lead");
    expect(pickLeadWorkflow([content])).toBeNull();
  });

  it("builds stage rows in order with agent, inbound and target notes", () => {
    expect(buildLeadEngineRows(lead)).toEqual([
      { id: "g", icon: "magnet", name: "Gathered", detail: "Lead Gatherer", value: 146 },
      { id: "q", icon: "filter", name: "Qualified", detail: "Lead Qualifier · 9 inbound", value: 44 },
      { id: "d", icon: "check", name: "Delivered to client", detail: "Target 10 this week", value: 6 },
    ]);
  });
});

describe("my tasks tile", () => {
  const today = "2026-10-22";
  const task = (id: string, over: Partial<HomeTask> = {}): HomeTask => ({
    id,
    title: `Task ${id}`,
    dueDate: null,
    status: "todo",
    ...over,
  });

  it("hides My tasks when the owner hides it, even for owners", () => {
    const config = resolveHomeTiles([
      { tileKey: "my_tasks", visible: false, position: 1, visibility: "requires", requiredPermission: "operator" },
    ]);
    expect(visibleHomeTiles(config, owner)).not.toContain("my_tasks");
    expect(visibleHomeTiles(config, member({ operator: true }))).not.toContain("my_tasks");
  });

  it("orders overdue first, then due today, then doing, then the rest by due date", () => {
    const model = buildMyTasksTile({
      today,
      tasks: [
        task("later", { dueDate: "2026-11-01" }),
        task("doing-future", { status: "doing", dueDate: "2026-10-30" }),
        task("no-date"),
        task("due-today", { dueDate: today }),
        task("overdue-newer", { dueDate: "2026-10-21" }),
        task("overdue-older", { status: "doing", dueDate: "2026-10-01" }),
        task("soon", { dueDate: "2026-10-25" }),
        task("doing-no-date", { status: "doing" }),
      ],
    });
    expect(model.tasks.map((t) => t.id)).toEqual([
      "overdue-older",
      "overdue-newer",
      "due-today",
      "doing-future",
      "doing-no-date",
    ]);
    expect(model.openCount).toBe(8);
  });

  it("caps at 5, keeps the open count before the cut, and links into the Tasks tab", () => {
    const tasks = Array.from({ length: 7 }, (_, i) => task(`t${i + 1}`, { dueDate: `2026-11-0${i + 1}` }));
    const model = buildMyTasksTile({ tasks, today });
    expect(model.tasks).toHaveLength(5);
    expect(model.openCount).toBe(7);
    expect(model.tasks[0]).toMatchObject({
      id: "t1",
      href: "/operator?tab=tasks&task=t1",
      status: "open",
    });
  });

  it("keeps only open (todo) and doing tasks, normalising todo to open", () => {
    const model = buildMyTasksTile({
      today,
      tasks: [
        task("todo-1"),
        task("doing-1", { status: "doing" }),
        task("blocked-1", { status: "blocked", dueDate: "2026-10-01" }),
        task("done-1", { status: "done", dueDate: "2026-10-01" }),
      ],
    });
    expect(model.tasks.map((t) => [t.id, t.status])).toEqual([
      ["doing-1", "doing"],
      ["todo-1", "open"],
    ]);
    expect(model.openCount).toBe(2);
  });

  it("flags overdue and due-today rows and labels due dates", () => {
    const model = buildMyTasksTile({
      today,
      tasks: [
        task("a", { dueDate: "2026-10-20" }),
        task("b", { dueDate: today }),
        task("c", { dueDate: "2026-10-30" }),
        task("d"),
      ],
    });
    expect(model.tasks.map((t) => [t.id, t.overdue, t.dueToday, t.dueLabel])).toEqual([
      ["a", true, false, "Tue 20 Oct"],
      ["b", false, true, "Thu 22 Oct"],
      ["c", false, false, "Fri 30 Oct"],
      ["d", false, false, null],
    ]);
  });

  it("is empty with no tasks", () => {
    expect(buildMyTasksTile({ tasks: [], today })).toEqual({ tasks: [], openCount: 0 });
  });
});

describe("setup steps", () => {
  it("marks done steps and links each action", () => {
    const steps = setupSteps({ companyId: "c1", hasCustomerAgent: true, hasWorkflow: false, hasConnector: false });
    expect(steps.map((s) => s.done)).toEqual([true, false, false]);
    expect(steps[2].action.href).toBe("/settings/connectors");
  });
});
