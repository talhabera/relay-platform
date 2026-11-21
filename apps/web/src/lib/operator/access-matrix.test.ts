import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireSession } from "@/lib/auth-server";
import { requireAgentAccess, requireCompanyAccess } from "@/lib/authorization";
import {
  assertMembershipInviteAllowed,
  requireCheckpointApprove,
  requireClientAccess,
  requireCompanyMembership,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
  requireOperatorSessionApprove,
} from "./access";

// Authz matrix for S12 (spec 2026-10-02-client-role-and-portal, decision 6):
// owner / member / client x every helper.

type Actor = "owner" | "member" | "client";

const company = { id: "company-1", name: "Acme", ownerId: "owner-1" };

const userIds: Record<Actor, string> = {
  owner: "owner-1",
  member: "member-1",
  client: "client-1",
};

const operatorAgent = {
  id: "agent-1",
  name: "Ops Agent",
  companyId: company.id,
  kind: "operator" as const,
  createdByUserId: "creator-1",
  company,
};

const customerAgent = { ...operatorAgent, id: "agent-2", kind: "customer" as const };

function sessionFor(actor: Actor) {
  return {
    user: { id: userIds[actor], name: actor, email: `${actor}@relay.dev`, image: null },
    session: { expiresAt: new Date("2026-12-01T00:00:00.000Z") },
  };
}

function memberRowFor(actor: Actor) {
  if (actor === "owner") return undefined;
  return {
    id: `row-${actor}`,
    companyId: company.id,
    userId: userIds[actor],
    role: actor,
    pagePermissions: { operator: true, agents: false, messaging: false, analytics: false },
  };
}

function arrange(actor: Actor) {
  vi.mocked(requireSession).mockResolvedValue(sessionFor(actor));
  vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
  vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(
    memberRowFor(actor) as never,
  );
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(operatorAgent as never);
  // Every actor is an agent user with edit + approve and owns the chat, so only
  // the role decides.
  vi.mocked(db.query.operatorAgentEditors.findFirst).mockResolvedValue({
    agentId: operatorAgent.id,
    userId: userIds[actor],
    canEdit: true,
    canApprove: true,
  } as never);
  vi.mocked(db.query.chats.findFirst).mockResolvedValue({
    id: "chat-1",
    companyId: company.id,
    agentId: operatorAgent.id,
    userId: userIds[actor],
    channelType: "operator",
  } as never);
}

type Helper = { name: string; run: () => Promise<unknown> };

const helpers: Helper[] = [
  { name: "requireCompanyMembership", run: () => requireCompanyMembership(company.id) },
  { name: "requireOperatorAgentAccess", run: () => requireOperatorAgentAccess(operatorAgent.id) },
  { name: "requireOperatorAgentEdit", run: () => requireOperatorAgentEdit(operatorAgent.id) },
  { name: "requireOperatorSessionApprove", run: () => requireOperatorSessionApprove("chat-1") },
  { name: "requireCheckpointApprove", run: () => requireCheckpointApprove(operatorAgent.id) },
  { name: "requireClientAccess", run: () => requireClientAccess(company.id) },
  {
    name: "requireClientAccess (mutation)",
    run: () => requireClientAccess(company.id, { mutation: true }),
  },
  { name: "requireCompanyAccess", run: () => requireCompanyAccess(company.id) },
  {
    name: "requireAgentAccess",
    run: async () => {
      vi.mocked(db.query.agents.findFirst).mockResolvedValue(customerAgent as never);
      return requireAgentAccess(customerAgent.id);
    },
  },
];

// true = passes, false = throws
const expected: Record<string, Record<Actor, boolean>> = {
  requireCompanyMembership: { owner: true, member: true, client: false },
  requireOperatorAgentAccess: { owner: true, member: true, client: false },
  requireOperatorAgentEdit: { owner: true, member: true, client: false },
  requireOperatorSessionApprove: { owner: true, member: true, client: false },
  requireCheckpointApprove: { owner: true, member: true, client: false },
  requireClientAccess: { owner: true, member: true, client: true },
  "requireClientAccess (mutation)": { owner: false, member: false, client: true },
  requireCompanyAccess: { owner: true, member: false, client: false },
  requireAgentAccess: { owner: true, member: false, client: false },
};

describe("authz matrix: owner / member / client x helpers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  const actors: Actor[] = ["owner", "member", "client"];
  for (const helper of helpers) {
    for (const actor of actors) {
      const passes = expected[helper.name][actor];
      it(`${helper.name} ${passes ? "passes" : "refuses"} ${actor}`, async () => {
        arrange(actor);
        if (passes) {
          await expect(helper.run()).resolves.toBeDefined();
        } else {
          await expect(helper.run()).rejects.toThrow(/Unauthorized/);
        }
      });
    }
  }

  it("requireClientAccess reports which role passed", async () => {
    for (const actor of actors) {
      vi.resetAllMocks();
      arrange(actor);
      const result = await requireClientAccess(company.id);
      expect(result.role).toBe(actor);
      expect(result.company).toEqual(company);
    }
  });

  it("requireClientAccess refuses a user with no membership", async () => {
    vi.mocked(requireSession).mockResolvedValue(sessionFor("member"));
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(company as never);
    vi.mocked(db.query.companyMembers.findFirst).mockResolvedValue(undefined as never);
    await expect(requireClientAccess(company.id)).rejects.toThrow(/Unauthorized/);
  });

  it("requireClientAccess refuses an unknown company", async () => {
    vi.mocked(requireSession).mockResolvedValue(sessionFor("owner"));
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined as never);
    await expect(requireClientAccess(company.id)).rejects.toThrow(/Unauthorized/);
  });
});

describe("assertMembershipInviteAllowed (one membership per client user)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  function arrangeExisting(
    memberships: { companyId: string; role: Actor }[],
    ownedCompanies: { id: string }[] = [],
  ) {
    vi.mocked(db.query.companyMembers.findMany).mockResolvedValue(
      memberships.map((m, i) => ({ id: `row-${i}`, userId: "u1", ...m })) as never,
    );
    vi.mocked(db.query.companies.findMany).mockResolvedValue(ownedCompanies as never);
  }

  it("allows a client invite for a user with no memberships", async () => {
    arrangeExisting([]);
    await expect(assertMembershipInviteAllowed("u1", "client")).resolves.toBeUndefined();
  });

  it("refuses a client invite for a user who is already a member elsewhere", async () => {
    arrangeExisting([{ companyId: "other", role: "member" }]);
    await expect(assertMembershipInviteAllowed("u1", "client")).rejects.toThrow(
      /one membership/i,
    );
  });

  it("refuses a client invite for a user who is already a client elsewhere", async () => {
    arrangeExisting([{ companyId: "other", role: "client" }]);
    await expect(assertMembershipInviteAllowed("u1", "client")).rejects.toThrow(
      /one membership/i,
    );
  });

  it("refuses a client invite for a user who owns a company", async () => {
    arrangeExisting([], [{ id: "own-co" }]);
    await expect(assertMembershipInviteAllowed("u1", "client")).rejects.toThrow(
      /one membership/i,
    );
  });

  it("refuses a member invite for a user who is a client elsewhere", async () => {
    arrangeExisting([{ companyId: "other", role: "client" }]);
    await expect(assertMembershipInviteAllowed("u1", "member")).rejects.toThrow(
      /client/i,
    );
  });

  it("allows a member invite for a user who is a member elsewhere", async () => {
    arrangeExisting([{ companyId: "other", role: "member" }]);
    await expect(assertMembershipInviteAllowed("u1", "member")).resolves.toBeUndefined();
  });
});

describe("requireClientAccess is used only by the client portal", () => {
  const srcRoot = path.resolve(__dirname, "../..");
  const allowed = [
    path.join(srcRoot, "app", "client") + path.sep,
    path.join(srcRoot, "app", "api", "client") + path.sep,
    path.join(srcRoot, "lib", "operator", "access."),
    path.join(srcRoot, "lib", "operator", "access-matrix.test.ts"),
  ];

  // A call or an import counts; a mention in a comment does not.
  const usesClientAccess =
    /\brequireClientAccess\s*\(|import[^;]*\brequireClientAccess\b/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("has no caller outside app/client and app/api/client", () => {
    const offenders = walk(srcRoot)
      .filter((file) => !allowed.some((prefix) => file.startsWith(prefix)))
      .filter((file) => usesClientAccess.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(srcRoot, file));
    expect(offenders).toEqual([]);
  });
});
