import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, OPTIONS } from "./route";
import { db } from "@/db";

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

const mockWidgetConfig = {
  id: "config-1",
  companyId: "company-1",
  primaryColor: "#ff0000",
  position: "bottom-left",
  welcomeMessage: "Hello!",
  title: "Support",
  avatarUrl: "https://example.com/avatar.png",
  theme: "dark",
  showBranding: false,
  autoOpen: true,
  autoOpenDelay: 5000,
  persistThread: false,
  customCss: ".widget { color: red; }",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeRequest(widgetId: string) {
  return new Request(
    `http://localhost:3000/api/widget/${widgetId}/config`
  );
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("OPTIONS /api/widget/[id]/config", () => {
  it("returns 204 with CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
  });
});

describe("GET /api/widget/[id]/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for empty widget ID", async () => {
    const req = makeRequest("");
    const res = await GET(req as never, makeParams(""));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid widget ID");
  });

  it("returns 404 when company not found", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);
    const req = makeRequest("nonexistent");
    const res = await GET(req as never, makeParams("nonexistent"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Widget not found");
  });

  it("returns default config when no custom config exists", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(undefined);

    const req = makeRequest("wid-123");
    const res = await GET(req as never, makeParams("wid-123"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.widgetId).toBe("wid-123");
    expect(json.companyName).toBe("Test Co");
    expect(json.config.primaryColor).toBe("#6366f1");
    expect(json.config.position).toBe("bottom-right");
    expect(json.config.showBranding).toBe(true);
  });

  it("returns custom config when one exists", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(
      mockWidgetConfig as never
    );

    const req = makeRequest("wid-123");
    const res = await GET(req as never, makeParams("wid-123"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config.primaryColor).toBe("#ff0000");
    expect(json.config.position).toBe("bottom-left");
    expect(json.config.showBranding).toBe(false);
    expect(json.config.theme).toBe("dark");
  });

  it("includes CORS headers in response", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(undefined);

    const req = makeRequest("wid-123");
    const res = await GET(req as never, makeParams("wid-123"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("includes cache-control headers", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never
    );
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(undefined);

    const req = makeRequest("wid-123");
    const res = await GET(req as never, makeParams("wid-123"));
    expect(res.headers.get("Cache-Control")).toContain("public");
  });

  it("merges partial config with defaults", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never
    );
    // Config with some null fields — should fall back to defaults
    vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue({
      ...mockWidgetConfig,
      welcomeMessage: null,
      avatarUrl: null,
      customCss: null,
    } as never);

    const req = makeRequest("wid-123");
    const res = await GET(req as never, makeParams("wid-123"));
    const json = await res.json();
    expect(json.config.welcomeMessage).toBe(
      "Hi there! How can I help you today?"
    );
    expect(json.config.avatarUrl).toBeNull();
    expect(json.config.customCss).toBeNull();
  });
});
