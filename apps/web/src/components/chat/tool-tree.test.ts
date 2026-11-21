import { describe, expect, it } from "vitest";
import { getToolName, type UIMessage } from "ai";
import { toolTreeRows } from "./tool-tree";

function part(
  overrides: Record<string, unknown>,
): UIMessage["parts"][number] {
  return {
    type: "tool-web_search",
    toolCallId: "call-1",
    state: "output-available",
    input: {},
    output: {},
    ...overrides,
  } as UIMessage["parts"][number];
}

const outreach = {
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

describe("toolTreeRows", () => {
  it("maps input-streaming to in-progress", () => {
    const fixture = part({ state: "input-streaming", output: undefined });
    const rows = toolTreeRows([fixture], { streamFailed: false });
    expect(rows).toEqual([
      {
        toolCallId: "call-1",
        name: getToolName(fixture as never),
        state: "in-progress",
        summary: null,
        downloadPath: null,
        filename: null,
      },
    ]);
  });

  it("maps output-available without error to done", () => {
    const rows = toolTreeRows(
      [part({ output: { status: "ok" } })],
      { streamFailed: false },
    );
    expect(rows[0]?.state).toBe("done");
    expect(rows[0]?.summary).toBe("ok");
  });

  it("maps output-available { error } to failed", () => {
    const rows = toolTreeRows(
      [part({ output: { error: "Not found" } })],
      { streamFailed: false },
    );
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.summary).toBe("Not found");
  });

  it("maps output-error to failed", () => {
    const rows = toolTreeRows(
      [part({ state: "output-error", output: undefined, errorText: "boom" })],
      { streamFailed: false },
    );
    expect(rows[0]?.state).toBe("failed");
    expect(rows[0]?.summary).toBe("boom");
  });

  it("defaults filename when downloadPath is present", () => {
    const rows = toolTreeRows(
      [
        part({
          output: {
            downloadPath: "/api/operator/sessions/c1/files/f1",
          },
        }),
      ],
      { streamFailed: false },
    );
    expect(rows[0]?.downloadPath).toBe("/api/operator/sessions/c1/files/f1");
    expect(rows[0]?.filename).toBe("Excel file");
  });

  it("marks in-progress rows failed when the stream failed", () => {
    const rows = toolTreeRows(
      [part({ state: "input-available", output: undefined })],
      { streamFailed: true },
    );
    expect(rows[0]?.state).toBe("failed");
  });

  it("skips pending approval parts", () => {
    expect(
      toolTreeRows([part({ output: outreach })], { streamFailed: false }),
    ).toEqual([]);
  });

  it("does not dump JSON as summary when message is long", () => {
    const rows = toolTreeRows(
      [part({ output: { message: "x".repeat(201), status: "ok" } })],
      { streamFailed: false },
    );
    expect(rows[0]?.summary).toBe("ok");
  });
});
