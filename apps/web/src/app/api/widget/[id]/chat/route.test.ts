import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, OPTIONS } from "./route";
import { db } from "@/db";
import { proxyToWorker } from "@/lib/worker-proxy";
import { RATE_LIMIT_SURFACES, enforceSurface } from "@/lib/rate-limit";

vi.mock("@/lib/worker-proxy", () => ({
  proxyToWorker: vi.fn(() =>
    Promise.resolve(
      new Response("stream", {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "X-Chat-Id": "chat-1",
        },
      }),
    ),
  ),
}));

const mockCompany = {
  id: "company-1",
  name: "Test Co",
  industry: "tech",
  description: "A test company",
  widgetId: "wid-123",
  ownerId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAgent = {
  id: "agent-1",
  name: "TestBot",
  companyId: "company-1",
  persona: "friendly",
  responseLength: "medium",
  language: "en",
  kind: "customer",
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeUIMessage(role: "user" | "assistant", text: string) {
  return {
    id: `msg-${Math.random()}`,
    role,
    parts: [{ type: "text", text }],
    createdAt: new Date(),
  };
}

function makeRequest(
  widgetId: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return new Request(
    `http://localhost:3000/api/widget/${widgetId}/chat`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    },
  );
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("OPTIONS /api/widget/[id]/chat", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });
});

describe("POST /api/widget/[id]/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(undefined);
  });

  it("returns 400 when messages is empty", async () => {
    const req = makeRequest("wid-123", { messages: [] });
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Messages are required");
  });

  it("returns 400 when messages is missing", async () => {
    const req = makeRequest("wid-123", {});
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.status).toBe(400);
  });

  it("returns 404 when widget/company not found", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);

    const req = makeRequest("nonexistent", {
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req as never, makeParams("nonexistent"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Widget not found");
  });

  it("proxies to worker on success", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      mockAgent,
    ] as never);

    const messages = [makeUIMessage("user", "hello")];
    const req = makeRequest(
      "wid-123",
      { messages, chatId: "chat-1" },
      { "x-forwarded-for": "203.0.113.1" },
    );
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.status).toBe(200);
    expect(proxyToWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "widget",
        visitorId: "203.0.113.1",
        companyId: "company-1",
        chatId: "chat-1",
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            parts: [{ type: "text", text: "hello" }],
          }),
        ]),
      }),
    );
  });

  it("includes CORS headers when the worker proxy returns 503", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      mockAgent,
    ] as never);
    vi.mocked(proxyToWorker).mockResolvedValueOnce(
      new Response("Worker unavailable", { status: 503 }),
    );

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req as never, makeParams("wid-123"));

    expect(res.status).toBe(503);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("uses the proxy-appended x-forwarded-for IP, not a client-supplied one", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      mockAgent,
    ] as never);

    const messages = [makeUIMessage("user", "hello")];
    const req = makeRequest(
      "wid-123",
      { messages, visitorId: "cookie-visitor-id" },
      // The client prepended a fake IP; Traefik appended the real peer.
      { "x-forwarded-for": "1.2.3.4, 198.51.100.42" },
    );
    await POST(req as never, makeParams("wid-123"));
    expect(proxyToWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        visitorId: "198.51.100.42",
      }),
    );
    expect(enforceSurface).toHaveBeenCalledWith(
      RATE_LIMIT_SURFACES.widgetChat({
        companyId: "company-1",
        visitor: "198.51.100.42",
      }),
    );
  });

  it("returns 429 with CORS and Retry-After when rate limited", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(proxyToWorker).mockClear();
    vi.mocked(enforceSurface).mockResolvedValueOnce({
      ok: false,
      denial: {
        allowed: false,
        kind: "rate",
        policy: "widget.visitor.minute",
        limit: 10,
        windowSec: 60,
        retryAfterSec: 12,
      },
    });

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req as never, makeParams("wid-123"));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(proxyToWorker).not.toHaveBeenCalled();
  });

  it("includes CORS headers in streaming response", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      mockAgent,
    ] as never);

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hi")],
    });
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("sets X-Chat-Id header when worker returns it", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      mockAgent,
    ] as never);

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hi")],
      chatId: "chat-1",
    });
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.headers.get("X-Chat-Id")).toBe("chat-1");
  });

  it("returns 400 when widget config agentId refers to an operator agent", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue({
      companyId: "company-1",
      agentId: "operator-agent-1",
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue({
      ...mockAgent,
      id: "operator-agent-1",
      kind: "operator",
    } as never);

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Widget agent is invalid");
    expect(proxyToWorker).not.toHaveBeenCalled();
  });

  it("returns 400 when widget config agentId is missing from database", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue({
      companyId: "company-1",
      agentId: "missing-agent",
    } as never);
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(undefined);

    const req = makeRequest("wid-123", {
      messages: [makeUIMessage("user", "hello")],
    });
    const res = await POST(req as never, makeParams("wid-123"));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Widget agent is invalid");
    expect(proxyToWorker).not.toHaveBeenCalled();
  });
});
