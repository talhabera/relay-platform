import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { showWaitPulse } from "./chat-wait-pulse";

function userMessage(text: string): UIMessage {
  return {
    id: "u1",
    role: "user",
    parts: [{ type: "text", text }],
  };
}

function assistantMessage(
  overrides: Partial<UIMessage> & { parts: UIMessage["parts"] },
): UIMessage {
  return {
    id: "a1",
    role: "assistant",
    ...overrides,
  };
}

describe("showWaitPulse", () => {
  it("is hidden when not streaming", () => {
    expect(
      showWaitPulse({
        messages: [userMessage("hi")],
        isStreaming: false,
        streamFailed: false,
      }),
    ).toBe(false);
  });

  it("shows after a user send before the assistant row exists", () => {
    expect(
      showWaitPulse({
        messages: [userMessage("hi")],
        isStreaming: true,
        streamFailed: false,
      }),
    ).toBe(true);
  });

  it("shows on an empty last assistant row", () => {
    expect(
      showWaitPulse({
        messages: [
          userMessage("hi"),
          assistantMessage({ parts: [{ type: "text", text: "" }] }),
        ],
        isStreaming: true,
        streamFailed: false,
      }),
    ).toBe(true);
  });

  it("hides once assistant text exists", () => {
    expect(
      showWaitPulse({
        messages: [
          userMessage("hi"),
          assistantMessage({ parts: [{ type: "text", text: "Hello" }] }),
        ],
        isStreaming: true,
        streamFailed: false,
      }),
    ).toBe(false);
  });
});
