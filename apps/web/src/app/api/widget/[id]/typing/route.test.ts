import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { clearTyping, isTyping } from "@/lib/handoff/typing";
import { OPTIONS, POST } from "./route";
import { latestHandoff } from "../widget-messages";

vi.mock("../widget-messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../widget-messages")>();
  return { ...actual, latestHandoff: vi.fn() };
});

const CHAT_ID = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const VISITOR = "203.0.113.9";

function post(body: unknown, ip = VISITOR) {
  return POST(
    new Request("http://localhost:3000/api/widget/wid-1/typing", {
      method: "POST",
      headers: { "x-forwarded-for": ip, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: "wid-1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearTyping(CHAT_ID, "customer");
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
});

describe("POST /api/widget/[id]/typing", () => {
  it("allows a cross-origin POST", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("marks the customer as typing during a takeover", async () => {
    const res = await post({ chatId: CHAT_ID });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(isTyping(CHAT_ID, "customer")).toBe(true);
  });

  it("refuses when nobody has taken the conversation over", async () => {
    vi.mocked(latestHandoff).mockResolvedValue({ status: "open", person: null });
    const res = await post({ chatId: CHAT_ID });
    expect(res.status).toBe(409);
    expect(isTyping(CHAT_ID, "customer")).toBe(false);
  });

  it("refuses another visitor's conversation and a missing chatId", async () => {
    expect((await post({ chatId: CHAT_ID }, "198.51.100.1")).status).toBe(404);
    expect((await post({})).status).toBe(400);
    expect(isTyping(CHAT_ID, "customer")).toBe(false);
  });
});
