import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CheckpointCardView } from "@/lib/operator/checkpoint-card-view";

import { CheckpointChangeRequest, type CheckpointCards } from "./checkpoint-block";
import { OperatorChatConversation } from "./operator-chat-conversation";
import { quotedCheckpoint, steeringChips, steeringSubmit } from "./operator-chat-model";

const view = (extra: Partial<CheckpointCardView> = {}): CheckpointCardView => ({
  id: "cp1",
  kind: "outreach",
  status: "pending",
  state: "pending",
  title: "Schedule sequence to 44 leads",
  approveLabel: "Approve & schedule",
  actions: ["approve", "discard", "ask_for_changes"],
  canApprove: true,
  refreshRequested: false,
  superseded: false,
  ...extra,
});

describe("steeringChips (05 session/*)", () => {
  it("revenue sessions get the lead steering chips with icons", () => {
    expect(steeringChips({ packageSlug: "revenue" })).toEqual([
      { label: "Search more", icon: "search" },
      { label: "Stricter criteria", icon: "filter" },
      { label: "Explain a score", icon: "gauge" },
      { label: "Find missing emails", icon: "mail" },
    ]);
  });

  it("other agents get no chips", () => {
    expect(steeringChips({ packageSlug: null })).toEqual([]);
  });
});

describe("quotedCheckpoint", () => {
  it("quotes a card that still offers Ask for changes", () => {
    const byId = new Map([["cp1", view()]]);
    expect(quotedCheckpoint("cp1", byId)).toEqual({ id: "cp1", text: "Schedule sequence to 44 leads" });
  });

  it("drops the quote once the card no longer offers it", () => {
    const byId = new Map([["cp1", view({ state: "approved", status: "approved", actions: [] })]]);
    expect(quotedCheckpoint("cp1", byId)).toBeUndefined();
    expect(quotedCheckpoint(null, byId)).toBeUndefined();
    expect(quotedCheckpoint("gone", byId)).toBeUndefined();
  });
});

describe("steeringSubmit", () => {
  const base = { text: "Shorter please", isStarter: true, isStreaming: false };

  it("a quoted checkpoint becomes a request-changes call", () => {
    expect(steeringSubmit({ ...base, quoteId: "cp1" })).toEqual({ kind: "ask_for_changes", id: "cp1", feedback: "Shorter please" });
  });

  it("without a quote it is a message to the agent", () => {
    expect(steeringSubmit({ ...base, quoteId: undefined })).toEqual({ kind: "message", text: "Shorter please" });
  });

  it("waits while the agent runs, and ignores read-only viewers and empty text", () => {
    expect(steeringSubmit({ ...base, isStreaming: true, quoteId: undefined })).toEqual({ kind: "busy" });
    expect(steeringSubmit({ ...base, isStarter: false, quoteId: undefined })).toEqual({ kind: "ignore" });
    expect(steeringSubmit({ ...base, text: "   ", quoteId: undefined })).toEqual({ kind: "ignore" });
  });
});

describe("CheckpointChangeRequest (cards outside a session)", () => {
  it("is a Steering composer quoting the checkpoint, not a textarea box", () => {
    const html = renderToStaticMarkup(
      h(CheckpointChangeRequest, { view: view(), busy: false, onSend: () => {}, onCancel: () => {} }),
    );
    expect(html).toContain('data-slot="steering-composer"');
    expect(html).toContain('data-state="quoting"');
    expect(html).toContain("Schedule sequence to 44 leads");
    expect(html).not.toContain("Send direction");
  });
});

describe("OperatorChatConversation with session quoting", () => {
  it("renders without the inline ask box when the session owns Ask for changes", () => {
    const cards = {
      list: [view()],
      byId: new Map([["cp1", view()]]),
      busyId: null,
      onAction: () => {},
      askForChanges: () => {},
    } as CheckpointCards;
    const html = renderToStaticMarkup(
      h(OperatorChatConversation, {
        messages: [],
        isStreaming: false,
        streamFailed: false,
        checkpoints: cards,
        agentName: "Mail Marketer",
        starterName: "Talha Bera",
        starterInitials: "TB",
        onRetry: () => {},
      }),
    );
    expect(html).not.toContain("steering-composer");
  });
});
