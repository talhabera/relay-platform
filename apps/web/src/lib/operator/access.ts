import { db } from "@/db";
import {
  agents,
  chats,
  companies,
  companyMembers,
  operatorAgentEditors,
  type CompanyMemberRole,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth-server";
import {
  canApproveCheckpoint,
  isCompanyOwner as isCompanyOwnerForUser,
  requireCheckpointApprove as requireCheckpointApproveForUser,
  requireCompanyMembership as requireCompanyMembershipForUser,
  requireOperatorAgentAccess as requireOperatorAgentAccessForUser,
  requireOperatorAgentEdit as requireOperatorAgentEditForUser,
} from "@relay/agent-ops/auth/access";

export function isCompanyOwner(
  userId: string,
  company: { ownerId: string },
): boolean {
  return isCompanyOwnerForUser(userId, company);
}

/** Who the viewer is to a company, as `requireClientAccess` reports it. */
export type CompanyAccessRole = "owner" | CompanyMemberRole;

const NO_COMPANY_ACCESS = "Unauthorized: You don't have access to this company";

async function findMembership(userId: string, companyId: string) {
  return db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, companyId),
      eq(companyMembers.userId, userId),
    ),
  });
}

export async function requireCompanyMembership(companyId: string) {
  const session = await requireSession();
  const { company } = await requireCompanyMembershipForUser(
    session.user.id,
    companyId,
  );
  return { session, company };
}

export async function requireOperatorAgentAccess(agentId: string) {
  const session = await requireSession();
  const { agent } = await requireOperatorAgentAccessForUser(
    session.user.id,
    agentId,
  );
  return { session, agent };
}

export async function requireOperatorAgentEdit(agentId: string) {
  const session = await requireSession();
  const { agent } = await requireOperatorAgentEditForUser(
    session.user.id,
    agentId,
  );
  return { session, agent };
}

/**
 * Client portal access (`/client/*` pages and their APIs only). Passes for the
 * owner, members (read-only portal preview) and client users, and reports which
 * one the viewer is. `mutation: true` (e.g. Live's Answer now) passes client
 * users only.
 */
export async function requireClientAccess(
  companyId: string,
  options: { mutation?: boolean } = {},
) {
  const session = await requireSession();
  const userId = session.user.id;
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company) {
    throw new Error(NO_COMPANY_ACCESS);
  }

  let role: CompanyAccessRole;
  if (isCompanyOwner(userId, company)) {
    role = "owner";
  } else {
    const member = await findMembership(userId, companyId);
    if (!member) {
      throw new Error(NO_COMPANY_ACCESS);
    }
    role = member.role === "client" ? "client" : "member";
  }

  if (options.mutation && role !== "client") {
    throw new Error("Unauthorized: The client portal preview is read-only");
  }

  return { session, company, role };
}

/**
 * One membership per client user (decision 2). A client invite is refused when
 * the user already owns a company or holds any membership; a member invite is
 * refused when the user is a client somewhere. Owner-only invite is enforced by
 * the caller (`requireCompanyAccess`).
 */
export async function assertMembershipInviteAllowed(
  userId: string,
  role: CompanyMemberRole,
): Promise<void> {
  const memberships = await db.query.companyMembers.findMany({
    where: eq(companyMembers.userId, userId),
  });

  if (role === "client") {
    const owned = await db.query.companies.findMany({
      where: eq(companies.ownerId, userId),
      columns: { id: true },
    });
    if (memberships.length > 0 || owned.length > 0) {
      throw new Error(
        "A client user can hold only one membership; this user already belongs to a company",
      );
    }
    return;
  }

  if (memberships.some((membership) => membership.role === "client")) {
    throw new Error(
      "This user is a client of another company and cannot be added as a member",
    );
  }
}

// Member helpers above require `role = member`; the client-row refusal lives in
// @relay/agent-ops so the worker refuses client users too.

/**
 * Approve rights on an operator agent's checkpoints (spec
 * 2026-10-02-approve-rights): owner, agent creator, or a member with the
 * `operator` page permission and `canApprove`. Gates Approve, Reject, Retry and
 * Discard for session and Schedule checkpoints alike.
 */
export async function requireCheckpointApprove(agentId: string) {
  const session = await requireSession();
  const { agent } = await requireCheckpointApproveForUser(
    session.user.id,
    agentId,
  );
  return { session, agent };
}

/** Session checkpoints: delegates to the agent-level approve rule. */
export async function requireOperatorSessionApprove(chatId: string) {
  const session = await requireSession();
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat || chat.channelType !== "operator" || !chat.agentId) {
    throw new Error("Unauthorized: Invalid operator session");
  }

  const { agent } = await requireCheckpointApproveForUser(
    session.user.id,
    chat.agentId,
  );

  if (agent.companyId !== chat.companyId) {
    throw new Error("Unauthorized: Invalid operator session");
  }

  return { session, chat };
}

/** Chats that are a person's operator work, not a customer conversation. */
const NON_CUSTOMER_CHANNELS = new Set(["operator", "master"]);

/**
 * Approve rights on a card whose parent is a customer conversation (W3GAP2):
 * a lead_delivery card proposed on the lead's own chat (borderline accept,
 * legacy inbound). The same approve rule as every other card
 * (`canApproveCheckpoint`) against the proposing agent, which is usually the
 * customer agent, so there is no operator-kind check. Owner, agent creator,
 * or a member with the `operator` page permission and `canApprove` on that
 * agent; client users never pass. Operator chats keep
 * `requireOperatorSessionApprove`.
 */
export async function requireCustomerChatCheckpointApprove(checkpoint: {
  chatId: string;
  agentId: string;
  companyId: string;
}) {
  const session = await requireSession();
  const userId = session.user.id;
  const invalid = "Unauthorized: Invalid customer conversation checkpoint";

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, checkpoint.chatId),
  });
  if (
    !chat ||
    NON_CUSTOMER_CHANNELS.has(chat.channelType ?? "web") ||
    chat.companyId !== checkpoint.companyId
  ) {
    throw new Error(invalid);
  }

  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, checkpoint.agentId),
    with: { company: true },
  });
  if (!agent || agent.companyId !== checkpoint.companyId) {
    throw new Error(invalid);
  }

  const company = agent.company;
  if (isCompanyOwner(userId, company)) {
    return { session, chat, agent };
  }

  const membership = await findMembership(userId, checkpoint.companyId);
  const agentUser =
    membership && membership.role !== "client" && agent.createdByUserId !== userId
      ? await db.query.operatorAgentEditors.findFirst({
          where: and(
            eq(operatorAgentEditors.agentId, agent.id),
            eq(operatorAgentEditors.userId, userId),
          ),
        })
      : undefined;

  if (!canApproveCheckpoint({ userId, company, agent, membership, agentUser })) {
    throw new Error("Unauthorized: You can't approve this checkpoint");
  }

  return { session, chat, agent };
}
