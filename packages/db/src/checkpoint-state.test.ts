import { describe, expect, it } from "vitest";
import {
  checkpointArtifactHash,
  deriveSessionStatus,
  isOpenCheckpointStatus,
} from "./checkpoint-state";
import type { OutreachPayload } from "./schema/checkpoints";

const payload: OutreachPayload = {
  kind: "outreach",
  channel: "email",
  recipient: "ada@acme.com",
  subject: "Hello",
  body: "Note",
  reason: "Fit",
  recordName: "Acme",
  domain: "acme.com",
};

describe("checkpointArtifactHash", () => {
  it("ignores key order and undefined fields", () => {
    const reordered = { ...payload, subject: undefined } as OutreachPayload;
    const { subject: _s, ...withoutSubject } = payload;
    expect(checkpointArtifactHash(reordered)).toBe(
      checkpointArtifactHash(withoutSubject as OutreachPayload),
    );
    const shuffled = Object.fromEntries(
      Object.entries(payload).reverse(),
    ) as OutreachPayload;
    expect(checkpointArtifactHash(shuffled)).toBe(
      checkpointArtifactHash(payload),
    );
  });

  it("changes when the draft changes", () => {
    expect(checkpointArtifactHash({ ...payload, body: "Edited" })).not.toBe(
      checkpointArtifactHash(payload),
    );
  });
});

describe("deriveSessionStatus", () => {
  it("is needs_you while anything is open", () => {
    expect(
      deriveSessionStatus({
        running: true,
        failed: false,
        openCheckpoints: 1,
        openQuestions: 0,
      }),
    ).toBe("needs_you");
  });

  it("falls back to running, failed, completed", () => {
    const base = { openCheckpoints: 0, openQuestions: 0 };
    expect(deriveSessionStatus({ ...base, running: true, failed: false })).toBe(
      "running",
    );
    expect(deriveSessionStatus({ ...base, running: false, failed: true })).toBe(
      "failed",
    );
    expect(
      deriveSessionStatus({ ...base, running: false, failed: false }),
    ).toBe("completed");
  });
});

describe("isOpenCheckpointStatus", () => {
  it("treats pending, stale and failed as open", () => {
    expect(isOpenCheckpointStatus("pending")).toBe(true);
    expect(isOpenCheckpointStatus("stale")).toBe(true);
    expect(isOpenCheckpointStatus("failed")).toBe(true);
    expect(isOpenCheckpointStatus("changes_requested")).toBe(false);
    expect(isOpenCheckpointStatus("approved")).toBe(false);
  });
});
