import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireClientAccess } from "@/lib/operator/access";
import { getLiveSummary } from "@/lib/live/summary";
import { listPortalEvents } from "@/lib/live/feed";
import { GET } from "./route";

vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/live/summary", () => ({ getLiveSummary: vi.fn() }));
vi.mock("@/lib/live/feed", () => ({ FEED_DEFAULT_LIMIT: 20, listPortalEvents: vi.fn() }));

const COMPANY = "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60";

function get(query: string) {
  return GET(new Request(`http://localhost/api/client/live${query}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireClientAccess).mockResolvedValue({ role: "client" } as never);
  vi.mocked(getLiveSummary).mockResolvedValue({ companyId: COMPANY } as never);
  vi.mocked(listPortalEvents).mockResolvedValue([{ id: "evt-1" }] as never);
});

describe("GET /api/client/live", () => {
  it("returns the summary and newest feed rows for a portal viewer", async () => {
    const res = await get(`?companyId=${COMPANY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ summary: { companyId: COMPANY }, events: [{ id: "evt-1" }] });
    // Read-only: the owner / member preview is allowed too.
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY);
    expect(listPortalEvents).toHaveBeenCalledWith(COMPANY, { limit: 20 });
  });

  it("refuses users without access to the company", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    const res = await get(`?companyId=${COMPANY}`);
    expect(res.status).toBe(403);
    expect(getLiveSummary).not.toHaveBeenCalled();
    expect(listPortalEvents).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed company id", async () => {
    expect((await get("")).status).toBe(400);
    expect((await get("?companyId=nope")).status).toBe(400);
    expect(requireClientAccess).not.toHaveBeenCalled();
  });

  it("answers 404 when the company is gone", async () => {
    vi.mocked(getLiveSummary).mockResolvedValue(null);
    expect((await get(`?companyId=${COMPANY}`)).status).toBe(404);
  });
});
