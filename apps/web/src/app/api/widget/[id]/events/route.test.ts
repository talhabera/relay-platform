import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { clearTyping, markTyping } from "@/lib/handoff/typing";
import { GET } from "./route";
import {
  findCursor,
  latestHandoff,
  listVisibleMessagesSince,
} from "../widget-messages";

vi.mock("../widget-messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../widget-messages")>();
  return {
    ...actual,
    findCursor: vi.fn(),
    listVisibleMessagesSince: vi.fn(),
    latestHandoff: vi.fn(),
  };
});

const CHAT_ID = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const LAST_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const PERSON_ID = "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a";
const VISITOR = "203.0.113.9";
const T0 = new Date("2026-10-03T12:00:00.000Z");

function row(id: string, at: Date, overrides: Record<string, unknown> = {}) {
  return {
    id,
    chatId: CHAT_ID,
    role: "assistant",
    content: `message ${id}`,
    author: null,
    authorDisplayName: null,
    metadata: null,
    createdAt: at,
    ...overrides,
  };
}

async function readUntil(res: Response, done: (text: string) => boolean): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!done(text)) {
    const { value, done: end } = await reader.read();
    if (end) break;
    text += decoder.decode(value);
  }
  await reader.cancel();
  return text;
}

function open(query: string, headers: Record<string, string> = {}) {
  const abort = new AbortController();
  const request = new Request(`http://localhost:3000/api/widget/wid-1/events?${query}`, {
    headers: { "x-forwarded-for": VISITOR, ...headers },
    signal: abort.signal,
  });
  return {
    abort,
    response: GET(request as never, { params: Promise.resolve({ id: "wid-1" }) }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.query.companies.findFirst).mockResolvedValue({
    id: "company-1",
    widgetId: "wid-1",
  } as never);
  vi.mocked(db.query.chats.findFirst).mockResolvedValue({
    id: CHAT_ID,
    companyId: "company-1",
    channelType: "widget",
    visitorId: VISITOR,
  } as never);
  vi.mocked(findCursor).mockResolvedValue({ id: LAST_ID, createdAt: T0 });
  vi.mocked(latestHandoff).mockResolvedValue({ status: "taken_over", person: "Markus Albrecht" });
  clearTyping(CHAT_ID, "person");
});

describe("GET /api/widget/[id]/events", () => {
  it("streams a person's message and the handoff state as server-sent events", async () => {
    vi.mocked(listVisibleMessagesSince).mockResolvedValue([
      row(LAST_ID, T0),
      row("9e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b", new Date(T0.getTime() + 500)),
      row(PERSON_ID, new Date(T0.getTime() + 1_000), {
        author: "human",
        authorDisplayName: "Markus Albrecht",
        content: "Hi, Markus here.",
      }),
    ] as never);

    const { abort, response } = open(`chatId=${CHAT_ID}&after=${LAST_ID}`);
    const res = await response;
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const text = await readUntil(res, (t) => t.includes("event: handoff"));
    abort.abort();

    expect(text).toContain("retry: 3000");
    expect(text).toContain(`id: ${PERSON_ID}\nevent: message\n`);
    expect(text).toContain('"authorDisplayName":"Markus Albrecht"');
    expect(text).toContain('"content":"Hi, Markus here."');
    // The agent's own streamed reply and the cursor row are not repeated.
    expect(text.match(/event: message/g)).toHaveLength(1);
    expect(text).toContain(
      'event: handoff\ndata: {"status":"taken_over","person":"Markus Albrecht"}',
    );
  });

  it("tells the widget when the person who took over is typing", async () => {
    vi.mocked(listVisibleMessagesSince).mockResolvedValue([] as never);
    markTyping(CHAT_ID, "person");
    const { abort, response } = open(`chatId=${CHAT_ID}`);
    const text = await readUntil(await response, (t) => t.includes("event: typing"));
    abort.abort();
    expect(text).toContain('event: typing\ndata: {"person":true}');
  });

  it("resumes from Last-Event-ID on reconnect", async () => {
    vi.mocked(listVisibleMessagesSince).mockResolvedValue([] as never);
    const { abort, response } = open(`chatId=${CHAT_ID}&after=ignored`, {
      "Last-Event-ID": LAST_ID,
    });
    const res = await response;
    await readUntil(res, (t) => t.includes("event: handoff"));
    abort.abort();

    expect(findCursor).toHaveBeenCalledWith(CHAT_ID, LAST_ID);
    expect(vi.mocked(listVisibleMessagesSince).mock.calls[0]![1]).toEqual(
      new Date(T0.getTime() - 5_000),
    );
  });

  it("refuses another visitor's conversation without opening a stream", async () => {
    const { response } = open(`chatId=${CHAT_ID}`, { "x-forwarded-for": "198.51.100.1" });
    const res = await response;
    expect(res.status).toBe(404);
    expect(listVisibleMessagesSince).not.toHaveBeenCalled();
  });
});
