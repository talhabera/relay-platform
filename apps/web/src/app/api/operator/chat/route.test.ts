import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { getSession, requireSession } from "@/lib/auth-server";
import { db } from "@/db";
import { checkTokenBudget } from "@/lib/ai/token-limiter";
import { proxyToWorker } from "@/lib/worker-proxy";
import { DEFAULT_PAGE_PERMISSIONS } from "@/db/schema";

vi.mock("@/lib/worker-proxy", () => ({
  proxyToWorker: vi.fn(() => Promise.resolve(new Response("stream", { status: 200 }))),
}));

const mockSession = {
  user: { id: "user-1", name: "Starter", email: "starter@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const mockCompany = {
  id: "company-1",
  name: "Test Co",
  industry: "tech",
  description: "A test company",
  widgetId: "widget-1",
  ownerId: "owner-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOperatorAgent = {
  id: "agent-1",
  name: "OpsBot",
  companyId: "company-1",
  kind: "operator" as const,
  persona: "professional",
  responseLength: "medium",
  language: "en",
  description: "Operator assistant",
  instructions: null,
  createdByUserId: "user-1",
  company: mockCompany,
};

const mockOperatorChat = {
  id: "chat-1",
  userId: "user-1",
  companyId: "company-1",
  agentId: "agent-1",
  versionId: "version-1",
  channelType: "operator" as const,
  title: "Untitled session",
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/operator/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeUIMessage(role: "user" | "assistant", text: string) {
  return {
    id: `msg-${Math.random()}`,
    role,
    parts: [{ type: "text", text }],
    createdAt: new Date(),
  };
}

function setupHappyPath() {
  vi.mocked(getSession).mockResolvedValue(mockSession as never);
  vi.mocked(requireSession).mockResolvedValue(mockSession as never);
  vi.mocked(db.query.companies.findFirst).mockResolvedValue(
    mockCompany as never,
  );
  vi.mocked(db.query.chats.findFirst).mockResolvedValue(
    mockOperatorChat as never,
  );
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(
    mockOperatorAgent as never,
  );
  vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
    id: "member-1",
    companyId: "company-1",
    userId: "user-1",
    pagePermissions: DEFAULT_PAGE_PERMISSIONS,
  } as never);
  vi.mocked(checkTokenBudget).mockResolvedValue({
    allowed: true,
    used: 0,
    limit: 100_000,
    remaining: 100_000,
    resetsAt: "2026-09-01T00:00:00.000Z",
  });
}

vi.mock("@/lib/ai/token-limiter", () => ({
  checkTokenBudget: vi.fn(() => ({
    allowed: true,
    used: 0,
    limit: 100_000,
    remaining: 100_000,
    resetsAt: "2026-09-01T00:00:00.000Z",
  })),
  recordTokenUsage: vi.fn(),
}));

describe("POST /api/operator/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is not the session starter", async () => {
    setupHappyPath();
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...mockOperatorChat,
      userId: "other-user",
    } as never);

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when user is not a company member", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(
      mockOperatorChat as never,
    );
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(
      mockOperatorAgent as never,
    );
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it("returns 403 when the member lacks Operator access", async () => {
    setupHappyPath();
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: "company-1",
      userId: "user-1",
      pagePermissions: {
        operator: false,
        agents: false,
        messaging: false,
        analytics: false,
      },
    } as never);

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(proxyToWorker).not.toHaveBeenCalled();
  });

  it("returns 429 when token budget is exceeded", async () => {
    setupHappyPath();
    vi.mocked(checkTokenBudget).mockResolvedValue({
      allowed: false,
      used: 100_000,
      limit: 100_000,
      remaining: 0,
      resetsAt: "2026-09-01T00:00:00.000Z",
    });

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe("Weekly token limit reached");
    expect(json.used).toBe(100_000);
    expect(json.limit).toBe(100_000);
    expect(json.resetsAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns 400 when chat is not an operator session", async () => {
    setupHappyPath();
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      ...mockOperatorChat,
      channelType: "web",
      versionId: null,
    } as never);

    const req = makeRequest({
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("proxies to worker for session starter who is a company member", async () => {
    setupHappyPath();

    const messages = [makeUIMessage("user", "hello")];
    const req = makeRequest({
      chatId: "chat-1",
      messages,
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(proxyToWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }),
        ]),
      }),
    );
  });
});
