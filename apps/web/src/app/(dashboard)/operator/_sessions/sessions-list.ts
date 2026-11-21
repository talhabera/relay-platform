import type { ChatStatus } from "@relay/db";
import { runHref } from "@/lib/operator/cron-schedules";

/** Operator sub-nav tabs. `cron` is the Schedules tab; its URL value predates the redesign. */
export const OPERATOR_TABS = ["overview", "sessions", "tasks", "cron", "pipeline"] as const;
export type OperatorTab = (typeof OPERATOR_TABS)[number];

/** Resolves `?tab=`. Unknown or missing values open Overview. */
export function resolveOperatorTab(tab: string | undefined): OperatorTab {
  return OPERATOR_TABS.includes(tab as OperatorTab) ? (tab as OperatorTab) : "overview";
}

export const SESSION_STATUS_FILTERS = ["all", "running", "needs_you", "completed", "failed"] as const;
export type SessionStatusFilter = (typeof SESSION_STATUS_FILTERS)[number];

export const SESSION_RANGES = ["7d", "30d", "90d", "all"] as const;
export type SessionRange = (typeof SESSION_RANGES)[number];

export const DEFAULT_SESSION_RANGE: SessionRange = "30d";

export type SessionsFilters = {
  status: SessionStatusFilter;
  workflowId: string | null;
  agentId: string | null;
  range: SessionRange;
  q: string;
};

export type SessionListRow = {
  id: string;
  title: string;
  status: ChatStatus;
  agentId: string | null;
  agentName: string;
  versionId: string | null;
  versionName: string | null;
  versionStatus: "live" | "draft" | null;
  /** Workflows whose stages this agent runs. */
  workflowIds: string[];
  /** e.g. "Lead engine · Qualify"; null when the agent is in no workflow. */
  workflowLabel: string | null;
  starterName: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  openCheckpoints: number;
  /** Set when the row is a Schedule run (cron_runs), not a chat. */
  runId: string | null;
  /** The Schedule that started the run. */
  scheduleName: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseSessionsFilters(params: RawParams): SessionsFilters {
  const status = first(params.status);
  const range = first(params.range);
  const q = first(params.q)?.trim() ?? "";
  return {
    status: SESSION_STATUS_FILTERS.includes(status as SessionStatusFilter)
      ? (status as SessionStatusFilter)
      : "all",
    workflowId: first(params.workflow) || null,
    agentId: first(params.agent) || null,
    range: SESSION_RANGES.includes(range as SessionRange) ? (range as SessionRange) : DEFAULT_SESSION_RANGE,
    q: q.slice(0, 200),
  };
}

const RANGE_DAYS: Record<Exclude<SessionRange, "all">, number> = { "7d": 7, "30d": 30, "90d": 90 };

/** First instant of the range, or null for all time. */
export function rangeStart(range: SessionRange, now: Date): Date | null {
  if (range === "all") return null;
  return new Date(now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000);
}

function inRange(row: SessionListRow, start: Date | null) {
  return start === null || row.lastActivityAt >= start;
}

/** Rows in the date range; the status chip counts and "of N" totals use this set. */
export function sessionsInRange(rows: SessionListRow[], range: SessionRange, now: Date) {
  const start = rangeStart(range, now);
  return rows.filter((row) => inRange(row, start));
}

export function filterSessions(rows: SessionListRow[], filters: SessionsFilters, now: Date) {
  const q = filters.q.toLowerCase();
  return sessionsInRange(rows, filters.range, now).filter(
    (row) =>
      (filters.status === "all" || row.status === filters.status) &&
      (filters.workflowId === null || row.workflowIds.includes(filters.workflowId)) &&
      (filters.agentId === null || row.agentId === filters.agentId) &&
      (q === "" ||
        row.title.toLowerCase().includes(q) ||
        row.agentName.toLowerCase().includes(q) ||
        (row.workflowLabel?.toLowerCase().includes(q) ?? false)),
  );
}

export function sessionStatusCounts(rows: SessionListRow[]): Record<SessionStatusFilter, number> {
  const counts: Record<SessionStatusFilter, number> = {
    all: rows.length,
    running: 0,
    needs_you: 0,
    completed: 0,
    failed: 0,
  };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

/** Status, workflow, agent or search narrow the list; the date range alone does not. */
export function hasActiveFilters(filters: SessionsFilters) {
  return filters.status !== "all" || filters.workflowId !== null || filters.agentId !== null || filters.q !== "";
}

/** `/operator?tab=sessions` with the filters applied; defaults are left out of the URL. */
export function sessionsHref(filters: SessionsFilters, patch: Partial<SessionsFilters> = {}) {
  const next = { ...filters, ...patch };
  const search = new URLSearchParams({ tab: "sessions" });
  if (next.status !== "all") search.set("status", next.status);
  if (next.workflowId) search.set("workflow", next.workflowId);
  if (next.agentId) search.set("agent", next.agentId);
  if (next.range !== DEFAULT_SESSION_RANGE) search.set("range", next.range);
  if (next.q) search.set("q", next.q);
  return `/operator?${search.toString()}`;
}

/** Clears status, workflow, agent and search; keeps the date range. */
export function clearedSessionsHref(filters: SessionsFilters) {
  return sessionsHref({ ...filters, status: "all", workflowId: null, agentId: null, q: "" });
}

/** Opens the session in the operator workbench; the page reads agent and version from the chat. */
export function sessionHref(row: Pick<SessionListRow, "id">) {
  return `/operator?chatId=${encodeURIComponent(row.id)}`;
}

/** A list row's link: the chat, or the Schedule run it stands for. */
export function sessionRowHref(row: Pick<SessionListRow, "id" | "runId">) {
  return row.runId ? runHref(row.runId) : sessionHref(row);
}

export const SESSION_STATUS_FILTER_LABEL: Record<SessionStatusFilter, string> = {
  all: "All",
  running: "Running",
  needs_you: "Needs you",
  completed: "Completed",
  failed: "Failed",
};

/** The company timezone if Intl knows it, else UTC. */
export function safeTimeZone(timeZone: string | null | undefined) {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** e.g. "Fri 25 Sep, 12:02" in the company timezone. */
export function formatSessionTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}, ${get("hour")}:${get("minute")}`;
}

/** "Just now", "12 min ago", "2 h ago"; a day or older falls back to the absolute time. */
export function formatLastActivity(date: Date, now: Date, timeZone: string) {
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return formatSessionTime(date, timeZone);
}

function formatDay(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric", month: "short" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")}`;
}

/** Date filter label, e.g. "26 Aug – 25 Sep" or "All time". */
export function rangeLabel(range: SessionRange, now: Date, timeZone: string) {
  const start = rangeStart(range, now);
  if (!start) return "All time";
  return `${formatDay(start, timeZone)} – ${formatDay(now, timeZone)}`;
}

/** Short timezone name for the page subtitle, e.g. "CET" or "GMT+3". */
export function timeZoneLabel(timeZone: string, now: Date) {
  const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" })
    .formatToParts(now)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? timeZone;
}

type SummaryInput = {
  filters: SessionsFilters;
  shown: number;
  total: number;
  workflowName: string | null;
  agentName: string | null;
  now: Date;
  timeZone: string;
};

/** Footer line under the table. */
export function sessionsSummary({ filters, shown, total, workflowName, agentName, now, timeZone }: SummaryInput) {
  const start = rangeStart(filters.range, now);
  if (!hasActiveFilters(filters)) {
    const noun = total === 1 ? "session" : "sessions";
    const span = start ? ` from ${formatDay(start, timeZone)} to ${formatDay(now, timeZone)}` : "";
    return `Showing ${total} ${noun}${span}. Finished sessions stay listed and open read-only.`;
  }
  const parts = [
    filters.status !== "all" ? SESSION_STATUS_FILTER_LABEL[filters.status] : null,
    workflowName,
    agentName,
    filters.q ? `“${filters.q}”` : null,
    rangeLabel(filters.range, now, timeZone),
  ].filter(Boolean);
  return `${shown} of ${total} ${total === 1 ? "session matches" : "sessions match"} ${parts.join(" · ")}.`;
}

/** Empty-state body when filters leave nothing. */
export function emptyFilteredDescription({
  filters,
  total,
  workflowName,
  agentName,
  now,
  timeZone,
}: Omit<SummaryInput, "shown">) {
  const status = filters.status === "all" ? "" : `${SESSION_STATUS_FILTER_LABEL[filters.status].toLowerCase()} `;
  const where = [
    workflowName ? ` in ${workflowName}` : "",
    agentName ? ` for ${agentName}` : "",
    filters.q ? ` matching “${filters.q}”` : "",
  ].join("");
  const start = rangeStart(filters.range, now);
  const when = start ? ` between ${formatDay(start, timeZone)} and ${formatDay(now, timeZone)}` : "";
  const all = total === 1 ? "the 1 session" : `all ${total} sessions`;
  return `No ${status}sessions${where}${when}. Clear the filters to see ${all}.`;
}
