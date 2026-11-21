import { describe, expect, it } from "vitest";

import type { CheckpointCardView } from "@/lib/operator/checkpoint-card-view";

import { approvableCard } from "./checkpoint-block";

function card(over: Partial<CheckpointCardView>): CheckpointCardView {
  return {
    id: "cp-1",
    kind: "lead_delivery",
    status: "pending",
    state: "pending",
    title: "Deliver lead",
    meta: "",
    preview: "",
    approveLabel: "Approve",
    actions: ["approve", "discard"],
    canApprove: true,
    refreshRequested: false,
    superseded: false,
    ...over,
  } as CheckpointCardView;
}

describe("approvableCard (W5GAP /needs-you pane)", () => {
  it("returns the selected card only for an approver", () => {
    const list = [card({ id: "cp-0" }), card({ id: "cp-1" })];
    expect(approvableCard(list, "cp-1")?.id).toBe("cp-1");
    expect(approvableCard([card({ canApprove: false })], "cp-1")).toBeNull();
    expect(approvableCard([card({ superseded: true })], "cp-1")).toBeNull();
    expect(approvableCard(list, "missing")).toBeNull();
  });
});
