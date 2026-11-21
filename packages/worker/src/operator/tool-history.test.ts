import { describe, expect, it } from "vitest";
import { transcriptFromSteps } from "./tool-history";

// Step content as the AI SDK emits it; the function only reads text and tool parts.
const fromSteps = (steps: unknown) => transcriptFromSteps(steps as Parameters<typeof transcriptFromSteps>[0]);

describe("transcriptFromSteps", () => {
  it("keeps text and tool calls in order across steps and joins all text", () => {
    const result = fromSteps([
      {
        content: [
          { type: "text", text: "Searching." },
          { type: "tool-call", toolCallId: "c1", toolName: "web_search", input: { q: "x" } },
          { type: "tool-result", toolCallId: "c1", toolName: "web_search", input: { q: "x" }, output: { count: 2 } },
        ],
      },
      {
        content: [
          { type: "tool-error", toolCallId: "c2", toolName: "fetch_url", input: {}, error: new Error("timeout") },
          { type: "text", text: "Found two." },
        ],
      },
    ]);
    expect(result.text).toBe("Searching.\n\nFound two.");
    expect(result.hasTools).toBe(true);
    expect(result.transcript).toEqual([
      { type: "text", text: "Searching." },
      { type: "tool-result", tool: "web_search", toolCallId: "c1", input: { q: "x" }, output: { count: 2 } },
      { type: "tool-error", tool: "fetch_url", toolCallId: "c2", input: {}, errorText: "timeout" },
      { type: "text", text: "Found two." },
    ]);
  });

  it("shrinks large outputs to their scalar fields", () => {
    const { transcript } = fromSteps([
      {
        content: [
          { type: "tool-result", toolCallId: "c1", toolName: "t", input: {}, output: { summary: "ok", rows: "x".repeat(9000).split("") } },
        ],
      },
    ]);
    expect(transcript[0]).toMatchObject({ output: { truncated: true, summary: "ok" } });
  });
});
