import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  listAccessibleCompanies,
  resolveActiveCompanyId,
} from "./companies";

const userId = "user-1";

const ownedOnly = {
  id: "company-owned",
  name: "Alpha Owned",
  industry: null,
  description: null,
  widgetId: null,
  ownerId: userId,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const memberOnly = {
  id: "company-member",
  name: "Beta Member",
  industry: null,
  description: null,
  widgetId: null,
  ownerId: "other-owner",
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

const ownedAndMember = {
  id: "company-both",
  name: "Gamma Both",
  industry: null,
  description: null,
  widgetId: null,
  ownerId: userId,
  createdAt: new Date("2026-01-01"),
  updatedAt: new Date("2026-01-01"),
};

describe("listAccessibleCompanies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves client memberships out of the dashboard company list", async () => {
    vi.mocked(db.query.companies.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([] as never);

    await listAccessibleCompanies(userId);

    const where = vi.mocked(db.query.companyMembers.findMany).mock.calls[0]?.[0]
      ?.where as SQL;
    const query = new PgDialect().sqlToQuery(where);
    expect(query.sql).toContain(`"role" <> $`);
    expect(query.params).toEqual(expect.arrayContaining([userId, "client"]));
  });

  it("includes companies the user owns", async () => {
    vi.mocked(db.query.companies.findMany).mockResolvedValue([ownedOnly] as never);
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([] as never);

    const result = await listAccessibleCompanies(userId);

    expect(result).toEqual([ownedOnly]);
  });

  it("includes companies where the user is a member but not owner", async () => {
    vi.mocked(db.query.companies.findMany).mockResolvedValue([] as never);
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
      {
        id: "member-1",
        companyId: memberOnly.id,
        userId,
        createdAt: new Date("2026-01-01"),
        company: memberOnly,
      },
    ] as never);

    const result = await listAccessibleCompanies(userId);

    expect(result).toEqual([memberOnly]);
  });

  it("deduplicates when the user owns and is a member of the same company", async () => {
    vi.mocked(db.query.companies.findMany).mockResolvedValue([
      ownedAndMember,
    ] as never);
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
      {
        id: "member-2",
        companyId: ownedAndMember.id,
        userId,
        createdAt: new Date("2026-01-01"),
        company: ownedAndMember,
      },
    ] as never);

    const result = await listAccessibleCompanies(userId);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(ownedAndMember);
  });

  it("sorts companies by name", async () => {
    vi.mocked(db.query.companies.findMany).mockResolvedValue([
      ownedOnly,
      ownedAndMember,
    ] as never);
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue([
      {
        id: "member-1",
        companyId: memberOnly.id,
        userId,
        createdAt: new Date("2026-01-01"),
        company: memberOnly,
      },
    ] as never);

    const result = await listAccessibleCompanies(userId);

    expect(result.map((c) => c.name)).toEqual([
      "Alpha Owned",
      "Beta Member",
      "Gamma Both",
    ]);
  });
});

describe("resolveActiveCompanyId", () => {
  const companies = [{ id: "company-a" }, { id: "company-b" }];

  it("prefers persisted activeCompanyId when set", () => {
    expect(resolveActiveCompanyId("company-b", companies)).toBe("company-b");
  });

  it("falls back to first accessible company when prefs are unset", () => {
    expect(resolveActiveCompanyId(null, companies)).toBe("company-a");
    expect(resolveActiveCompanyId(undefined, companies)).toBe("company-a");
  });

  it("ignores prefs when the company is no longer accessible", () => {
    expect(resolveActiveCompanyId("revoked-company", companies)).toBe(
      "company-a",
    );
  });

  it("returns null when there is no prefs value and no accessible companies", () => {
    expect(resolveActiveCompanyId(null, [])).toBeNull();
  });
});
