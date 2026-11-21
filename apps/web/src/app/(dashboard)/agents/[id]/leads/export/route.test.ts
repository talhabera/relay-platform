import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireAgentAccess, exportAgentLeads, listAgentLeads } = vi.hoisted(() => ({
  requireAgentAccess: vi.fn(),
  exportAgentLeads: vi.fn(),
  listAgentLeads: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ requireAgentAccess }));
vi.mock("@/lib/leads-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/leads-queries")>()),
  exportAgentLeads,
  listAgentLeads,
}));

import { GET } from "./route";

const AGENT = { id: "agent-1", companyId: "company-1", kind: "customer" };
const params = (id = "agent-1") => ({ params: Promise.resolve({ id }) });
const request = (query = "") => new Request(`http://localhost/agents/agent-1/leads/export${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  requireAgentAccess.mockResolvedValue({ session: {}, agent: AGENT });
  exportAgentLeads.mockResolvedValue([]);
});

describe("GET leads export", () => {
  it("returns a CSV attachment for the owner", async () => {
    const response = await GET(request(), params());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    // Response.text() strips a leading BOM while decoding, so check the raw bytes.
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(exportAgentLeads).toHaveBeenCalledWith(AGENT, undefined);
  });

  // The page's 500-row window must not leak into the export.
  it("exports through the uncapped query, not the page query", async () => {
    await GET(request(), params());

    expect(exportAgentLeads).toHaveBeenCalledTimes(1);
    expect(listAgentLeads).not.toHaveBeenCalled();
  });

  it("applies a valid status filter and ignores an invalid one", async () => {
    await GET(request("?status=qualified"), params());
    expect(exportAgentLeads).toHaveBeenLastCalledWith(AGENT, "qualified");

    await GET(request("?status=bogus"), params());
    expect(exportAgentLeads).toHaveBeenLastCalledWith(AGENT, undefined);
  });

  it("answers 404 and reads nothing when the caller does not own the agent", async () => {
    requireAgentAccess.mockRejectedValue(new Error("Unauthorized"));

    const response = await GET(request(), params());

    expect(response.status).toBe(404);
    expect(exportAgentLeads).not.toHaveBeenCalled();
  });

  it("answers 404 for operator agents", async () => {
    requireAgentAccess.mockResolvedValue({ session: {}, agent: { ...AGENT, kind: "operator" } });

    expect((await GET(request(), params())).status).toBe(404);
    expect(exportAgentLeads).not.toHaveBeenCalled();
  });
});
