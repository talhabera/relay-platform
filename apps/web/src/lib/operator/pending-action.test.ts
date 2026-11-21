import { describe, expect, it } from "vitest";
import { getPendingAction } from "./pending-action";

const outreachOutput = {
  status: "pending_approval",
  pendingId: "pending-1",
  kind: "action",
  actionType: "outreach",
  toolName: "proposeAction",
  channel: "email",
  recipient: "ada@acme.com",
  subject: "Hello",
  body: "Tailored note",
  reason: "Good fit",
  recordName: "Acme",
  message: "Wait for Send or Reject.",
};

describe("getPendingAction", () => {
  it("parses an outreach pending_approval payload", () => {
    expect(getPendingAction(outreachOutput)).toEqual({
      kind: "action",
      pendingId: "pending-1",
      actionType: "outreach",
      toolName: "proposeAction",
      channel: "email",
      recipient: "ada@acme.com",
      subject: "Hello",
      body: "Tailored note",
      reason: "Good fit",
      recordName: "Acme",
      message: "Wait for Send or Reject.",
    });
  });

  it("returns null without kind action", () => {
    expect(
      getPendingAction({
        status: "pending_approval",
        pendingId: "pending-1",
        message: "Wait",
      }),
    ).toBeNull();
  });
});
