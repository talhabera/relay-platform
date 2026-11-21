import { createHash } from "node:crypto";
import type { ChatStatus } from "./schema/chats";
import type { CheckpointPayload, CheckpointStatus } from "./schema/checkpoints";

// Shared by web (resolve) and worker (propose) so both sides agree on what
// "open" means, how a session status is derived and how a draft is hashed.

/** Checkpoint states that wait on a person. `changes_requested` is not one. */
export const OPEN_CHECKPOINT_STATUSES = [
  "pending",
  "stale",
  "failed",
] as const satisfies readonly CheckpointStatus[];

export function isOpenCheckpointStatus(status: CheckpointStatus): boolean {
  return (OPEN_CHECKPOINT_STATUSES as readonly CheckpointStatus[]).includes(
    status,
  );
}

/** Status a session should carry given what it is doing and what waits on it. */
export function deriveSessionStatus(args: {
  running: boolean;
  failed: boolean;
  openCheckpoints: number;
  openQuestions: number;
}): ChatStatus {
  if (args.openCheckpoints > 0 || args.openQuestions > 0) return "needs_you";
  if (args.running) return "running";
  if (args.failed) return "failed";
  return "completed";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(",")}}`;
}

/**
 * Hash of the draft a card was proposed from (checkpoints spec decision 4).
 * Key order and undefined fields do not change the hash; any edit to a value
 * does, which is what marks the card stale.
 */
export function checkpointArtifactHash(payload: CheckpointPayload): string {
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}
