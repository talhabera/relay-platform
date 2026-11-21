import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  initialStreamState,
  isAfter,
  isOutOfBand,
  pollFrom,
  resolveWidgetChat,
  STREAM_OVERLAP_MS,
  takeNewMessages,
  toWidgetMessage,
} from "./widget-messages";

const CHAT_ID = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const T0 = new Date("2026-10-03T12:00:00.000Z");

function row(id: string, at: Date, overrides: Record<string, unknown> = {}) {
  return {
    id,
    chatId: CHAT_ID,
    role: "assistant" as const,
    content: `message ${id}`,
    author: null,
    authorDisplayName: null,
    metadata: null,
    createdAt: at,
    ...overrides,
  };
}

const later = (ms: number) => new Date(T0.getTime() + ms);

describe("isOutOfBand", () => {
  it("is true for a person's message and the worker's handoff messages", () => {
    expect(isOutOfBand(row("a", T0, { author: "human", authorDisplayName: "Markus" }))).toBe(true);
    expect(isOutOfBand(row("b", T0, { metadata: { handoffRequestId: "req-1" } }))).toBe(true);
    expect(isOutOfBand(row("c", T0, { metadata: { handoffExpiredRequestId: "req-1" } }))).toBe(
      true,
    );
  });

  it("is false for the agent's streamed replies and the customer's own messages", () => {
    expect(isOutOfBand(row("d", T0))).toBe(false);
    expect(isOutOfBand(row("e", T0, { author: "agent", metadata: { model: "haiku" } }))).toBe(
      false,
    );
    expect(isOutOfBand(row("f", T0, { role: "user" }))).toBe(false);
  });
});

describe("toWidgetMessage", () => {
  it("carries the person marker only for a person's message", () => {
    expect(
      toWidgetMessage(row("a", T0, { author: "human", authorDisplayName: "Markus Albrecht" })),
    ).toEqual({
      id: "a",
      role: "assistant",
      content: "message a",
      author: "human",
      authorDisplayName: "Markus Albrecht",
      createdAt: T0.toISOString(),
    });
    expect(toWidgetMessage(row("b", T0)).author).toBe("agent");
    expect(toWidgetMessage(row("c", T0, { role: "user" })).author).toBeNull();
  });
});

describe("isAfter", () => {
  it("orders by time, then by id for equal timestamps", () => {
    expect(isAfter({ createdAt: later(1), id: "a" }, { createdAt: T0, id: "z" })).toBe(true);
    expect(isAfter({ createdAt: T0, id: "b" }, { createdAt: T0, id: "a" })).toBe(true);
    expect(isAfter({ createdAt: T0, id: "a" }, { createdAt: T0, id: "a" })).toBe(false);
  });
});

describe("stream state", () => {
  it("emits only out-of-band messages after the cursor, once each", () => {
    const cursor = { createdAt: T0, id: "m1" };
    const state = initialStreamState(cursor, later(10_000));
    expect(pollFrom(state)).toEqual(new Date(T0.getTime() - STREAM_OVERLAP_MS));

    const human = row("m3", later(2_000), { author: "human", authorDisplayName: "Markus" });
    const first = takeNewMessages(
      state,
      [
        row("m0", later(-1_000), { author: "human", authorDisplayName: "Markus" }),
        row("m1", T0),
        row("m2", later(1_000)),
        human,
      ],
      cursor,
    );
    expect(first.map((m) => m.id)).toEqual(["m3"]);
    expect(state.highWater).toEqual(later(2_000));

    // The overlap re-reads m3; it is not sent again. A late follow-up is.
    const second = takeNewMessages(state, [
      human,
      row("m4", later(3_000), { metadata: { handoffRequestId: "req-1" } }),
    ]);
    expect(second.map((m) => m.id)).toEqual(["m4"]);
  });

  it("without a cursor treats everything that exists now as delivered", () => {
    const now = later(5_000);
    const state = initialStreamState(null, now);
    const baseline = { createdAt: now, id: "￿" };
    const emitted = takeNewMessages(
      state,
      [
        row("old", later(4_000), { author: "human", authorDisplayName: "Markus" }),
        row("new", later(6_000), { author: "human", authorDisplayName: "Markus" }),
      ],
      baseline,
    );
    expect(emitted.map((m) => m.id)).toEqual(["new"]);
  });
});

describe("resolveWidgetChat", () => {
  const company = { id: "company-1", widgetId: "wid-1" };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
  });

  it("accepts this visitor's widget chat with this company", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: CHAT_ID,
      companyId: "company-1",
      channelType: "widget",
      visitorId: "203.0.113.9",
    } as never);

    expect(await resolveWidgetChat("wid-1", CHAT_ID, "203.0.113.9")).toEqual({
      ok: true,
      companyId: "company-1",
      chatId: CHAT_ID,
    });
  });

  it.each([
    ["another visitor", { visitorId: "198.51.100.1" }],
    ["a WhatsApp chat", { channelType: "whatsapp" }],
    ["another company", { companyId: "company-2" }],
  ])("refuses %s", async (_label, overrides) => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: CHAT_ID,
      companyId: "company-1",
      channelType: "widget",
      visitorId: "203.0.113.9",
      ...overrides,
    } as never);

    const result = await resolveWidgetChat("wid-1", CHAT_ID, "203.0.113.9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });

  it("rejects a missing or malformed chat id before any query", async () => {
    const result = await resolveWidgetChat("wid-1", "chat-1", "203.0.113.9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
    expect(db.query.companies.findFirst).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown widget", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);
    const result = await resolveWidgetChat("nope", CHAT_ID, "203.0.113.9");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(404);
  });
});
