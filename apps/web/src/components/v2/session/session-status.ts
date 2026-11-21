import type { ChatStatus } from "@relay/db";

import type { StatusTone } from "../primitives/status-chip";

/** Figma Session header / Session row `status` values. */
type SessionStatus = "needs-you" | "running" | "scheduled" | "idle" | "done" | "failed";

/** Status chip tone per session status (Figma `Session header` description). */
const sessionStatusTone: Record<SessionStatus, StatusTone> = {
  "needs-you": "needs-you",
  running: "live",
  scheduled: "pending",
  idle: "neutral",
  done: "success",
  failed: "error",
};

const sessionStatusLabel: Record<SessionStatus, string> = {
  "needs-you": "Needs you",
  running: "Running",
  scheduled: "Scheduled",
  idle: "Idle",
  done: "Completed",
  failed: "Run failed",
};

const fromChat: Record<ChatStatus, SessionStatus> = {
  needs_you: "needs-you",
  running: "running",
  completed: "done",
  failed: "failed",
};

/** Maps `chats.status` to the status the session UI shows. */
function sessionStatusFromChat(status: ChatStatus): SessionStatus {
  return fromChat[status];
}

export { sessionStatusFromChat, sessionStatusLabel, sessionStatusTone };
export type { SessionStatus };
