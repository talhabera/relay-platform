import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSession, requireLeadSession, exportSessionLeads, loadSessionLeads } = vi.hoisted(() => ({
  getSession: vi.fn(),
  requireLeadSession: vi.fn(),
  exportSessionLeads: vi.fn(),
  loadSessionLeads: vi.fn(),
}));

vi.mock("@/lib/auth-server", () => ({ getSession }));
vi.mock("@/lib/leads/session-access", () => ({ requireLeadSession }));
vi.mock("@/lib/leads/session-leads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leads/session-leads")>()),
  exportSessionLeads,
  loadSessionLeads,
}));

import { GET } from "./route";

const WINDOW = { companyId: "company-1", from: new Date("2026-09-21"), to: new Date("2026-09-28") };
const params = (chatId = "chat-1") => ({ params: Promise.resolve({ chatId }) });
const request = (query = "") => new Request(`http://localhost/api/operator/sessions/chat-1/leads/export${query}`);

const row = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  entityType: "account",
  name: "Brandt Logistik GmbH",
  domain: "brandt.de",
  phone: null,
  source: "outbound",
  status: "qualified",
  fitScore: 91,
  reasons: ["Size fit"],
  rejectReason: null,
  payload: { contact: { name: "Julia Weber" } },
  createdAt: new Date("2026-09-21T06:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "u1" } });
  requireLeadSession.mockResolvedValue({ userId: "u1", chatId: "chat-1", window: WINDOW, weekId: "2026-W39", timeZone: "UTC" });
  exportSessionLeads.mockResolvedValue([row()]);
});

describe("GET session leads export", () => {
  it("returns the tab as a BOM-prefixed CSV attachment", async () => {
    const response = await GET(request("?tab=borderline"), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="leads-borderline-2026-W39.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(exportSessionLeads).toHaveBeenCalledWith(WINDOW, "borderline");
  });

  // The pane's 500-row window must not leak into the export.
  it("exports through the uncapped query, not the pane query", async () => {
    await GET(request(), params());

    expect(exportSessionLeads).toHaveBeenCalledWith(WINDOW, "qualified");
    expect(loadSessionLeads).not.toHaveBeenCalled();
  });

  it("escapes formula prefixes from strangers' text", async () => {
    exportSessionLeads.mockResolvedValue([row({ name: "=HYPERLINK(\"x\")", payload: { intake: { lokasyon: "+90 Kadıköy" } } })]);

    const csv = await (await GET(request(), params())).text();

    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+90 Kadıköy");
  });

  it("falls back to Qualified on an unknown tab", async () => {
    await GET(request("?tab=new"), params());
    expect(exportSessionLeads).toHaveBeenCalledWith(WINDOW, "qualified");
  });

  it("401 without a session, 403 without access, 404 for an unknown session", async () => {
    getSession.mockResolvedValueOnce(null);
    expect((await GET(request(), params())).status).toBe(401);

    requireLeadSession.mockRejectedValueOnce(new Error("Unauthorized: no"));
    expect((await GET(request(), params())).status).toBe(403);

    requireLeadSession.mockRejectedValueOnce(new Error("Not found: session"));
    expect((await GET(request(), params())).status).toBe(404);
    expect(exportSessionLeads).not.toHaveBeenCalled();
  });
});
