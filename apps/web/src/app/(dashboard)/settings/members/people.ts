import { canApproveCheckpoint } from "@relay/agent-ops/auth/access";
import {
  normalizePagePermissions,
  OWNER_PAGE_PERMISSIONS,
  type CompanyMemberRole,
  type PagePermissions,
} from "@/db/schema";

/**
 * One person on the active company, as Settings › Members and Settings › Access & roles show
 * them (Figma 08c members, members-approves-on, access). Pure: the page loads the rows.
 */
export type CompanyPerson = {
  userId: string;
  name: string;
  email: string;
  kind: "owner" | CompanyMemberRole;
  /** Chip label: Owner, Member or Client. */
  roleLabel: string;
  /** Owner: every page. Client: none (a client row's pagePermissions are never read). */
  pagePermissions: PagePermissions | null;
  /**
   * Read-only "Approves on" line (approve-rights spec decision 10). Null for client users, who
   * never approve. The owner approves on every operator agent.
   */
  approvesOn: string | null;
  /** True when the person can approve on at least one operator agent. */
  approvesAny: boolean;
  /** Membership added at (owner: null). */
  addedAt: Date | null;
  /** Remove-dialog body (Figma members-remove). Owner: null (cannot be removed). */
  removeCopy: string | null;
};

export type PeopleInput = {
  company: { ownerId: string; name: string };
  owner: { id: string; name: string; email: string };
  members: {
    userId: string;
    role: CompanyMemberRole | null;
    pagePermissions: unknown;
    createdAt: Date | null;
    user: { name: string; email: string };
  }[];
  /** The company's operator agents. */
  agents: { id: string; name: string; createdByUserId: string | null }[];
  /** Agent user rows (`operator_agent_editors`) on those agents. */
  agentUsers: { agentId: string; userId: string; canApprove: boolean }[];
};

export const OWNER_APPROVES_ON = "Every operator agent (company owner)";
export const APPROVES_ON_NONE = "None";

const ROLE_LABEL: Record<CompanyMemberRole, string> = {
  member: "Member",
  client: "Client",
};

/** Owner first, then members, then client users; each group in membership order. */
export function buildCompanyPeople(input: PeopleInput): CompanyPerson[] {
  return orderPeople(input).map((p) => ({
    ...p,
    removeCopy: p.kind === "owner" ? null : removeConsequence(p, input.company.name),
  }));
}

function orderPeople(input: PeopleInput): Omit<CompanyPerson, "removeCopy">[] {
  const { company, owner, members, agents, agentUsers } = input;

  const owners: Omit<CompanyPerson, "removeCopy"> = {
    userId: owner.id,
    name: owner.name,
    email: owner.email,
    kind: "owner",
    roleLabel: "Owner",
    pagePermissions: OWNER_PAGE_PERMISSIONS,
    approvesOn: OWNER_APPROVES_ON,
    approvesAny: true,
    addedAt: null,
  };

  const rows = members
    .filter((m) => m.userId !== company.ownerId)
    .map((m): Omit<CompanyPerson, "removeCopy"> => {
      const role: CompanyMemberRole = m.role === "client" ? "client" : "member";
      if (role === "client") {
        return {
          userId: m.userId,
          name: m.user.name,
          email: m.user.email,
          kind: "client",
          roleLabel: ROLE_LABEL.client,
          pagePermissions: null,
          approvesOn: null,
          approvesAny: false,
          addedAt: m.createdAt,
        };
      }
      const membership = { role, pagePermissions: m.pagePermissions };
      const approved = agents.filter((agent) =>
        canApproveCheckpoint({
          userId: m.userId,
          company,
          agent,
          membership,
          agentUser: agentUsers.find(
            (u) => u.agentId === agent.id && u.userId === m.userId,
          ),
        }),
      );
      return {
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        kind: "member",
        roleLabel: ROLE_LABEL.member,
        pagePermissions: normalizePagePermissions(
          m.pagePermissions as Partial<PagePermissions> | null,
        ),
        approvesOn:
          approved.length > 0
            ? approved.map((a) => a.name).join(", ")
            : APPROVES_ON_NONE,
        approvesAny: approved.length > 0,
        addedAt: m.createdAt,
      };
    });

  return [
    owners,
    ...rows.filter((r) => r.kind === "member"),
    ...rows.filter((r) => r.kind === "client"),
  ];
}

/** Remove-dialog copy (Figma members-remove): which pages the person loses. */
export function removeConsequence(
  person: Pick<CompanyPerson, "name" | "kind" | "pagePermissions">,
  companyName: string): string {
  const first = person.name.split(" ")[0] || person.name;
  if (person.kind === "client") {
    return `${first} loses access to the client portal for ${companyName}.`;
  }
  const perms = person.pagePermissions;
  const pages = [
    perms?.operator && "Operator",
    perms?.messaging && "Inbox",
    perms?.analytics && "Analytics",
    perms?.agents && "Agents",
  ].filter((p): p is string => Boolean(p));
  const lost =
    pages.length === 0
      ? "Home"
      : pages.length === 1
        ? pages[0]
        : `${pages.slice(0, -1).join(", ")} and ${pages[pages.length - 1]}`;
  return `${first} loses access to ${lost} for ${companyName}. Sessions ${first} started stay in the history.`;
}
