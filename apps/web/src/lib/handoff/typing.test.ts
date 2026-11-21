import { describe, expect, it } from "vitest";
import { clearTyping, isTyping, markTyping, TYPING_TTL_MS } from "./typing";

describe("handoff typing presence", () => {
  it("shows a party as typing until the TTL runs out", () => {
    markTyping("chat-a", "person", 1_000);
    expect(isTyping("chat-a", "person", 1_000 + TYPING_TTL_MS - 1)).toBe(true);
    expect(isTyping("chat-a", "person", 1_000 + TYPING_TTL_MS)).toBe(false);
  });

  it("keeps parties and chats apart", () => {
    markTyping("chat-b", "customer", 1_000);
    expect(isTyping("chat-b", "person", 1_000)).toBe(false);
    expect(isTyping("chat-c", "customer", 1_000)).toBe(false);
  });

  it("stops at once when the message is sent", () => {
    markTyping("chat-d", "person", 1_000);
    clearTyping("chat-d", "person");
    expect(isTyping("chat-d", "person", 1_000)).toBe(false);
  });
});
