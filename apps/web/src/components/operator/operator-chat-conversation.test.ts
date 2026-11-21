import type { UIMessage } from "ai";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CheckpointCards } from "./checkpoint-block";
import { OperatorChatConversation } from "./operator-chat-conversation";

const cards: CheckpointCards = { list: [], byId: new Map(), busyId: null, onAction: () => {} } as unknown as CheckpointCards;

const pending = {
  kind: "action",
  status: "pending_approval",
  actionType: "outreach",
  pendingId: "cp1",
  toolName: "proposeOutreach",
  channel: "email",
  recipient: "julia@brandt.de",
  body: "Hi Julia",
  reason: "Fit",
  recordName: "Brandt Logistik",
  message: "Waiting for approval",
  subject: "Quick question",
};

function render(messages: UIMessage[], opts: { isStreaming?: boolean; streamFailed?: boolean } = {}) {
  return renderToStaticMarkup(
    h(OperatorChatConversation, {
      messages,
      isStreaming: opts.isStreaming ?? false,
      streamFailed: opts.streamFailed ?? false,
      checkpoints: cards,
      agentName: "Lead Qualifier",
      versionLabel: "v1 Live",
      starterName: "Talha Bera",
      starterInitials: "TB",
      onRetry: () => {},
    }),
  );
}

describe("OperatorChatConversation", () => {
  it("operator and agent messages with version pill and tool chips", () => {
    const html = render([
      { id: "u1", role: "user", parts: [{ type: "text", text: "Keep only offices" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Done." },
          { type: "dynamic-tool", toolName: "googlePlacesSearch", toolCallId: "t1", state: "output-available", input: {}, output: {} },
        ],
      },
    ]);
    expect(html).toContain('data-role="operator"');
    expect(html).toContain("Talha Bera");
    expect(html).toContain(">TB<");
    expect(html).toContain('data-role="agent"');
    expect(html).toContain("v1 Live");
    expect(html).toContain('data-slot="tool-chip"');
    expect(html).toContain("Google places search");
  });

  it("typing placeholder while the agent has not answered", () => {
    const html = render([{ id: "u1", role: "user", parts: [{ type: "text", text: "Go" }] }], { isStreaming: true });
    expect(html).toContain('data-state="streaming"');
    expect(html).toContain("typing…");
  });

  it("keeps the agent's checkpoint card in the conversation pane", () => {
    const html = render([
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "dynamic-tool", toolName: "proposeOutreach", toolCallId: "t1", state: "output-available", input: {}, output: pending }],
      },
    ]);
    expect(html).toContain('data-slot="checkpoint-card"');
    expect(html).toContain("Send to Brandt Logistik");
    // The proposal is a card, not a tool chip.
    expect(html).not.toContain('data-slot="tool-chip"');
  });

  it("error state with Retry when the stream failed", () => {
    const html = render(
      [
        { id: "u1", role: "user", parts: [{ type: "text", text: "Go" }] },
        { id: "a1", role: "assistant", parts: [{ type: "text", text: "Half" }] },
      ],
      { streamFailed: true },
    );
    expect(html).toContain('data-slot="message-error"');
    expect(html).toContain("The agent stopped before finishing");
  });
});
