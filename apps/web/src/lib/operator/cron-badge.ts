export type CronJobBadge = "idle" | "running" | "needs approval";

export type CronRunStatus =
  | "running"
  | "awaiting_input"
  | "succeeded"
  | "failed";

export function cronJobBadge(args: {
  latestStatus: CronRunStatus | null;
}): CronJobBadge {
  if (args.latestStatus === "awaiting_input") return "needs approval";
  if (args.latestStatus === "running") return "running";
  return "idle";
}

export function cronRunStatusLabel(
  status: CronRunStatus | null,
): string {
  switch (status) {
    case "awaiting_input":
      return "Needs approval";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case null:
      return "No runs";
  }
}

/** Status chip tone for a cron run state (`components/v2/primitives/status-chip`). */
export function cronRunStatusTone(
  status: CronRunStatus | null,
): "pending" | "needs-you" | "success" | "error" | "neutral" {
  switch (status) {
    case "awaiting_input":
      return "needs-you";
    case "failed":
      return "error";
    case "running":
      return "pending";
    case "succeeded":
      return "success";
    case null:
      return "neutral";
  }
}
