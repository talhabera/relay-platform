import { describe, expect, it } from "vitest";
import {
  addCompanyMemberSchema,
  companyMemberRoleSchema,
  updateCompanyMemberPermissionsSchema,
} from "./company-member";
import { COMPANY_MEMBER_ROLES } from "@relay/db/schema/company-members";

const companyId = "550e8400-e29b-41d4-a716-446655440000";

describe("addCompanyMemberSchema", () => {
  it("trims and lowercases email", () => {
    const result = addCompanyMemberSchema.parse({
      companyId,
      email: "  User@Example.COM  ",
    });

    expect(result.email).toBe("user@example.com");
  });

  it("rejects invalid email", () => {
    expect(() =>
      addCompanyMemberSchema.parse({
        companyId,
        email: "not-an-email",
      }),
    ).toThrow();
  });

  it("rejects invalid company id", () => {
    expect(() =>
      addCompanyMemberSchema.parse({
        companyId: "not-a-uuid",
        email: "user@example.com",
      }),
    ).toThrow();
  });
});

describe("updateCompanyMemberPermissionsSchema", () => {
  it("accepts a full page-permission map", () => {
    const result = updateCompanyMemberPermissionsSchema.parse({
      companyId,
      userId: "member-1",
      permissions: {
        operator: true,
        agents: true,
        messaging: false,
        analytics: false,
      },
    });

    expect(result.permissions.operator).toBe(true);
    expect(result.permissions.agents).toBe(true);
  });

  it("rejects a partial permission map", () => {
    expect(() =>
      updateCompanyMemberPermissionsSchema.parse({
        companyId,
        userId: "member-1",
        permissions: { operator: true },
      }),
    ).toThrow();
  });

  it("strips the retired chat key", () => {
    const result = updateCompanyMemberPermissionsSchema.parse({
      companyId,
      userId: "member-1",
      permissions: {
        chat: true,
        operator: true,
        agents: false,
        messaging: false,
        analytics: false,
      },
    });

    expect(result.permissions).not.toHaveProperty("chat");
  });
});

describe("companyMemberRoleSchema", () => {
  it("matches the db role enum", () => {
    expect(companyMemberRoleSchema.options).toEqual([...COMPANY_MEMBER_ROLES]);
  });

  it("rejects other roles", () => {
    expect(() => companyMemberRoleSchema.parse("owner")).toThrow();
  });
});
