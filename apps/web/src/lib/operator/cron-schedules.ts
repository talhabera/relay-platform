// View helpers for the Schedules tab (Figma 05 `schedules/default`, `schedules/editor`).
// Client-safe: no `@relay/db` imports (Next rewrites them to the postgres barrel).
import type { CronRunStatus } from "@/lib/operator/cron-badge";

type ScheduleFields = {
  scheduleKind: "interval" | "daily" | "weekly";
  intervalMinutes: number | null;
  weekday: number | null;
  timeOfDay: number | null;
};

const WEEKDAY_PLURAL = [
  "Sundays",
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function clock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Cadence column: "Daily · 06:00", "Mondays · 06:00", "Every 30 min", "Every 2 h". */
export function formatCadence(job: ScheduleFields): string {
  switch (job.scheduleKind) {
    case "interval": {
      const minutes = job.intervalMinutes ?? 0;
      if (minutes === 60) return "Hourly";
      if (minutes > 60 && minutes % 60 === 0) return `Every ${minutes / 60} h`;
      return `Every ${minutes} min`;
    }
    case "daily":
      return `Daily · ${clock(job.timeOfDay ?? 0)}`;
    case "weekly":
      return `${WEEKDAY_PLURAL[job.weekday ?? 0] ?? "Weekly"} · ${clock(job.timeOfDay ?? 0)}`;
  }
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** Run time in the schedule's zone: "Sat 26 Sep, 06:00". */
export function formatRunTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeZone(timeZone),
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const weekday = read("weekday");
  const day = Number(read("day"));
  const month = MONTH_SHORT[Number(read("month")) - 1] ?? "";
  const hour = read("hour").padStart(2, "0");
  const minute = read("minute").padStart(2, "0");
  return `${weekday} ${day} ${month}, ${hour}:${minute}`;
}

/** Date-only form for helper text: "Tue 29 Sep". */
export function formatRunDay(iso: string, timeZone: string): string {
  return formatRunTime(iso, timeZone).split(",")[0] ?? "";
}

export type LastRunResult = "success" | "error" | "pending" | "needs-you";

/** Last run chip: tone + label (a paused run waits on a checkpoint or question). */
export function lastRunResult(
  status: CronRunStatus | null,
): { result: LastRunResult; label: string } | null {
  switch (status) {
    case "succeeded":
      return { result: "success", label: "Succeeded" };
    case "failed":
      return { result: "error", label: "Failed" };
    case "running":
      return { result: "pending", label: "Running" };
    case "awaiting_input":
      return { result: "needs-you", label: "Needs you" };
    case null:
      return null;
  }
}

export type LastRunSummary = {
  id: string;
  status: CronRunStatus;
  fireAt: string;
  error: string | null;
};

/** Note under the last run chip: the error for a failed run, otherwise when it fired. */
export function lastRunNote(run: LastRunSummary | null, timeZone: string): string | undefined {
  if (!run) return undefined;
  if (run.status === "failed" && run.error) {
    const line = run.error.split("\n")[0]?.trim() ?? "";
    return line.length > 60 ? `${line.slice(0, 59)}…` : line;
  }
  return formatRunTime(run.fireAt, timeZone);
}

/** Deep link into the Schedules tab, optionally with a job's editor open. */
export function scheduleHref(jobId?: string | null): string {
  const search = new URLSearchParams({ tab: "cron" });
  if (jobId) search.set("jobId", jobId);
  return `/operator?${search.toString()}`;
}

/** Opens a Schedule run's transcript; runs are sessions, not part of the Schedules tab. */
export function runHref(runId: string): string {
  return `/operator?runId=${encodeURIComponent(runId)}`;
}

/** First line of the job prompt, shortened for the row subtitle. */
export function promptSummary(prompt: string, max = 64): string {
  const line = prompt.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return "No instructions";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export type ScheduleSummary = {
  total: number;
  failed: number;
  waiting: number;
  paused: number;
};

export function scheduleSummary(
  jobs: { enabled: boolean; latestStatus: CronRunStatus | null }[],
): ScheduleSummary {
  return {
    total: jobs.length,
    failed: jobs.filter((job) => job.latestStatus === "failed").length,
    waiting: jobs.filter((job) => job.latestStatus === "awaiting_input").length,
    paused: jobs.filter((job) => !job.enabled).length,
  };
}

/** Page subtitle suffix: "Times in UTC" when every schedule shares a zone. */
export function timesInLabel(jobs: { timezone: string }[]): string {
  const zones = new Set(jobs.map((job) => job.timezone));
  if (zones.size === 1) return `Times in ${[...zones][0]}`;
  return "Times in each schedule's timezone";
}

/** "Next runs: Tue 29 Sep, Wed 30 Sep, Thu 1 Oct · 09:00" (falls back to full times). */
export function nextRunsLabel(isoTimes: string[], timeZone: string): string | null {
  if (isoTimes.length === 0) return null;
  const formatted = isoTimes.map((iso) => formatRunTime(iso, timeZone));
  const clocks = new Set(formatted.map((value) => value.split(", ")[1]));
  if (clocks.size === 1) {
    const days = formatted.map((value) => value.split(", ")[0]).join(", ");
    return `Next runs: ${days} · ${[...clocks][0]}`;
  }
  return `Next runs: ${formatted.join(", ")}`;
}
