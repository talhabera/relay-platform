import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/operator/access", () => ({
  requireCompanyMembership: vi.fn(),
}));

import { PATCH } from "./route";
import { getSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";
import { db } from "@/db";

const mockSession = {
  user: { id: "user-1", name: "Test User", email: "test@test.com" },
  session: { id: "session-1" },
};

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost:3000/api/user/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/user/preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      session: mockSession as never,
      company: { id: "company-1", ownerId: "user-1" } as never,
    });
    vi.mocked(db.insert).mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    const req = makeRequest({ activeCompanyId: "company-1" });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 400 when activeCompanyId is missing", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const req = makeRequest({});
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("activeCompanyId");
  });

  it("returns 403 when the user lacks company membership", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireCompanyMembership).mockRejectedValue(
      new Error("Unauthorized: You don't have access to this company"),
    );
    const req = makeRequest({ activeCompanyId: "company-1" });
    const res = await PATCH(req);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain("don't have access");
  });

  it("upserts preferences and returns success", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    const req = makeRequest({ activeCompanyId: "company-1" });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(db.insert).toHaveBeenCalled();
    expect(requireCompanyMembership).toHaveBeenCalledWith("company-1");
  });

  it("uses the session userId for the upsert", async () => {
    vi.mocked(getSession).mockResolvedValue(mockSession as never);

    const mockValues = vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(db.insert).mockReturnValue({ values: mockValues } as never);

    const req = makeRequest({ activeCompanyId: "company-2" });
    await PATCH(req);

    expect(mockValues).toHaveBeenCalledWith({
      userId: "user-1",
      activeCompanyId: "company-2",
    });
  });
});
