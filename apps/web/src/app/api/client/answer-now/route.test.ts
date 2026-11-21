import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireClientAccess } from "@/lib/operator/access";
import { answerNowAsCompanyUser } from "@/lib/handoff/requests";
import { enforceSurface } from "@/lib/rate-limit";
import { POST } from "./route";

vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/handoff/requests", () => ({ answerNowAsCompanyUser: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, enforceSurface: vi.fn() };
});

const COMPANY = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";
const CHAT = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/client/answer-now", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientAccess).mockResolvedValue({
    session: { user: { id: "user-1", name: "Lena Vogel" } },
  } as never);
  vi.mocked(enforceSurface).mockResolvedValue({ ok: true, release: async () => undefined });
});

describe("POST /api/client/answer-now", () => {
  it("takes the chat over as the client user and returns the link once", async () => {
    vi.mocked(answerNowAsCompanyUser).mockResolvedValue({
      ok: true,
      token: "tok",
      request: { id: "req-1" } as never,
    });
    const res = await post({ companyId: COMPANY, chatId: CHAT });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: "tok", url: "/h/tok", requestId: "req-1" });
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY, { mutation: true });
    expect(answerNowAsCompanyUser).toHaveBeenCalledWith({
      companyId: COMPANY,
      chatId: CHAT,
      authorName: "Lena Vogel",
    });
    expect(enforceSurface).toHaveBeenCalledWith({
      rate: [{ policy: "handoff.answer_now.user.minute", subject: "user-1" }],
      leases: [],
    });
  });

  it("is for client users only (preview is read-only)", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("read-only"));
    const res = await post({ companyId: COMPANY, chatId: CHAT });
    expect(res.status).toBe(403);
    expect(answerNowAsCompanyUser).not.toHaveBeenCalled();
  });

  it("answers 409 while someone else holds a takeover", async () => {
    vi.mocked(answerNowAsCompanyUser).mockResolvedValue({ ok: false, error: "conflict" });
    expect((await post({ companyId: COMPANY, chatId: CHAT })).status).toBe(409);
  });

  it("rejects a malformed body", async () => {
    expect((await post({ companyId: "x", chatId: CHAT })).status).toBe(400);
    expect(requireClientAccess).not.toHaveBeenCalled();
  });

  it("is rate limited per user", async () => {
    vi.mocked(enforceSurface).mockResolvedValue({
      ok: false,
      denial: {
        allowed: false,
        kind: "rate",
        policy: "handoff.answer_now.user.minute",
        limit: 10,
        windowSec: 60,
        retryAfterSec: 20,
      },
    });
    expect((await post({ companyId: COMPANY, chatId: CHAT })).status).toBe(429);
    expect(answerNowAsCompanyUser).not.toHaveBeenCalled();
  });
});
