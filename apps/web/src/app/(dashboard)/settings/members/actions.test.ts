import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addCompanyMember,
  removeCompanyMember,
  updateCompanyMemberPermissions,
} from "../companies/actions";
import { inviteMember, removeMember, setMemberPageAccess } from "./actions";

vi.mock("../companies/actions", () => ({
  addCompanyMember: vi.fn(),
  removeCompanyMember: vi.fn(),
  updateCompanyMemberPermissions: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";

describe("inviteMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the picked role to the owner-only invite", async () => {
    vi.mocked(addCompanyMember).mockResolvedValue(undefined);
    await expect(inviteMember(companyId, "mira@nordwind.de", "client")).resolves.toEqual({ ok: true });
    expect(addCompanyMember).toHaveBeenCalledWith(companyId, "mira@nordwind.de", "client");
  });

  it("returns the unknown-email error on the email field", async () => {
    vi.mocked(addCompanyMember).mockRejectedValue(new Error("No Relay user with that email"));
    await expect(inviteMember(companyId, "mira@nordwind.de", "member")).resolves.toEqual({
      ok: false,
      field: "email",
      message: "No user with that email",
    });
  });

  it.each([
    "A client user can hold only one membership; this user already belongs to a company",
    "This user is a client of another company and cannot be added as a member",
  ])("returns the one-membership refusal: %s", async (message) => {
    vi.mocked(addCompanyMember).mockRejectedValue(new Error(message));
    await expect(inviteMember(companyId, "x@y.de", "client")).resolves.toEqual({
      ok: false,
      field: "email",
      message,
    });
  });

  it("refuses non-owners without leaking the authz message", async () => {
    vi.mocked(addCompanyMember).mockRejectedValue(
      new Error("Unauthorized: You don't have access to this company"),
    );
    await expect(inviteMember(companyId, "x@y.de", "member")).resolves.toEqual({
      ok: false,
      field: null,
      message: "Only the company owner can add people",
    });
  });

  it("rethrows unexpected errors", async () => {
    vi.mocked(addCompanyMember).mockRejectedValue(new Error("connection reset"));
    await expect(inviteMember(companyId, "x@y.de", "member")).rejects.toThrow("connection reset");
  });
});

describe("removeMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("removes through the owner-only action", async () => {
    vi.mocked(removeCompanyMember).mockResolvedValue(undefined);
    await expect(removeMember(companyId, "deniz")).resolves.toEqual({ ok: true });
    expect(removeCompanyMember).toHaveBeenCalledWith(companyId, "deniz");
  });

  it("returns the owner refusal", async () => {
    vi.mocked(removeCompanyMember).mockRejectedValue(new Error("Cannot remove the company owner"));
    await expect(removeMember(companyId, "owner")).resolves.toMatchObject({ ok: false });
  });
});

describe("setMemberPageAccess", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves the four page keys and never a chat or approve key", async () => {
    vi.mocked(updateCompanyMemberPermissions).mockResolvedValue(undefined);
    const permissions = { operator: true, agents: false, messaging: true, analytics: false };
    await expect(setMemberPageAccess(companyId, "deniz", permissions)).resolves.toEqual({ ok: true });
    const saved = vi.mocked(updateCompanyMemberPermissions).mock.calls[0][2] as Record<string, boolean>;
    expect(Object.keys(saved).sort()).toEqual(["agents", "analytics", "messaging", "operator"]);
  });

  it("returns a refusal for non-owners", async () => {
    vi.mocked(updateCompanyMemberPermissions).mockRejectedValue(
      new Error("Unauthorized: You don't have access to this company"),
    );
    await expect(setMemberPageAccess(companyId, "deniz", {})).resolves.toMatchObject({
      ok: false,
      message: "Only the company owner changes access",
    });
  });
});
