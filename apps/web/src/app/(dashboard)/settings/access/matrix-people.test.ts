import { describe, expect, it } from "vitest";

import { ACCESS_MATRIX_COLUMNS } from "@/components/v2/data";
import type { CompanyPerson } from "../members/people";
import { accessMatrixPeople } from "./matrix-people";

const person = (over: Partial<CompanyPerson>): CompanyPerson => ({
  userId: "u",
  name: "U",
  email: "u@x.de",
  kind: "member",
  roleLabel: "Member",
  pagePermissions: { operator: true, agents: false, messaging: false, analytics: true },
  approvesOn: "None",
  approvesAny: false,
  addedAt: null,
  removeCopy: null,
  ...over,
});

describe("accessMatrixPeople", () => {
  it("lists owner and members, counts client users instead of listing them", () => {
    const { matrix, clientNote } = accessMatrixPeople([
      person({ userId: "o", kind: "owner", roleLabel: "Owner", approvesAny: true }),
      person({ userId: "m", approvesAny: true }),
      person({ userId: "c1", kind: "client", pagePermissions: null, approvesOn: null }),
      person({ userId: "c2", kind: "client", pagePermissions: null, approvesOn: null }),
    ]);
    expect(matrix.map((p) => [p.userId, p.kind, p.approvesAny])).toEqual([
      ["o", "owner", true],
      ["m", "member", true],
    ]);
    expect(clientNote).toBe("2 client users see only the client portal and are not listed here.");
  });

  it("has no client note without client users", () => {
    expect(accessMatrixPeople([person({ kind: "owner" })]).clientNote).toBeNull();
  });

  it("matrix columns carry no chat or approve page key", () => {
    const keys: string[] = ACCESS_MATRIX_COLUMNS.map((c) => c.key);
    expect(keys).not.toContain("chat");
    expect(keys).not.toContain("approve");
  });
});
