import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSession } from "@/lib/auth-server";
import { requireCompanyMembership } from "@/lib/operator/access";
import { getNeedsYou } from "@/lib/operator/needs-you";
import { GET } from "./route";
import { GET as GET_COUNT } from "./count/route";

vi.mock("@/lib/operator/access", () => ({
  requireCompanyMembership: vi.fn(),
}));

vi.mock("@/lib/operator/needs-you", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/operator/needs-you")>();
  return { ...actual, getNeedsYou: vi.fn() };
});

const COMPANY = "11111111-1111-4111-8111-111111111111";
const mockSession = {
  user: { id: "member-1", name: "Member", email: "m@test.com" },
  session: { expiresAt: new Date("2026-12-01T00:00:00.000Z") },
};

const items = Array.from({ length: 7 }, (_, i) => ({
  id: `item-${i}`,
  type: "agent_question" as const,
  agentId: "agent-1",
  agentName: "A",
  title: `Q${i}`,
  createdAt: new Date(`2026-09-25T0${i}:00:00.000Z`),
  chatId: "chat-1",
  cronRunId: null,
  cronJobId: null,
  tier: 3 as const,
  href: "/operator?agentId=agent-1&chatId=chat-1",
}));

const req = (path: string) => new Request(`http://localhost:3000${path}`);

describe("GET /api/operator/needs-you", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSession).mockResolvedValue(mockSession as never);
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      session: mockSession,
      company: { id: COMPANY, ownerId: "owner-1" },
    } as never);
    vi.mocked(getNeedsYou).mockResolvedValue({ items, total: items.length });
  });

  it("returns 401 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    const res = await GET(req(`/api/operator/needs-you?companyId=${COMPANY}`));
    expect(res.status).toBe(401);
  });

  it("returns 400 on a bad companyId", async () => {
    const res = await GET(req("/api/operator/needs-you?companyId=nope"));
    expect(res.status).toBe(400);
  });

  it("returns 403 for a non-member", async () => {
    vi.mocked(requireCompanyMembership).mockRejectedValue(new Error("no"));
    const res = await GET(req(`/api/operator/needs-you?companyId=${COMPANY}`));
    expect(res.status).toBe(403);
    expect(getNeedsYou).not.toHaveBeenCalled();
  });

  it("returns the top 5 with the full total, filtered for the viewer", async () => {
    const res = await GET(req(`/api/operator/needs-you?companyId=${COMPANY}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.items[0].id).toBe("item-0");
    expect(body.total).toBe(7);
    expect(getNeedsYou).toHaveBeenCalledWith({
      companyId: COMPANY,
      viewerId: "member-1",
      ownerId: "owner-1",
    });
  });

  it("returns every item with view=all", async () => {
    const res = await GET(
      req(`/api/operator/needs-you?companyId=${COMPANY}&view=all`),
    );
    const body = await res.json();
    expect(body.items).toHaveLength(7);
  });

  it("count returns the bell count (list length)", async () => {
    const res = await GET_COUNT(
      req(`/api/operator/needs-you/count?companyId=${COMPANY}`),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ count: 7 });
  });
});
