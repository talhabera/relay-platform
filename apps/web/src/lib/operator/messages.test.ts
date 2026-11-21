import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { dbMessagesToUIMessages } from "./messages";

function message(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    chatId: "chat-1",
    content: "",
    role: "assistant",
    metadata: null,
    author: null,
    authorDisplayName: null,
    createdAt: new Date(0),
    ...overrides,
  } as Message;
}

describe("dbMessagesToUIMessages", () => {
  it("restores a saved turn with tool calls between its text", () => {
    const [ui] = dbMessagesToUIMessages([
      message({
        content: "Searching.\n\nFound two.",
        metadata: {
          transcript: [
            { type: "text", text: "Searching." },
            { type: "tool-result", tool: "web_search", toolCallId: "c1", input: { q: "x" }, output: { count: 2 } },
            { type: "tool-error", tool: "fetch_url", toolCallId: "c2", input: {}, errorText: "timeout" },
            { type: "text", text: "Found two." },
          ],
        },
      }),
    ]);
    expect(ui.parts).toEqual([
      { type: "text", text: "Searching." },
      { type: "tool-web_search", toolCallId: "c1", input: { q: "x" }, state: "output-available", output: { count: 2 } },
      { type: "tool-fetch_url", toolCallId: "c2", input: {}, state: "output-error", errorText: "timeout" },
      { type: "text", text: "Found two." },
    ]);
  });

  it("keeps plain text for rows saved without a transcript", () => {
    const [ui] = dbMessagesToUIMessages([message({ content: "Hello" })]);
    expect(ui.parts).toEqual([{ type: "text", text: "Hello" }]);
  });
});
