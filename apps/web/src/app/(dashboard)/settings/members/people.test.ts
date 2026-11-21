import { describe, expect, it } from "vitest";

import {
  APPROVES_ON_NONE,
  buildCompanyPeople,
  OWNER_APPROVES_ON,
  type PeopleInput,
} from "./people";

const base: PeopleInput = {
  company: { ownerId: "owner", name: "Acme GmbH" },
  owner: { id: "owner", name: "Talha Bera", email: "talha@agency.example" },
  members: [],
  agents: [
    { id: "a1", name: "Lead Qualifier", createdByUserId: "owner" },
    { id: "a2", name: "Mail Marketer", createdByUserId: "owner" },
    { id: "a3", name: "Reporter", createdByUserId: "deniz" },
  ],
  agentUsers: [],
};

const member = (
  userId: string,
  role: "member" | "client",
  pagePermissions: unknown,
  name = userId,
) => ({
  userId,
  role,
  pagePermissions,
  createdAt: new Date("2026-09-23T09:10:00Z"),
  user: { name, email: `${userId}@agency.example` },
});

describe("buildCompanyPeople", () => {
  it("puts the owner first with every page and every agent", () => {
    const [owner] = buildCompanyPeople(base);
    expect(owner).toMatchObject({
      kind: "owner",
      roleLabel: "Owner",
      approvesOn: OWNER_APPROVES_ON,
      approvesAny: true,
      removeCopy: null,
      pagePermissions: { operator: true, agents: true, messaging: true, analytics: true },
    });
  });

  it("lists agents a member approves on: canApprove with operator, plus agents they created", () => {
    const people = buildCompanyPeople({
      ...base,
      members: [member("deniz", "member", { operator: true, analytics: true }, "Deniz Aksoy")],
      agentUsers: [
        { agentId: "a1", userId: "deniz", canApprove: true },
        { agentId: "a2", userId: "deniz", canApprove: false },
      ],
    });
    expect(people[1]).toMatchObject({
      kind: "member",
      roleLabel: "Member",
      approvesOn: "Lead Qualifier, Reporter",
      approvesAny: true,
    });
  });

  it("shows None for a member with canApprove but no operator page", () => {
    const people = buildCompanyPeople({
      ...base,
      members: [member("jonas", "member", { operator: false })],
      agentUsers: [{ agentId: "a1", userId: "jonas", canApprove: true }],
    });
    expect(people[1].approvesOn).toBe(APPROVES_ON_NONE);
    expect(people[1].approvesAny).toBe(false);
  });

  it("gives client users no pages and no approves-on line, and lists them after members", () => {
    const people = buildCompanyPeople({
      ...base,
      members: [
        member("mira", "client", { operator: true }),
        member("deniz", "member", { operator: true }),
      ],
      agentUsers: [{ agentId: "a1", userId: "mira", canApprove: true }],
    });
    expect(people.map((p) => p.userId)).toEqual(["owner", "deniz", "mira"]);
    expect(people[2]).toMatchObject({
      kind: "client",
      roleLabel: "Client",
      pagePermissions: null,
      approvesOn: null,
      approvesAny: false,
    });
  });

  it("writes the remove-dialog copy from the pages the member holds", () => {
    const people = buildCompanyPeople({
      ...base,
      members: [
        member("deniz", "member", { operator: true, messaging: true, analytics: true }, "Deniz Aksoy"),
        member("mira", "client", {}, "Mira Hahn"),
      ],
    });
    expect(people[1].removeCopy).toBe(
      "Deniz loses access to Operator, Inbox and Analytics for Acme GmbH. Sessions Deniz started stay in the history.",
    );
    expect(people[2].removeCopy).toBe("Mira loses access to the client portal for Acme GmbH.");
  });
});
