import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { GET, OPTIONS } from "./route";
import {
  findCursor,
  latestHandoff,
  listMissedMessages,
} from "../widget-messages";

vi.mock("../widget-messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../widget-messages")>();
  return {
    ...actual,
    findCursor: vi.fn(),
    listMissedMessages: vi.fn(),
    latestHandoff: vi.fn(),
  };
});

const CHAT_ID = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const LAST_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
const VISITOR = "203.0.113.9";

function get(query: string, ip = VISITOR) {
  return GET(
    new Request(`http://localhost:3000/api/widget/wid-1/messages?${query}`, {
      headers: { "x-forwarded-for": ip },
    }) as never,
    { params: Promise.resolve({ id: "wid-1" }) },
  );
}

const personMessage = {
  id: "8d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
  role: "assistant",
  content: "The XL is 49 EUR.",
  author: "human",
  authorDisplayName: "Markus Albrecht",
  createdAt: "2026-10-03T12:01:00.000Z",
};

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
  vi.mocked(latestHandoff).mockResolvedValue({ status: "taken_over", person: "Markus Albrecht" });
  vi.mocked(listMissedMessages).mockResolvedValue([personMessage] as never);
});

describe("OPTIONS /api/widget/[id]/messages", () => {
  it("allows a cross-origin GET", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("GET /api/widget/[id]/messages", () => {
  it("returns messages missed since the widget's last one, with the handoff state", async () => {
    const cursor = { id: LAST_ID, createdAt: new Date("2026-10-03T12:00:00Z") };
    vi.mocked(findCursor).mockResolvedValue(cursor);

    const res = await get(`chatId=${CHAT_ID}&after=${LAST_ID}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toEqual({
      messages: [personMessage],
      handoff: "taken_over",
      handoffPerson: "Markus Albrecht",
    });
    expect(findCursor).toHaveBeenCalledWith(CHAT_ID, LAST_ID);
    expect(listMissedMessages).toHaveBeenCalledWith(CHAT_ID, cursor);
  });

  it("returns the latest transcript page without a cursor", async () => {
    await get(`chatId=${CHAT_ID}`);
    expect(findCursor).not.toHaveBeenCalled();
    expect(listMissedMessages).toHaveBeenCalledWith(CHAT_ID, null);
  });

  it("does not show another visitor's conversation", async () => {
    const res = await get(`chatId=${CHAT_ID}`, "198.51.100.1");
    expect(res.status).toBe(404);
    expect(listMissedMessages).not.toHaveBeenCalled();
  });

  it("requires a chat id", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
  });
});
