import type { DailyBriefItem, DailyBriefItemKind, DailyBriefItemStatus, TaskStatus } from "@relay/db/schema";
import type { IconName, StatusTone } from "@/components/v2/primitives";
import type { WorkflowStageView, WorkflowView } from "@/lib/fixtures/interfaces";
import type { NeedsYouItemLike } from "@/lib/operator/needs-you-view";
import { needsYouRowKind } from "@/lib/operator/needs-you-view";
import type { MetricKey } from "@/lib/workflows/metrics";

// Pure view model for Home (Figma 04 `home/{default, member, empty, loading}`).

/** Needs you tile shows the top of the impact order (needs-you-ordering spec). */
export const HOME_NEEDS_YOU_TOP = 2;

const LEAD_TARGET_METRIC: MetricKey = "leads.qualified_delivered";

function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    day: get("day"),
    month: get("month"),
    year: get("year"),
    hour: Number(get("hour")),
    time: `${get("hour")}:${get("minute")}`,
  };
}

function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/, 1)[0] ?? "";
}

/** "Good morning, Talha" by the company's clock; "Welcome, Talha" on the empty state. */
export function homeGreeting(args: { name: string | null | undefined; now: Date; timeZone: string; empty?: boolean }) {
  const who = firstName(args.name);
  if (args.empty) return who ? `Welcome, ${who}` : "Welcome";
  const hour = localParts(args.now, args.timeZone).hour;
  const part = hour < 5 ? "evening" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return who ? `Good ${part}, ${who}` : `Good ${part}`;
}

/** "Friday 25 Sep 2026". */
export function homeDateLabel(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`;
}

/** "Today · Fri 25 Sep". */
export function todayTitle(now: Date, timeZone: string): string {
  const p = localParts(now, timeZone);
  return `Today · ${p.weekday.slice(0, 3)} ${p.day} ${p.month}`;
}

/** "HH:mm" in company time. */
export function clockLabel(date: Date, timeZone: string): string {
  return localParts(date, timeZone).time;
}

// ---------------------------------------------------------------------------
// Daily brief tile
// ---------------------------------------------------------------------------

/** Today's brief as Home reads it: a projection of the `daily_briefs` row. */
export type HomeBrief = {
  id: string;
  localDate: string;
  summary: string;
  items: DailyBriefItem[];
  readAt: Date | null;
  createdAt: Date;
};

export const BRIEF_KIND: Record<DailyBriefItemKind, { label: string; tone: StatusTone }> = {
  do: { label: "Do today", tone: "needs-you" },
  setup: { label: "Set up", tone: "neutral" },
  decide: { label: "Decide", tone: "pending" },
};

/** A brief item with its kind label; a missing stored `status` is normalised to `open`. */
export type BriefTileItem = DailyBriefItem & { kindLabel: string; status: DailyBriefItemStatus };

export type BriefTileModel =
  | {
      state: "brief";
      id: string;
      localDate: string;
      title: string;
      summary: string;
      /** Visible items (open and done) in rank order; dismissed items are separate. */
      items: BriefTileItem[];
      dismissedItems: BriefTileItem[];
      dismissedCount: number;
      unread: boolean;
    }
  | { state: "empty"; title: string; copy: string; action: { href: string; label: string } | null };

/** "Thu 22 Oct" for a `YYYY-MM-DD` local date. */
function shortDateLabel(localDate: string): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const p = localParts(new Date(Date.UTC(y, m - 1, d, 12)), "UTC");
  return `${p.weekday.slice(0, 3)} ${p.day} ${p.month}`;
}

/** "Brief · Thu 22 Oct" for a `YYYY-MM-DD` local date. */
export function briefTitle(localDate: string): string {
  return `Brief · ${shortDateLabel(localDate)}`;
}

/**
 * Today's brief, items in rank order. Without one: when the brief arrives if
 * Daily manager is installed, else where to install it.
 */
export function buildBriefTile(args: {
  brief: HomeBrief | null;
  managerInstalled: boolean;
  now: Date;
  timeZone: string;
}): BriefTileModel {
  const { brief } = args;
  if (!brief) {
    const p = localParts(args.now, args.timeZone);
    const title = `Brief · ${p.weekday.slice(0, 3)} ${p.day} ${p.month}`;
    return args.managerInstalled
      ? { state: "empty", title, copy: "Your first brief arrives at 08:30.", action: null }
      : {
          state: "empty",
          title,
          copy: "Install Daily manager in Settings to get a morning brief.",
          action: { href: "/settings/packages", label: "Packages" },
        };
  }
  const all = [...brief.items]
    .sort((a, b) => a.rank - b.rank)
    .map((item): BriefTileItem => ({
      ...item,
      status: item.status ?? "open",
      kindLabel: BRIEF_KIND[item.kind].label,
    }));
  const dismissedItems = all.filter((item) => item.status === "dismissed");
  return {
    state: "brief",
    id: brief.id,
    localDate: brief.localDate,
    title: briefTitle(brief.localDate),
    summary: brief.summary,
    items: all.filter((item) => item.status !== "dismissed"),
    dismissedItems,
    dismissedCount: dismissedItems.length,
    unread: brief.readAt === null,
  };
}

// ---------------------------------------------------------------------------
// My tasks tile
// ---------------------------------------------------------------------------

/** My tasks tile caps its list here; the header count is the full open total. */
export const HOME_MY_TASKS_MAX = 5;

/** A task as Home reads it: a projection of the `tasks` row, never the row itself. */
export type HomeTask = {
  id: string;
  title: string;
  /** Company-local `YYYY-MM-DD`, or null. */
  dueDate: string | null;
  status: TaskStatus;
};

export type MyTaskRow = {
  id: string;
  title: string;
  /** `todo` shows as `open`. */
  status: "open" | "doing";
  dueDate: string | null;
  /** "Thu 22 Oct"; null without a due date. */
  dueLabel: string | null;
  overdue: boolean;
  dueToday: boolean;
  href: string;
};

export type MyTasksTileModel = { tasks: MyTaskRow[]; openCount: number };

export function taskHref(id: string): string {
  return `/operator?tab=tasks&task=${encodeURIComponent(id)}`;
}

/**
 * The viewer's open (`todo`) and `doing` tasks: overdue first, then due
 * today, then doing, then the rest; each group by due date, undated last.
 * `today` is the company-local `YYYY-MM-DD`. `openCount` is the total before
 * the cap of {@link HOME_MY_TASKS_MAX}.
 */
export function buildMyTasksTile(args: { tasks: readonly HomeTask[]; today: string }): MyTasksTileModel {
  const { today } = args;
  const rows = args.tasks
    .filter((t) => t.status === "todo" || t.status === "doing")
    .map(
      (t): MyTaskRow => ({
        id: t.id,
        title: t.title,
        status: t.status === "doing" ? "doing" : "open",
        dueDate: t.dueDate,
        dueLabel: t.dueDate ? shortDateLabel(t.dueDate) : null,
        overdue: t.dueDate !== null && t.dueDate < today,
        dueToday: t.dueDate === today,
        href: taskHref(t.id),
      }),
    );
  const group = (r: MyTaskRow) => (r.overdue ? 0 : r.dueToday ? 1 : r.status === "doing" ? 2 : 3);
  const byDue = (a: MyTaskRow, b: MyTaskRow) =>
    a.dueDate === b.dueDate ? 0 : a.dueDate === null ? 1 : b.dueDate === null ? -1 : a.dueDate < b.dueDate ? -1 : 1;
  const sorted = rows.sort((a, b) => group(a) - group(b) || byDue(a, b));
  return { tasks: sorted.slice(0, HOME_MY_TASKS_MAX), openCount: sorted.length };
}

// ---------------------------------------------------------------------------
// Needs you tile
// ---------------------------------------------------------------------------

const KIND_NOUN = {
  brief: ["brief", "briefs"],
  checkpoint: ["checkpoint", "checkpoints"],
  question: ["question", "questions"],
  "failed-run": ["failed run", "failed runs"],
} as const;

/** "+3 more: 3 checkpoints" or "+4 more: 3 checkpoints, 1 question"; null when nothing is left. */
export function needsYouMoreLabel(items: readonly NeedsYouItemLike[], shown: number): string | null {
  const rest = items.slice(shown);
  if (rest.length === 0) return null;
  const counts = new Map<keyof typeof KIND_NOUN, number>();
  for (const item of rest) {
    const kind = needsYouRowKind(item.type);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const parts = [...counts].map(([kind, n]) => `${n} ${KIND_NOUN[kind][n === 1 ? 0 : 1]}`);
  return `+${rest.length} more: ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Today tile
// ---------------------------------------------------------------------------

export type TodayJob = {
  id: string;
  name: string;
  agentName: string;
  enabled: boolean;
  nextFireAt: Date;
};

export type TodayRun = {
  id: string;
  jobId: string;
  status: "running" | "awaiting_input" | "succeeded" | "failed";
  fireAt: Date;
  error: string | null;
};

export type TodayRowState = "failed" | "done" | "running" | "needs-you" | "scheduled";

export type TodayRow = {
  id: string;
  at: Date;
  time: string;
  name: string;
  detail: string;
  state: TodayRowState;
  href: string;
};

export const TODAY_STATE: Record<TodayRowState, { label: string; tone: StatusTone; icon: IconName; iconClass: string }> = {
  failed: { label: "Failed", tone: "error", icon: "circle-x", iconClass: "text-destructive" },
  done: { label: "Done", tone: "success", icon: "circle-check", iconClass: "text-primary" },
  running: { label: "Running", tone: "pending", icon: "loader-circle", iconClass: "text-muted-foreground" },
  "needs-you": { label: "Needs you", tone: "needs-you", icon: "message-circle", iconClass: "text-muted-foreground" },
  scheduled: { label: "Scheduled", tone: "neutral", icon: "clock", iconClass: "text-muted-foreground" },
};

const RUN_STATE: Record<TodayRun["status"], TodayRowState> = {
  failed: "failed",
  succeeded: "done",
  running: "running",
  awaiting_input: "needs-you",
};

const ERROR_MAX = 40;

function shortError(error: string | null): string | null {
  const line = error?.trim().split(/\r?\n/, 1)[0]?.trim();
  if (!line) return null;
  return line.length > ERROR_MAX ? `${line.slice(0, ERROR_MAX - 1)}…` : line;
}

/**
 * Today's schedule in company time: every run that fired today, plus each enabled
 * job's next fire if it is still today. Sorted by time.
 */
export function buildTodayRows(args: {
  jobs: readonly TodayJob[];
  runs: readonly TodayRun[];
  day: { from: Date; to: Date };
  now: Date;
  timeZone: string;
}): TodayRow[] {
  const { day, now, timeZone } = args;
  const jobs = new Map(args.jobs.map((j) => [j.id, j]));
  const inDay = (d: Date) => d >= day.from && d < day.to;
  const rows: TodayRow[] = [];
  const fired = new Set<string>();

  for (const run of args.runs) {
    const job = jobs.get(run.jobId);
    if (!job || !inDay(run.fireAt)) continue;
    fired.add(`${job.id}:${run.fireAt.getTime()}`);
    const state = RUN_STATE[run.status];
    const error = state === "failed" ? shortError(run.error) : null;
    rows.push({
      id: run.id,
      at: run.fireAt,
      time: clockLabel(run.fireAt, timeZone),
      name: job.name,
      detail: error ? `${job.agentName} · ${error}` : job.agentName,
      state,
      href: `/operator?runId=${run.id}`,
    });
  }

  for (const job of args.jobs) {
    if (!job.enabled || !inDay(job.nextFireAt) || job.nextFireAt < now) continue;
    if (fired.has(`${job.id}:${job.nextFireAt.getTime()}`)) continue;
    rows.push({
      id: `${job.id}:next`,
      at: job.nextFireAt,
      time: clockLabel(job.nextFireAt, timeZone),
      name: job.name,
      detail: job.agentName,
      state: "scheduled",
      href: `/operator?tab=cron&jobId=${job.id}`,
    });
  }

  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

// ---------------------------------------------------------------------------
// Lead engine tile
// ---------------------------------------------------------------------------

/** The workflow whose target counts delivered qualified leads; else the first lead workflow. */
export function pickLeadWorkflow(workflows: readonly WorkflowView[]): WorkflowView | null {
  const sorted = [...workflows].sort((a, b) => a.position - b.position);
  return (
    sorted.find((w) => w.target?.metricKey === LEAD_TARGET_METRIC) ??
    sorted.find((w) => w.stages.some((s) => s.metricKey.startsWith("records.") || s.metricKey.startsWith("leads."))) ??
    null
  );
}

export type LeadEngineRow = {
  id: string;
  icon: IconName;
  name: string;
  detail: string | null;
  value: number | null;
};

const STAGE_ICON: Partial<Record<MetricKey, IconName>> = {
  "records.gathered": "magnet",
  "records.qualified": "filter",
  "records.contacted_replied": "send",
  "records.delivered": "check",
  "leads.qualified_delivered": "check",
};

function stageDetail(stage: WorkflowStageView, workflow: WorkflowView): string | null {
  const parts: string[] = [];
  if (stage.agent) parts.push(stage.agent.name);
  if (workflow.inbound?.stageId === stage.id && workflow.inbound.leads > 0) {
    parts.push(`${workflow.inbound.leads} inbound`);
  }
  if (!stage.agent && workflow.target) parts.push(`Target ${workflow.target.weeklyTarget} this week`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** One row per stage in order: icon, stage name, agent (and inbound), this week's value. */
export function buildLeadEngineRows(workflow: WorkflowView): LeadEngineRow[] {
  return [...workflow.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => ({
      id: stage.id,
      icon: STAGE_ICON[stage.metricKey] ?? "workflow",
      name: stage.name,
      detail: stageDetail(stage, workflow),
      value: stage.metricValue,
    }));
}

// ---------------------------------------------------------------------------
// Empty state (04 `home/empty`): set-up steps
// ---------------------------------------------------------------------------

export type SetupStep = {
  id: "customer-agent" | "workflows" | "connectors";
  title: string;
  description: string;
  done: boolean;
  action: { label: string; href: string };
};

export function setupSteps(args: {
  companyId: string;
  hasCustomerAgent: boolean;
  hasWorkflow: boolean;
  hasConnector: boolean;
}): SetupStep[] {
  return [
    {
      id: "customer-agent",
      title: "Create a customer agent",
      description:
        "It answers people on your channels, books visits and passes inbound leads to your operator agents.",
      done: args.hasCustomerAgent,
      action: { label: "Create customer agent", href: "/agents" },
    },
    {
      id: "workflows",
      title: "Pick workflows",
      description: "Each workflow runs pre-defined operator agents. You approve every checkpoint before anything goes out.",
      done: args.hasWorkflow,
      action: { label: "Start workflows", href: "/operator" },
    },
    {
      id: "connectors",
      title: "Connect your tools",
      description: "Connectors give operator agents lead data and a way to send. Add keys in Settings, Connectors.",
      done: args.hasConnector,
      action: { label: "Open connectors", href: "/settings/connectors" },
    },
  ];
}
