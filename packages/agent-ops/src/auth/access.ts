import { and, eq } from "drizzle-orm";
import {
  agents,
  companies,
  companyMembers,
  db,
  operatorAgentEditors,
} from "@relay/db";

export function isCompanyOwner(
  userId: string,
  company: { ownerId: string },
): boolean {
  return company.ownerId === userId;
}

const NO_COMPANY_ACCESS = "Unauthorized: You don't have access to this company";

async function findMembership(userId: string, companyId: string) {
  return db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, companyId),
      eq(companyMembers.userId, userId),
    ),
  });
}

type Membership = Awaited<ReturnType<typeof findMembership>>;

/**
 * Owner, or a `role = member` row. A `client` row fails every member helper
 * (spec 2026-10-02-client-role-and-portal, decision 6), here so the web app
 * and the worker refuse client users alike.
 */
async function resolveMembership(userId: string, companyId: string) {
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });

  if (!company) {
    throw new Error(NO_COMPANY_ACCESS);
  }

  if (company.ownerId === userId) {
    return { company, membership: undefined as Membership };
  }

  const membership = await findMembership(userId, companyId);

  if (!membership || membership.role === "client") {
    throw new Error(NO_COMPANY_ACCESS);
  }

  return { company, membership };
}

export async function requireCompanyMembership(
  userId: string,
  companyId: string,
) {
  const { company } = await resolveMembership(userId, companyId);
  return { userId, company };
}

export async function requireCompanyAccess(userId: string, companyId: string) {
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company || company.ownerId !== userId) {
    throw new Error("Unauthorized: You don't have access to this company");
  }
  return { userId, company };
}

export async function requireAgentAccess(userId: string, agentId: string) {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: { company: true },
  });
  if (!agent || agent.company.ownerId !== userId) {
    throw new Error("Unauthorized: You don't have access to this agent");
  }
  return { userId, agent };
}

export async function requireOperatorAgentAccess(
  userId: string,
  agentId: string,
) {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: { company: true },
  });

  if (!agent) {
    throw new Error("Unauthorized: You don't have access to this agent");
  }

  if (agent.kind !== "operator") {
    throw new Error("Unauthorized: This agent is not an operator agent");
  }

  await requireCompanyMembership(userId, agent.companyId);

  return { userId, agent };
}

async function findAgentUser(userId: string, agentId: string) {
  return db.query.operatorAgentEditors.findFirst({
    where: and(
      eq(operatorAgentEditors.agentId, agentId),
      eq(operatorAgentEditors.userId, userId),
    ),
  });
}

export async function requireOperatorAgentEdit(userId: string, agentId: string) {
  const { agent } = await requireOperatorAgentAccess(userId, agentId);

  if (agent.createdByUserId === userId) {
    return { userId, agent };
  }

  const agentUser = await findAgentUser(userId, agentId);

  if (agentUser?.canEdit !== true) {
    throw new Error(
      "Unauthorized: You don't have edit access to this operator agent",
    );
  }

  return { userId, agent };
}

/**
 * The one approve rule for every checkpoint, session and Schedule alike (spec
 * 2026-10-02-approve-rights, decision 2): the company owner, or the agent
 * creator, or a `role = member` with the `operator` page permission and
 * `canApprove` on the agent. Client users never pass.
 */
export function canApproveCheckpoint(args: {
  userId: string;
  company: { ownerId: string };
  agent: { createdByUserId: string | null };
  membership:
    | { role?: string | null; pagePermissions?: unknown }
    | null
    | undefined;
  agentUser: { canApprove?: boolean | null } | null | undefined;
}): boolean {
  if (isCompanyOwner(args.userId, args.company)) return true;
  if (!args.membership || args.membership.role === "client") return false;
  if (args.agent.createdByUserId === args.userId) return true;
  const permissions = args.membership.pagePermissions as
    | { operator?: unknown }
    | null
    | undefined;
  return permissions?.operator === true && args.agentUser?.canApprove === true;
}

export async function requireCheckpointApprove(
  userId: string,
  agentId: string,
) {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: { company: true },
  });

  if (!agent) {
    throw new Error("Unauthorized: You don't have access to this agent");
  }

  if (agent.kind !== "operator") {
    throw new Error("Unauthorized: This agent is not an operator agent");
  }

  const { company, membership } = await resolveMembership(
    userId,
    agent.companyId,
  );

  const needsAgentUser =
    !isCompanyOwner(userId, company) && agent.createdByUserId !== userId;
  const agentUser = needsAgentUser
    ? await findAgentUser(userId, agentId)
    : undefined;

  if (!canApproveCheckpoint({ userId, company, agent, membership, agentUser })) {
    throw new Error(
      "Unauthorized: You can't approve checkpoints on this operator agent",
    );
  }

  return { userId, agent };
}
