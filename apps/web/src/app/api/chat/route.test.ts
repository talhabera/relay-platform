import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { getSession } from "@/lib/auth-server";
import { db } from "@/db";
import { proxyToWorker } from "@/lib/worker-proxy";

vi.mock("@/lib/worker-proxy", () => ({
  proxyToWorker: vi.fn(() => Promise.resolve(new Response("stream", { status: 200 }))),
}));

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@test.com" },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const mockCompany = {
  id: "company-1",
  name: "Test Co",
  industry: "tech",
  description: "A test company",
  widgetId: "widget-1",
  ownerId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/chat", {
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

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    const req = makeRequest({
      messages: [makeUIMessage("user", "hello")],
      companyId: "company-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when companyId is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);

    const req = makeRequest({
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("Company ID");
  });

  it("returns 400 when messages is empty", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);

    const req = makeRequest({
      messages: [],
      companyId: "company-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the caller does not own the company", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue({
      ...mockCompany,
      ownerId: "someone-else",
    } as never);

    const res = await POST(
      makeRequest({
        messages: [makeUIMessage("user", "hi")],
        companyId: "company-1",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the agent belongs to another company", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findFirst).mockResolvedValue({
      id: "agent-x",
      companyId: "company-2",
      kind: "customer",
    } as never);

    const res = await POST(
      makeRequest({
        messages: [makeUIMessage("user", "hi")],
        companyId: "company-1",
        agentId: "agent-x",
      }),
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when company not found", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);

    const req = makeRequest({
      messages: [makeUIMessage("user", "hello")],
      companyId: "nonexistent",
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it("proxies to worker on success", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(undefined);

    const messages = [makeUIMessage("user", "hello")];
    const req = makeRequest({
      messages,
      companyId: "company-1",
      chatId: "chat-1",
      agentId: "agent-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(proxyToWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "customer",
        agentId: "agent-1",
        companyId: "company-1",
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

  it("returns 400 when agentId refers to an operator agent", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findFirst).mockResolvedValue({
      id: "operator-agent-1",
      companyId: "company-1",
      name: "OpsBot",
      persona: "professional",
      responseLength: "medium",
      language: "en",
      kind: "operator",
    } as never);

    const req = makeRequest({
      messages: [makeUIMessage("user", "hello")],
      companyId: "company-1",
      agentId: "operator-agent-1",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text.toLowerCase()).toContain("operator");
    expect(proxyToWorker).not.toHaveBeenCalled();
  });
});
