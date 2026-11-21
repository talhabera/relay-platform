import type { CheckpointStatus } from "@/db/schema";

// Checkpoint transition table (checkpoints spec decision 2).
//
// | From      | To                | Trigger                          |
// | pending   | approved          | approve                          |
// | pending   | changes_requested | ask_for_changes                  |
// | pending   | discarded         | discard                          |
// | pending   | stale             | draft edited (approve finds it)  |
// | approved  | failed            | execution error (system)         |
// | failed    | approved          | retry (attempt count +1)         |
// | failed    | changes_requested | ask_for_changes                  |
// | failed    | discarded         | discard                          |
// | stale     | discarded         | discard                          |
// | stale     | stale             | refresh (agent posts a new card) |
// | approved  | approved          | retry, only when stuck (below)   |
//
// A card is stuck when the claim landed but no execute result was ever
// written (the process died in between) and the claim is older than
// STUCK_APPROVED_MS. Retry re-runs execution from there.
//
// Refresh does not move the card: the agent's revised card sets
// `supersededBy` on it, which closes it.

export type CheckpointAction =
  | "approve"
  | "discard"
  | "ask_for_changes"
  | "retry"
  | "refresh";

export const STUCK_APPROVED_MS = 5 * 60 * 1000;

/** Approved, never got an execute result, and the claim is old enough. */
export function isStuckApproved(
  row: {
    status: CheckpointStatus;
    executeResult: unknown;
    resolvedAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    row.status === "approved" &&
    row.executeResult == null &&
    row.resolvedAt !== null &&
    now.getTime() - row.resolvedAt.getTime() > STUCK_APPROVED_MS
  );
}

/**
 * An approved lead delivery whose send went out but whose bookkeeping
 * (markLeadDelivered) failed (W3GAP). Retry is safe here, unlike outreach:
 * the worker's send marker returns the first send's result instead of
 * sending again, so Retry only redoes the bookkeeping.
 */
export function isPersistRetryable(row: {
  status: CheckpointStatus;
  kind: string;
  executeResult: unknown;
}): boolean {
  const result = row.executeResult as { persistError?: unknown } | null;
  return (
    row.status === "approved" &&
    row.kind === "lead_delivery" &&
    result != null &&
    typeof result.persistError === "string"
  );
}

const TABLE: Record<
  CheckpointStatus,
  Partial<Record<CheckpointAction, CheckpointStatus>>
> = {
  pending: {
    approve: "approved",
    ask_for_changes: "changes_requested",
    discard: "discarded",
  },
  failed: {
    retry: "approved",
    ask_for_changes: "changes_requested",
    discard: "discarded",
  },
  stale: {
    discard: "discarded",
    refresh: "stale",
  },
  approved: {},
  changes_requested: {},
  discarded: {},
};

/**
 * Next status for a person's action on a card, or null when the action is not
 * allowed from `status`. `draftChanged` turns an approve on a pending card into
 * `stale`: approve is blocked until Refresh. `stuck` (see isStuckApproved)
 * allows Retry on an approved card.
 */
export function transitionCheckpoint(
  status: CheckpointStatus,
  action: CheckpointAction,
  draftChanged = false,
  stuck = false,
): CheckpointStatus | null {
  if (status === "approved" && action === "retry") {
    return stuck ? "approved" : null;
  }
  const next = TABLE[status][action] ?? null;
  if (next === "approved" && status === "pending" && draftChanged) {
    return "stale";
  }
  return next;
}

/** System transition: an approved card whose execution threw. */
export function failExecution(status: CheckpointStatus): CheckpointStatus | null {
  return status === "approved" ? "failed" : null;
}

/**
 * Actions the card offers this viewer. Without approve rights the card is
 * read-only (Figma state 07); the member steers in the composer instead.
 */
export function availableCheckpointActions(
  status: CheckpointStatus,
  canApprove: boolean,
  supersededBy: string | null = null,
  stuck = false,
): CheckpointAction[] {
  if (!canApprove || supersededBy) return [];
  if (status === "approved") return stuck ? ["retry"] : [];
  return (Object.keys(TABLE[status]) as CheckpointAction[]).filter(
    (action) => TABLE[status][action] !== undefined,
  );
}
