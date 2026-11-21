import { beforeEach, describe, expect, it, vi } from "vitest";

const { openOrAppendHandoffRequest } = vi.hoisted(() => ({
  openOrAppendHandoffRequest: vi.fn(),
}));

vi.mock("./store", () => ({
  openOrAppendHandoffRequest: (...args: unknown[]) => openOrAppendHandoffRequest(...args),
}));

import { askHumanInputSchema, makeAskHumanTool } from "./ask-human-tool";

const CONTEXT = { toolCallId: "call-1", messages: [] };
const ASK = {
  reason: "Customer asks for a price not in the list",
  confidence: 30,
  question: "Can we do 140 m2 for 300k?",
  suggestedReplies: ["Yes", "No, 350k minimum"],
};

const notify = vi.fn();

function build(chatId: string | null = "chat-1") {
  return makeAskHumanTool({
    agentId: "agent-1",
    companyId: "company-1",
    getChatId: () => chatId,
    waitingText: "Asking a colleague at Acme…",
    notify,
  });
}

function run(tool: ReturnType<typeof build>, input: Record<string, unknown>) {
  return tool.execute!(input as never, CONTEXT as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  notify.mockResolvedValue(undefined);
  openOrAppendHandoffRequest.mockResolvedValue({
    kind: "opened",
    request: { id: "req-1" },
    token: "raw-token",
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("ask_human input schema", () => {
  it("has no tenant ids for the model to fill in", () => {
    expect(Object.keys(askHumanInputSchema.shape).sort()).toEqual(
      ["confidence", "question", "reason", "suggestedReplies"].sort(),
    );
  });

  it.each([-1, 101, 50.5])("rejects confidence %s", (confidence) => {
    expect(askHumanInputSchema.safeParse({ ...ASK, confidence }).success).toBe(false);
  });

  it("caps suggested replies at 5", () => {
    expect(
      askHumanInputSchema.safeParse({ ...ASK, suggestedReplies: ["a", "b", "c", "d", "e", "f"] })
        .success,
    ).toBe(false);
  });
});

describe("ask_human execute", () => {
  it("opens a request on the runtime's chat, not one the model names", async () => {
    await run(build("chat-1"), { ...ASK, chatId: "someone-elses-chat" });

    expect(openOrAppendHandoffRequest).toHaveBeenCalledWith(
      { id: "agent-1", companyId: "company-1" },
      "chat-1",
      ASK,
    );
  });

  it("notifies once when the request opens", async () => {
    const result = await run(build(), ASK);

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({ request: { id: "req-1" }, token: "raw-token" });
    expect(result).toMatchObject({ success: true, status: "asked" });
  });

  it("appends a later question without a second notification", async () => {
    openOrAppendHandoffRequest.mockResolvedValue({ kind: "appended", request: { id: "req-1" } });

    const result = await run(build(), ASK);

    expect(notify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, status: "added_to_open_request" });
  });

  it("tells the agent what the customer sees while waiting, never the token", async () => {
    const result = await run(build(), ASK);

    expect(result).toMatchObject({ tellCustomer: "Asking a colleague at Acme…" });
    expect(JSON.stringify(result)).not.toContain("raw-token");
  });

  it("defaults a missing confidence and suggested replies", async () => {
    await run(build(), { reason: "Asks for a person", question: "Can someone call me?" });

    expect(openOrAppendHandoffRequest.mock.calls[0][2]).toEqual({
      reason: "Asks for a person",
      confidence: null,
      question: "Can someone call me?",
      suggestedReplies: [],
    });
  });

  it("fails softly before the conversation exists", async () => {
    const result = await run(build(null), ASK);

    expect(openOrAppendHandoffRequest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });

  it("keeps the request when the notification fails", async () => {
    notify.mockRejectedValue(new Error("WhatsApp down"));

    const result = await run(build(), ASK);

    expect(result).toMatchObject({ success: true, status: "asked" });
  });

  it("fails softly when the request cannot be stored", async () => {
    openOrAppendHandoffRequest.mockRejectedValue(new Error("db down"));

    const result = await run(build(), ASK);

    expect(result).toMatchObject({ success: false });
  });
});
