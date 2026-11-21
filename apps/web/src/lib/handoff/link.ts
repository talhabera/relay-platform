import type { HandoffRequestStatus } from "@/db/schema";

export type HandoffLinkRow = {
  status: HandoffRequestStatus;
  expiresAt: Date;
  linkClosedAt: Date | null;
  canTakeOver: boolean;
};

export type HandoffLinkState = {
  /** First answer only; a second answer is never possible. */
  canAnswer: boolean;
  /** Until expiry or Done, even after an answer, when the request allows it. */
  canTakeOver: boolean;
  /** While taken over: send messages and hand back. Not bound by expiry. */
  canWriteAsPerson: boolean;
  /** The link's deadline has passed (or the request was expired). */
  isExpired: boolean;
};

/**
 * What a quick link may still do (spec decision 8). Opening a link is
 * idempotent: this reads state, it never changes it.
 */
export function handoffLinkState(
  row: HandoffLinkRow,
  now: Date,
): HandoffLinkState {
  const beforeDeadline = now.getTime() < row.expiresAt.getTime();
  const usable = beforeDeadline && row.linkClosedAt === null;
  const isExpired =
    row.status === "expired" ||
    ((row.status === "open" || row.status === "answered") && !beforeDeadline);

  return {
    canAnswer: row.status === "open" && usable,
    canTakeOver:
      row.canTakeOver &&
      (row.status === "open" || row.status === "answered") &&
      usable,
    canWriteAsPerson: row.status === "taken_over",
    isExpired,
  };
}
