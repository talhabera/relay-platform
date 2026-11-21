import { beforeEach, describe, expect, it, vi } from "vitest";
import { enforceSurface } from "@/lib/rate-limit";
import {
  answerHandoffRequest,
  closeHandoffLink,
  findHandoffRequestByToken,
  handBackHandoffRequest,
  sendTakeoverMessage,
  takeOverHandoffRequest,
} from "@/lib/handoff/requests";
import { createHandoffToken, hashHandoffToken } from "@/lib/handoff/token";
import { isTyping } from "@/lib/handoff/typing";
import { GET, POST } from "./route";
import { loadQuickLinkView } from "./quick-link";

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn() };
});

vi.mock("@/lib/handoff/requests", () => ({
  answerHandoffRequest: vi.fn(),
  closeHandoffLink: vi.fn(),
  findHandoffRequestByToken: vi.fn(),
  handBackHandoffRequest: vi.fn(),
  sendTakeoverMessage: vi.fn(),
  takeOverHandoffRequest: vi.fn(),
}));

vi.mock("./quick-link", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./quick-link")>();
  return { ...actual, loadQuickLinkView: vi.fn(async () => ({ view: true })) };
});

const { token } = createHandoffToken();
const IP = "203.0.113.7";
const FUTURE = new Date(Date.now() + 60 * 60_000);
const PAST = new Date(Date.now() - 60_000);

const openRequest = {
  id: "req-1",
  chatId: "chat-1",
  status: "open",
  expiresAt: FUTURE,
  linkClosedAt: null,
  canTakeOver: true,
};

function ctx(t = token) {
  return { params: Promise.resolve({ token: t }) };
}

function get(t = token) {
  return GET(
    new Request(`http://localhost/api/h/${t}`, { headers: { "x-forwarded-for": IP } }) as never,
    ctx(t),
  );
}

function post(body: unknown, t = token) {
  return POST(
    new Request(`http://localhost/api/h/${t}`, {
      method: "POST",
      headers: { "x-forwarded-for": IP, "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    ctx(t),
  );
}

const release = vi.fn(async () => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enforceSurface).mockResolvedValue({ ok: true, release });
  vi.mocked(findHandoffRequestByToken).mockResolvedValue(openRequest as never);
});

describe("GET /api/h/[token]", () => {
  it("opens the link without changing anything, uncached and unreferred", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(loadQuickLinkView).toHaveBeenCalledWith(openRequest);
    for (const write of [answerHandoffRequest, takeOverHandoffRequest, closeHandoffLink]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it("answers 404 for an unknown or malformed token", async () => {
    vi.mocked(findHandoffRequestByToken).mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await get("nope")).status).toBe(404);
  });

  it("counts reads against the caller's IP only", async () => {
    await get();
    expect(enforceSurface).toHaveBeenCalledWith({
      rate: [{ policy: "handoff.link.ip.minute", subject: IP }],
      leases: [],
    });
    expect(release).toHaveBeenCalled();
  });

  it("refuses with 429 over the limit, before looking the token up", async () => {
    vi.mocked(enforceSurface).mockResolvedValue({
      ok: false,
      denial: {
        allowed: false,
        kind: "rate",
        policy: "handoff.link.ip.minute",
        limit: 120,
        windowSec: 60,
        retryAfterSec: 12,
      },
    });
    const res = await get();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(findHandoffRequestByToken).not.toHaveBeenCalled();
  });
});

describe("POST /api/h/[token]", () => {
  it("answers once and counts the write against the link", async () => {
    vi.mocked(answerHandoffRequest).mockResolvedValue({
      ok: true,
      request: openRequest as never,
      messageId: "msg-1",
    });
    const res = await post({ action: "answer", text: "49 €", replyMode: "person" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: true, messageId: "msg-1" });
    expect(answerHandoffRequest).toHaveBeenCalledWith(token, { text: "49 €", replyMode: "person" });
    expect(enforceSurface).toHaveBeenCalledWith({
      rate: [
        { policy: "handoff.link.ip.minute", subject: IP },
        { policy: "handoff.link.write.minute", subject: hashHandoffToken(token) },
      ],
      leases: [],
    });
  });

  it("refuses a reused link (second answer) with 409", async () => {
    vi.mocked(answerHandoffRequest).mockResolvedValue({ ok: false, error: "conflict" });
    const res = await post({ action: "answer", text: "again", replyMode: "agent" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict" });
  });

  it("refuses an expired link with 409 and an unknown one with 404", async () => {
    vi.mocked(takeOverHandoffRequest).mockResolvedValue({ ok: false, error: "conflict" });
    expect((await post({ action: "take_over" })).status).toBe(409);
    vi.mocked(takeOverHandoffRequest).mockResolvedValue({ ok: false, error: "not_found" });
    expect((await post({ action: "take_over" })).status).toBe(404);
  });

  it("routes takeover messages, hand-back and Done", async () => {
    const ok = { ok: true as const, request: openRequest as never };
    vi.mocked(sendTakeoverMessage).mockResolvedValue(ok);
    vi.mocked(handBackHandoffRequest).mockResolvedValue(ok);
    vi.mocked(closeHandoffLink).mockResolvedValue(ok);

    await post({ action: "message", text: "I'm here." });
    await post({ action: "hand_back" });
    await post({ action: "done" });

    expect(sendTakeoverMessage).toHaveBeenCalledWith(token, "I'm here.");
    expect(handBackHandoffRequest).toHaveBeenCalledWith(token);
    expect(closeHandoffLink).toHaveBeenCalledWith(token);
  });

  it("rejects an invalid body with 400 and touches nothing", async () => {
    const res = await post({ action: "answer", text: "", replyMode: "person" });
    expect(res.status).toBe(400);
    expect(answerHandoffRequest).not.toHaveBeenCalled();
  });

  it("rejects a malformed token with 404", async () => {
    const res = await post({ action: "take_over" }, "nope");
    expect(res.status).toBe(404);
    expect(takeOverHandoffRequest).not.toHaveBeenCalled();
  });

  it("refuses writes over the limit with 429", async () => {
    vi.mocked(enforceSurface).mockResolvedValue({
      ok: false,
      denial: {
        allowed: false,
        kind: "rate",
        policy: "handoff.link.write.minute",
        limit: 30,
        windowSec: 60,
        retryAfterSec: 30,
      },
    });
    const res = await post({ action: "answer", text: "49 €", replyMode: "person" });
    expect(res.status).toBe(429);
    expect(answerHandoffRequest).not.toHaveBeenCalled();
  });

  describe("typing", () => {
    it("marks the person as typing during a takeover", async () => {
      vi.mocked(findHandoffRequestByToken).mockResolvedValue({
        ...openRequest,
        chatId: "chat-typing",
        status: "taken_over",
      } as never);
      const res = await post({ action: "typing" });
      expect(res.status).toBe(204);
      expect(isTyping("chat-typing", "person")).toBe(true);
      // Typing never uses up the link's write budget.
      expect(enforceSurface).toHaveBeenCalledWith({
        rate: [{ policy: "handoff.link.ip.minute", subject: IP }],
        leases: [],
      });
    });

    it("refuses typing when the link holds no takeover", async () => {
      const res = await post({ action: "typing" });
      expect(res.status).toBe(409);
    });

    it("refuses typing on an expired takeover-less link", async () => {
      vi.mocked(findHandoffRequestByToken).mockResolvedValue({
        ...openRequest,
        expiresAt: PAST,
      } as never);
      expect((await post({ action: "typing" })).status).toBe(409);
    });
  });
});
