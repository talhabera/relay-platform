import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  addCompanyMember,
  removeCompanyMember,
  updateCompanyMemberPermissions,
} from "./actions";
import { DEFAULT_PAGE_PERMISSIONS } from "@/db/schema";
import { assertMembershipInviteAllowed } from "@/lib/operator/access";
import { revalidatePath } from "next/cache";

vi.mock("@/lib/authorization", () => ({
  requireCompanyAccess: vi.fn(),
}));

vi.mock("@/lib/operator/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/operator/access")>()),
  assertMembershipInviteAllowed: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const ownerId = "owner-1";

const company = {
  id: companyId,
  name: "Acme",
  ownerId,
};

describe("addCompanyMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
  });

  it("throws when no Relay user exists for the email", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);

    await expect(
      addCompanyMember(companyId, "missing@relay.dev"),
    ).rejects.toThrow("No Relay user with that email");
  });

  it("throws when adding the company owner", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: ownerId,
      email: "owner@relay.dev",
    } as never);

    await expect(
      addCompanyMember(companyId, "owner@relay.dev"),
    ).rejects.toThrow("Owner is already a member");
  });

  it("throws when the user is already a member", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "member-1",
      email: "member@relay.dev",
    } as never);
    const values = vi.fn().mockRejectedValue({ code: "23505" });
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await expect(
      addCompanyMember(companyId, "member@relay.dev"),
    ).rejects.toThrow("Already a member");
  });

  it("maps a racing second client membership to the one-membership error", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "client-1",
      email: "client@relay.dev",
    } as never);
    const values = vi.fn().mockRejectedValue({
      code: "23505",
      constraint_name: "company_members_client_user_uidx",
    });
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await expect(
      addCompanyMember(companyId, "client@relay.dev", "client"),
    ).rejects.toThrow("A client user can hold only one membership");
  });

  it("inserts a company member row", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "member-1",
      email: "member@relay.dev",
    } as never);
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await addCompanyMember(companyId, "  Member@Relay.dev  ");

    expect(requireCompanyAccess).toHaveBeenCalledWith(companyId);
    expect(assertMembershipInviteAllowed).toHaveBeenCalledWith("member-1", "member");
    expect(values).toHaveBeenCalledWith({
      companyId,
      userId: "member-1",
      role: "member",
      pagePermissions: DEFAULT_PAGE_PERMISSIONS,
    });
  });

  it("inserts a client row when invited as client", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "client-1",
      email: "client@relay.dev",
    } as never);
    const values = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.insert).mockReturnValue({ values } as never);

    await addCompanyMember(companyId, "client@relay.dev", "client");

    expect(assertMembershipInviteAllowed).toHaveBeenCalledWith("client-1", "client");
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "client-1", role: "client" }),
    );
  });

  it("refuses the invite when the one-membership rule fails", async () => {
    vi.mocked(db.query.users.findFirst).mockResolvedValue({
      id: "client-1",
      email: "client@relay.dev",
    } as never);
    vi.mocked(assertMembershipInviteAllowed).mockRejectedValueOnce(
      new Error("A client user can hold only one membership"),
    );

    await expect(
      addCompanyMember(companyId, "client@relay.dev", "client"),
    ).rejects.toThrow("only one membership");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects an unknown role", async () => {
    await expect(
      addCompanyMember(companyId, "member@relay.dev", "admin" as never),
    ).rejects.toThrow();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("removeCompanyMember", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
  });

  it("does not allow removing the company owner", async () => {
    await expect(removeCompanyMember(companyId, ownerId)).rejects.toThrow(
      "Cannot remove the company owner",
    );
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("removes editor grants and the membership row", async () => {
    vi.mocked(db.query.agents.findMany).mockResolvedValue([
      { id: "agent-1" },
      { id: "agent-2" },
    ] as never);
    const where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);

    await removeCompanyMember(companyId, "member-1");

    expect(requireCompanyAccess).toHaveBeenCalledWith(companyId);
    expect(db.delete).toHaveBeenCalledTimes(2);
    expect(where).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith(`/settings/companies/${companyId}`);
    expect(revalidatePath).toHaveBeenCalledWith("/settings/members");
  });
});

describe("updateCompanyMemberPermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: ownerId } },
      company,
    } as never);
  });

  it("does not allow changing the owner's implicit grants", async () => {
    await expect(
      updateCompanyMemberPermissions(companyId, ownerId, {
        operator: true,
        agents: false,
        messaging: false,
        analytics: false,
      }),
    ).rejects.toThrow("Owner already has access to every page");
  });

  it("throws when the user is not a member", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined);

    await expect(
      updateCompanyMemberPermissions(companyId, "member-1", {
        operator: true,
        agents: false,
        messaging: false,
        analytics: false,
      }),
    ).rejects.toThrow("Member not found");
  });

  it("updates the member page_permissions jsonb", async () => {
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue({
      id: "member-row-1",
      companyId,
      userId: "member-1",
    } as never);
    const set = vi.fn(() => ({
      where: vi.fn().mockResolvedValue(undefined),
    }));
    vi.mocked(db.update).mockReturnValue({ set } as never);

    await updateCompanyMemberPermissions(companyId, "member-1", {
      operator: true,
      agents: true,
      messaging: false,
      analytics: false,
    });

    expect(requireCompanyAccess).toHaveBeenCalledWith(companyId);
    expect(set).toHaveBeenCalledWith({
      pagePermissions: {
        operator: true,
        agents: true,
        messaging: false,
        analytics: false,
      },
    });
  });
});
