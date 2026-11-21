import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceSurface } from "@/lib/rate-limit";
import { findHandoffRequestByToken } from "@/lib/handoff/requests";
import { listVisibleMessagesSince } from "@/app/api/widget/[id]/widget-messages";
import { createHandoffToken } from "@/lib/handoff/token";
import { GET } from "./route";

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn() };
});

vi.mock("@/lib/handoff/requests", () => ({ findHandoffRequestByToken: vi.fn() }));

vi.mock("@/app/api/widget/[id]/widget-messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/widget/[id]/widget-messages")>();
  return { ...actual, findCursor: vi.fn(async () => null), listVisibleMessagesSince: vi.fn() };
});

const { token } = createHandoffToken();
const NOW = new Date();

const request = {
  id: "req-1",
  chatId: "chat-1",
  status: "open",
  mode: "quick_answer",
  reason: "Price",
  confidence: 40,
  questions: [],
  suggestedReplies: [],
  recipientName: "Markus Albrecht",
  answer: null,
  replyMode: null,
  answeredAt: null,
  takenOverAt: null,
  handedBackAt: null,
  handBackReason: null,
  expiresAt: new Date(NOW.getTime() + 60 * 60_000),
  linkClosedAt: null,
  canTakeOver: true,
  createdAt: NOW,
};

function open() {
  const controller = new AbortController();
  const res = GET(
    new Request(`http://localhost/api/h/${token}/events`, {
      headers: { "x-forwarded-for": "203.0.113.7" },
      signal: controller.signal,
    }) as never,
    { params: Promise.resolve({ token }) },
  );
  return { res, controller };
}

async function firstChunk(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let text = "";
  while (!text.includes("event: typing")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
  }
  await reader.cancel();
  return text;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enforceSurface).mockResolvedValue({ ok: true, release: async () => undefined });
  vi.mocked(findHandoffRequestByToken).mockResolvedValue(request as never);
  vi.mocked(listVisibleMessagesSince).mockResolvedValue([
    {
      id: "m-new",
      chatId: "chat-1",
      role: "user",
      content: "Hello?",
      author: null,
      authorDisplayName: null,
      metadata: null,
      createdAt: new Date(NOW.getTime() + 1_000),
    },
  ] as never);
});

describe("GET /api/h/[token]/events", () => {
  it("streams the handoff state, new messages and typing", async () => {
    const { res, controller } = open();
    const response = await res;
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    const text = await firstChunk(response);
    controller.abort();

    expect(text).toContain("event: handoff");
    expect(text).toContain('"canAnswer":true');
    expect(text).toContain("id: m-new\nevent: message");
    expect(text).toContain('"content":"Hello?"');
    expect(text).toContain('event: typing\ndata: {"customer":false}');
    expect(text).not.toContain("tokenHash");
  });

  it("answers 404 for an unknown link", async () => {
    vi.mocked(findHandoffRequestByToken).mockResolvedValue(null);
    expect((await open().res).status).toBe(404);
  });

  it("answers 410 once the link has expired", async () => {
    vi.mocked(findHandoffRequestByToken).mockResolvedValue({
      ...request,
      expiresAt: new Date(NOW.getTime() - 1_000),
    } as never);
    expect((await open().res).status).toBe(410);
  });

  it("is rate limited per IP", async () => {
    vi.mocked(enforceSurface).mockResolvedValue({
      ok: false,
      denial: {
        allowed: false,
        kind: "rate",
        policy: "handoff.link.ip.minute",
        limit: 120,
        windowSec: 60,
        retryAfterSec: 5,
      },
    });
    expect((await open().res).status).toBe(429);
    expect(findHandoffRequestByToken).not.toHaveBeenCalled();
  });
});
