import { describe, expect, it } from "vitest";
import {
  availableCheckpointActions,
  failExecution,
  isStuckApproved,
  transitionCheckpoint,
} from "./approvals";

describe("transitionCheckpoint", () => {
  it.each([
    ["pending", "approve", false, "approved"],
    ["pending", "approve", true, "stale"],
    ["pending", "ask_for_changes", false, "changes_requested"],
    ["pending", "discard", false, "discarded"],
    ["pending", "discard", true, "discarded"],
    ["failed", "retry", false, "approved"],
    ["failed", "ask_for_changes", false, "changes_requested"],
    ["failed", "discard", false, "discarded"],
    ["stale", "discard", false, "discarded"],
    ["stale", "refresh", false, "stale"],
  ] as const)("%s + %s (draft changed=%s) -> %s", (status, action, changed, expected) => {
    expect(transitionCheckpoint(status, action, changed)).toBe(expected);
  });

  it.each([
    ["pending", "retry"],
    ["pending", "refresh"],
    ["stale", "approve"],
    ["stale", "retry"],
    ["stale", "ask_for_changes"],
    ["failed", "approve"],
    ["failed", "refresh"],
    ["approved", "approve"],
    ["approved", "discard"],
    ["approved", "retry"],
    ["discarded", "approve"],
    ["discarded", "discard"],
    ["changes_requested", "approve"],
    ["changes_requested", "discard"],
  ] as const)("rejects %s + %s", (status, action) => {
    expect(transitionCheckpoint(status, action)).toBeNull();
  });

  it("allows Retry on an approved card only when stuck", () => {
    expect(transitionCheckpoint("approved", "retry", false, true)).toBe(
      "approved",
    );
    expect(transitionCheckpoint("approved", "retry", false, false)).toBeNull();
    expect(transitionCheckpoint("approved", "discard", false, true)).toBeNull();
  });

  it("only approved cards can fail", () => {
    expect(failExecution("approved")).toBe("failed");
    expect(failExecution("pending")).toBeNull();
  });
});

describe("isStuckApproved", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("is stuck after 5 minutes without an execute result", () => {
    expect(
      isStuckApproved(
        { status: "approved", executeResult: null, resolvedAt: ago(5 * 60_000 + 1) },
        now,
      ),
    ).toBe(true);
  });

  it("is not stuck when fresh, executed, or not approved", () => {
    expect(
      isStuckApproved(
        { status: "approved", executeResult: null, resolvedAt: ago(60_000) },
        now,
      ),
    ).toBe(false);
    expect(
      isStuckApproved(
        { status: "approved", executeResult: { mode: "copy" }, resolvedAt: ago(3_600_000) },
        now,
      ),
    ).toBe(false);
    expect(
      isStuckApproved(
        { status: "failed", executeResult: null, resolvedAt: ago(3_600_000) },
        now,
      ),
    ).toBe(false);
  });
});

describe("availableCheckpointActions", () => {
  it("offers Retry only on a stuck approved card", () => {
    expect(availableCheckpointActions("approved", true)).toEqual([]);
    expect(availableCheckpointActions("approved", true, null, true)).toEqual([
      "retry",
    ]);
  });

  it("is read-only for members without approve rights", () => {
    expect(availableCheckpointActions("pending", false)).toEqual([]);
  });

  it("offers the transitions from the current state", () => {
    expect(availableCheckpointActions("pending", true)).toEqual([
      "approve",
      "ask_for_changes",
      "discard",
    ]);
    expect(availableCheckpointActions("stale", true)).toEqual([
      "discard",
      "refresh",
    ]);
    expect(availableCheckpointActions("failed", true)).toEqual([
      "retry",
      "ask_for_changes",
      "discard",
    ]);
  });

  it("offers nothing on a superseded card", () => {
    expect(availableCheckpointActions("stale", true, "newer-card")).toEqual([]);
  });
});
