import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { collectColumnNames } from "@/test-utils/column-names";
import {
  answerableWhere,
  answerHandoffRequest,
  answerNowAsCompanyUser,
  dueForExpiryWhere,
  idleTakeoverWhere,
  openOrAppendHandoffRequest,
  sendTakeoverMessage,
  takenOverWhere,
  takeOverableWhere,
  takeOverHandoffRequest,
} from "./requests";
import { emitHandoffSent } from "./portal";
import { getAgentHandoffSettings, defaultHandoffSettings } from "./settings";
import { createHandoffToken, hashHandoffToken } from "./token";
import {
  deliverHumanMessageOnWorker,
  requestHandoffFollowUpOnWorker,
} from "@/lib/worker-proxy";

vi.mock("@/lib/worker-proxy", () => ({
  deliverHumanMessageOnWorker: vi.fn(async () => true),
  requestHandoffFollowUpOnWorker: vi.fn(async () => true),
}));

vi.mock("./portal", () => ({ emitHandoffSent: vi.fn(async () => undefined) }));

vi.mock("./settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./settings")>();
  return { ...actual, getAgentHandoffSettings: vi.fn() };
});

const AGENT = { id: "agent-1", companyId: "company-1" };
const NOW = new Date("2026-10-02T12:00:00Z");
const ASK = {
  reason: "Price is not in the price list",
  confidence: 40,
  question: "How much is the XL?",
  suggestedReplies: ["49 €"],
};

// A chain mock: every builder call records its argument and returns the
// chain; `returning` resolves to whatever the test queued next.
function chain() {
  const calls: Record<string, unknown[][]> = {};
  const results: unknown[][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of [
    "update",
    "insert",
    "select",
    "from",
    "set",
    "values",
    "where",
    "limit",
    "orderBy",
    "onConflictDoNothing",
  ]) {
    builder[name] = vi.fn((...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      if (name === "limit") return Promise.resolve(results.shift() ?? []);
      return builder;
    });
  }
  builder.returning = vi.fn(() => Promise.resolve(results.shift() ?? []));
  builder.then = undefined;
  return { builder, calls, results };
}

let mock: ReturnType<typeof chain>;

beforeEach(() => {
  vi.clearAllMocks();
  mock = chain();
  Object.assign(db as object, {
    update: mock.builder.update,
    insert: (...args: unknown[]) => {
      (mock.calls.insertTable ??= []).push(args);
      return mock.builder;
    },
    select: mock.builder.select,
    transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        execute: vi.fn(async () => []),
        select: mock.builder.select,
        update: mock.builder.update,
        insert: (...args: unknown[]) => {
          (mock.calls.insertTable ??= []).push(args);
          return mock.builder;
        },
      }),
  });
});

describe("guards", () => {
  const hash = "h";

  it("answers only an open, unexpired, unclosed request", () => {
    expect(collectColumnNames(answerableWhere(hash, NOW))).toEqual(
      expect.arrayContaining(["token_hash", "status", "expires_at", "link_closed_at"]),
    );
  });

  it("takes over only when allowed, before expiry and Done", () => {
    expect(collectColumnNames(takeOverableWhere(hash, NOW))).toEqual(
      expect.arrayContaining([
        "token_hash",
        "status",
        "can_take_over",
        "expires_at",
        "link_closed_at",
      ]),
    );
  });

  it("hands back only a takeover, by token", () => {
    expect(collectColumnNames(takenOverWhere(hash))).toEqual(
      expect.arrayContaining(["token_hash", "status"]),
    );
  });

  it("sweeps by status and deadline", () => {
    expect(collectColumnNames(dueForExpiryWhere(NOW))).toEqual(
      expect.arrayContaining(["status", "expires_at"]),
    );
    expect(collectColumnNames(idleTakeoverWhere(NOW))).toEqual(
      expect.arrayContaining(["status", "last_human_message_at"]),
    );
  });
});

describe("openOrAppendHandoffRequest", () => {
  it("appends to the open request and opens nothing new", async () => {
    mock.results.push([{ id: "req-1" }]);
    const result = await openOrAppendHandoffRequest(AGENT, "chat-1", ASK, NOW);

    expect(result).toEqual({ kind: "appended", request: { id: "req-1" } });
    expect(mock.calls.insertTable).toBeUndefined();
    expect(collectColumnNames(mock.calls.where[0][0])).toEqual(
      expect.arrayContaining(["chat_id", "company_id", "status"]),
    );
  });

  it("opens a request with a hashed token and the agent's expiry", async () => {
    vi.mocked(getAgentHandoffSettings).mockResolvedValue({
      ...defaultHandoffSettings(AGENT),
      recipientName: "Markus Albrecht",
      recipientWhatsapp: "+4915123456789",
      recipientConfirmed: true,
      expiryMinutes: 30,
      recipientCanTakeOver: true,
    });
    mock.results.push([], [{ id: "req-2" }]);

    const result = await openOrAppendHandoffRequest(AGENT, "chat-1", ASK, NOW);
    if (result.kind !== "opened") throw new Error("expected opened");
    const values = mock.calls.values[0][0] as Record<string, unknown>;

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(values.tokenHash).toBe(hashHandoffToken(result.token!));
    expect(values).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      chatId: "chat-1",
      mode: "quick_answer",
      recipientName: "Markus Albrecht",
      canTakeOver: true,
      expiresAt: new Date("2026-10-02T12:30:00Z"),
      questions: [{ text: ASK.question, askedAt: NOW.toISOString() }],
    });
  });

  it("routes to the Inbox while the recipient is unconfirmed", async () => {
    vi.mocked(getAgentHandoffSettings).mockResolvedValue({
      ...defaultHandoffSettings(AGENT),
      recipientName: "Markus Albrecht",
      recipientWhatsapp: "+4915123456789",
      recipientConfirmed: false,
    });
    mock.results.push([], [{ id: "req-3" }]);

    await openOrAppendHandoffRequest(AGENT, "chat-1", ASK, NOW);
    expect(mock.calls.values[0][0]).toMatchObject({
      recipientName: null,
      recipientWhatsapp: null,
      canTakeOver: false,
    });
  });

  it("appends to the winner when a concurrent open wins the race", async () => {
    vi.mocked(getAgentHandoffSettings).mockResolvedValue(
      defaultHandoffSettings(AGENT),
    );
    mock.results.push([], [], [{ id: "winner" }]);

    const result = await openOrAppendHandoffRequest(AGENT, "chat-1", ASK, NOW);
    expect(result).toEqual({ kind: "appended", request: { id: "winner" } });
  });

  it("opens Team chat requests without a quick link", async () => {
    vi.mocked(getAgentHandoffSettings).mockResolvedValue({
      ...defaultHandoffSettings(AGENT),
      mode: "team_chat",
    });
    mock.results.push([], [{ id: "req-4" }]);

    const result = await openOrAppendHandoffRequest(AGENT, "chat-1", ASK, NOW);
    expect(result).toMatchObject({ kind: "opened", token: null });
    expect(mock.calls.values[0][0]).toMatchObject({ tokenHash: null });
  });
});

describe("answerHandoffRequest", () => {
  const { token } = createHandoffToken();
  const answered = {
    id: "req-1",
    chatId: "chat-1",
    recipientName: "Markus Albrecht",
  };

  it("stores a verbatim answer as a human message", async () => {
    mock.results.push([answered]);
    const result = await answerHandoffRequest(
      token,
      { text: "49 €", replyMode: "person" },
      NOW,
    );

    const values = mock.calls.values[0][0] as Record<string, unknown>;
    expect(values).toMatchObject({
      chatId: "chat-1",
      content: "49 €",
      role: "assistant",
      author: "human",
      authorDisplayName: "Markus Albrecht",
    });
    expect(values.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toEqual({ ok: true, request: answered, messageId: values.id });
  });

  it("asks the worker to deliver the stored answer on the customer's channel", async () => {
    mock.results.push([answered]);
    await answerHandoffRequest(token, { text: "49 €", replyMode: "person" }, NOW);
    const values = mock.calls.values[0][0] as Record<string, unknown>;
    expect(deliverHumanMessageOnWorker).toHaveBeenCalledExactlyOnceWith(values.id);
  });

  it("leaves the wording to the agent when it phrases the reply", async () => {
    mock.results.push([answered]);
    const result = await answerHandoffRequest(
      token,
      { text: "49 €", replyMode: "agent" },
      NOW,
    );
    expect(mock.calls.values).toBeUndefined();
    expect(result).toEqual({ ok: true, request: answered });
    expect(deliverHumanMessageOnWorker).not.toHaveBeenCalled();
    expect(requestHandoffFollowUpOnWorker).toHaveBeenCalledExactlyOnceWith("req-1");
  });

  it("reports the handoff to the Live feed in the answer's transaction", async () => {
    mock.results.push([answered]);
    await answerHandoffRequest(token, { text: "49 €", replyMode: "person" }, NOW);
    expect(emitHandoffSent).toHaveBeenCalledExactlyOnceWith(expect.anything(), answered, NOW);
    expect(requestHandoffFollowUpOnWorker).not.toHaveBeenCalled();
  });

  it("refuses a second answer as a conflict", async () => {
    mock.results.push([], [{ id: "req-1", status: "answered" }]);
    const result = await answerHandoffRequest(
      token,
      { text: "again", replyMode: "person" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(deliverHumanMessageOnWorker).not.toHaveBeenCalled();
    expect(requestHandoffFollowUpOnWorker).not.toHaveBeenCalled();
    expect(emitHandoffSent).not.toHaveBeenCalled();
  });

  it("rejects a malformed token without touching the database", async () => {
    const result = await answerHandoffRequest(
      "nope",
      { text: "x", replyMode: "person" },
      NOW,
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(mock.builder.update).not.toHaveBeenCalled();
  });
});

describe("sendTakeoverMessage", () => {
  const { token } = createHandoffToken();
  const takenOver = { id: "req-1", chatId: "chat-1", recipientName: "Markus Albrecht" };

  it("stores the live message and asks the worker to deliver it", async () => {
    mock.results.push([takenOver]);
    const result = await sendTakeoverMessage(token, "I'm here, Tobias.", NOW);

    const values = mock.calls.values[0][0] as Record<string, unknown>;
    expect(values).toMatchObject({ content: "I'm here, Tobias.", author: "human" });
    expect(result).toEqual({ ok: true, request: takenOver, messageId: values.id });
    expect(deliverHumanMessageOnWorker).toHaveBeenCalledExactlyOnceWith(values.id);
  });

  it("stores and delivers nothing once the takeover has ended", async () => {
    mock.results.push([], [{ id: "req-1", status: "handed_back" }]);
    const result = await sendTakeoverMessage(token, "late", NOW);

    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(mock.calls.values).toBeUndefined();
    expect(deliverHumanMessageOnWorker).not.toHaveBeenCalled();
  });
});

describe("takeOverHandoffRequest", () => {
  const { token } = createHandoffToken();

  it("reports a takeover straight from an open request", async () => {
    const row = { id: "req-1", chatId: "chat-1", answeredAt: null };
    mock.results.push([row]);
    const result = await takeOverHandoffRequest(token, NOW);
    expect(result).toEqual({ ok: true, request: row });
    expect(emitHandoffSent).toHaveBeenCalledExactlyOnceWith(expect.anything(), row, NOW);
  });

  it("does not report a takeover after an answer twice", async () => {
    mock.results.push([{ id: "req-1", chatId: "chat-1", answeredAt: NOW }]);
    await takeOverHandoffRequest(token, NOW);
    expect(emitHandoffSent).not.toHaveBeenCalled();
  });

  it("refuses a takeover the link does not allow", async () => {
    mock.results.push([], [{ id: "req-1", status: "expired" }]);
    const result = await takeOverHandoffRequest(token, NOW);
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(emitHandoffSent).not.toHaveBeenCalled();
  });
});

describe("answerNowAsCompanyUser", () => {
  const input = { companyId: "company-1", chatId: "chat-1", authorName: "Lena Vogel" };
  const chat = { id: "chat-1", agentId: "agent-1" };

  it("takes over the open request under the user's name with a fresh link", async () => {
    const row = { id: "req-1", chatId: "chat-1", answeredAt: null };
    mock.results.push([chat], [{ id: "req-1", status: "open" }], [row]);

    const result = await answerNowAsCompanyUser(input, NOW);
    if (!result.ok) throw new Error("expected ok");

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(mock.calls.set[0][0]).toMatchObject({
      status: "taken_over",
      tokenHash: hashHandoffToken(result.token),
      recipientName: "Lena Vogel",
      canTakeOver: true,
      takenOverAt: NOW,
      lastHumanMessageAt: NOW,
    });
    expect(emitHandoffSent).toHaveBeenCalledExactlyOnceWith(expect.anything(), row, NOW);
  });

  it("creates a takeover request when the chat has none open", async () => {
    vi.mocked(getAgentHandoffSettings).mockResolvedValue({
      ...defaultHandoffSettings(AGENT),
      expiryMinutes: 60,
    });
    const row = { id: "req-9", chatId: "chat-1", answeredAt: null };
    mock.results.push([chat], [], [row]);

    const result = await answerNowAsCompanyUser(input, NOW);
    if (!result.ok) throw new Error("expected ok");

    expect(mock.calls.values[0][0]).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      chatId: "chat-1",
      mode: "takeover",
      status: "taken_over",
      tokenHash: hashHandoffToken(result.token),
      recipientName: "Lena Vogel",
      questions: [],
      expiresAt: new Date("2026-10-02T13:00:00Z"),
    });
    expect(emitHandoffSent).toHaveBeenCalledOnce();
  });

  it("refuses while someone else has taken the chat over", async () => {
    mock.results.push([chat], [{ id: "req-1", status: "taken_over" }]);
    const result = await answerNowAsCompanyUser(input, NOW);
    expect(result).toEqual({ ok: false, error: "conflict" });
    expect(mock.builder.update).not.toHaveBeenCalled();
    expect(mock.calls.insertTable).toBeUndefined();
  });

  it("refuses a chat outside the company or an internal chat", async () => {
    mock.results.push([]);
    const result = await answerNowAsCompanyUser(input, NOW);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(collectColumnNames(mock.calls.where[0][0])).toEqual(
      expect.arrayContaining(["id", "company_id", "channel_type"]),
    );
  });
});
