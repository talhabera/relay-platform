import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { PAGE_PERMISSION_KEYS } from "@/db/schema";
import { requireCompanyMembership } from "@/lib/operator/access";
import { PAGE_PERMISSION_CATALOG } from "./page-permission-catalog";
import {
  assertPageAccess,
  listPagePermissionsByCompanyId,
  pagePermissionLabel,
  requireAnyPageAccess,
  requirePageAccess,
  resolvePagePermissions,
} from "./page-access";

vi.mock("@/lib/operator/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/operator/access")>();
  return {
    ...actual,
    requireCompanyMembership: vi.fn(),
  };
});

const session = {
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@relay.dev",
    image: null,
  },
  session: { expiresAt: new Date("2026-09-01T00:00:00.000Z") },
};

const company = {
  id: "company-1",
  name: "Acme",
  ownerId: "owner-1",
};

describe("pagePermissionLabel", () => {
  it("returns the dashboard label for each page key", () => {
    expect(pagePermissionLabel("operator")).toBe("Operator");
    expect(pagePermissionLabel("agents")).toBe("Customer agents");
    expect(pagePermissionLabel("messaging")).toBe("Inbox");
    expect(pagePermissionLabel("analytics")).toBe("Analytics");
  });

  it("lists a catalog entry for every permission key", () => {
    expect(PAGE_PERMISSION_CATALOG.map((item) => item.key)).toEqual([
      ...PAGE_PERMISSION_KEYS,
    ]);
  });
});

describe("resolvePagePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("grants every page to the company owner without reading membership", async () => {
    await expect(
      resolvePagePermissions("owner-1", company),
    ).resolves.toEqual({
      operator: true,
      agents: true,
      messaging: true,
      analytics: true,
    });
    expect(db.query.companyMembers.findFirst).not.toHaveBeenCalled();
  });

  it("denies pages that are missing or false on the member row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { chat: true, operator: true },
    } as never);

    await expect(
      resolvePagePermissions(session.user.id, company),
    ).resolves.toEqual({
      operator: true,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });

  it("ignores stored grants on a client row", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      role: "client",
      pagePermissions: { operator: true, agents: true },
    } as never);

    await expect(
      resolvePagePermissions(session.user.id, company),
    ).resolves.toEqual({
      operator: false,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });

  it("denies every page when the user is not a member", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(
      resolvePagePermissions(session.user.id, company),
    ).resolves.toEqual({
      operator: false,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });
});

describe("assertPageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows the owner for any page", async () => {
    await expect(
      assertPageAccess("owner-1", company, ["analytics"]),
    ).resolves.toMatchObject({ analytics: true });
  });

  it("allows a member when any requested page is granted", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: false, agents: true },
    } as never);

    await expect(
      assertPageAccess(session.user.id, company, ["operator", "agents"]),
    ).resolves.toMatchObject({ operator: false, agents: true });
  });

  it("throws when none of the requested pages are granted", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: false },
    } as never);

    await expect(
      assertPageAccess(session.user.id, company, ["operator"]),
    ).rejects.toThrow("Unauthorized: You don't have Operator access");
  });

  it("points at Home when no page is requested", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: false },
    } as never);

    await expect(assertPageAccess(session.user.id, company, [])).rejects.toThrow(
      "Unauthorized: Only Home is available to you",
    );
  });
});

describe("requirePageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      session,
      company,
    } as never);
  });

  it("requires membership then the named page", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: true },
    } as never);

    await expect(requirePageAccess(company.id, "operator")).resolves.toEqual({
      session,
      company,
      permissions: {
        operator: true,
        agents: false,
        messaging: false,
        analytics: false,
      },
    });
    expect(requireCompanyMembership).toHaveBeenCalledWith(company.id);
  });

  it("throws when the member lacks the page", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: true, messaging: false },
    } as never);

    await expect(requirePageAccess(company.id, "messaging")).rejects.toThrow(
      "Unauthorized: You don't have Inbox access",
    );
  });
});

describe("requireAnyPageAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyMembership).mockResolvedValue({
      session,
      company,
    } as never);
  });

  it("allows access when any requested page is granted", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-1",
      companyId: company.id,
      userId: session.user.id,
      pagePermissions: { operator: false, agents: true },
    } as never);

    await expect(
      requireAnyPageAccess(company.id, ["operator", "agents"]),
    ).resolves.toMatchObject({
      session,
      company,
    });
  });
});

describe("listPagePermissionsByCompanyId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps owner companies to full access and members to stored grants", async () => {
    const owned = { id: "company-owned", ownerId: "user-1" };
    const memberCompany = { id: "company-member", ownerId: "owner-1" };

    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
      {
        companyId: memberCompany.id,
        userId: "user-1",
        pagePermissions: { operator: true, agents: true },
      },
    ] as never);

    const result = await listPagePermissionsByCompanyId("user-1", [
      owned,
      memberCompany,
    ]);

    expect(result[owned.id]).toEqual({
      operator: true,
      agents: true,
      messaging: true,
      analytics: true,
    });
    expect(result[memberCompany.id]).toEqual({
      operator: true,
      agents: true,
      messaging: false,
      analytics: false,
    });
  });

  it("maps a client row to no pages", async () => {
    const clientCompany = { id: "company-client", ownerId: "owner-1" };
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
      {
        companyId: clientCompany.id,
        userId: "user-1",
        role: "client",
        pagePermissions: { operator: true, analytics: true },
      },
    ] as never);

    const result = await listPagePermissionsByCompanyId("user-1", [
      clientCompany,
    ]);

    expect(result[clientCompany.id]).toEqual({
      operator: false,
      agents: false,
      messaging: false,
      analytics: false,
    });
  });
});
