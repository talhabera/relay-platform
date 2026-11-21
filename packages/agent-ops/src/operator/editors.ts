import { and, eq } from "drizzle-orm";
import { companyMembers, db, operatorAgentEditors } from "@relay/db";
import {
  isCompanyOwner,
  requireOperatorAgentAccess,
  requireOperatorAgentEdit,
} from "../auth/access";

// Agent users (spec 2026-10-02-approve-rights): one row per person on an
// operator agent with independent `canEdit` / `canApprove` flags. Edit grants
// keep today's rule (anyone with edit); approve grants are owner-only.

async function assertTargetCompanyMembership(
  companyId: string,
  targetUserId: string,
  company: { id: string; ownerId: string },
) {
  if (isCompanyOwner(targetUserId, company)) {
    return;
  }

  const member = await db.query.companyMembers.findFirst({
    where: and(
      eq(companyMembers.companyId, companyId),
      eq(companyMembers.userId, targetUserId),
    ),
  });

  if (!member) {
    throw new Error("User is not a member of this company");
  }

  if (member.role === "client") {
    throw new Error("Client users cannot be agent users");
  }
}

/** Drops rows left with neither flag, so "no row" keeps meaning "no rights". */
async function deleteEmptyAgentUser(agentId: string, targetUserId: string) {
  await db
    .delete(operatorAgentEditors)
    .where(
      and(
        eq(operatorAgentEditors.agentId, agentId),
        eq(operatorAgentEditors.userId, targetUserId),
        eq(operatorAgentEditors.canEdit, false),
        eq(operatorAgentEditors.canApprove, false),
      ),
    );
}

async function setFlag(
  agentId: string,
  targetUserId: string,
  flag: "canEdit" | "canApprove",
  value: boolean,
) {
  await db
    .update(operatorAgentEditors)
    .set(flag === "canEdit" ? { canEdit: value } : { canApprove: value })
    .where(
      and(
        eq(operatorAgentEditors.agentId, agentId),
        eq(operatorAgentEditors.userId, targetUserId),
      ),
    );
}

export async function listEditors(userId: string, agentId: string) {
  await requireOperatorAgentAccess(userId, agentId);

  const agentUsers = await db.query.operatorAgentEditors.findMany({
    where: eq(operatorAgentEditors.agentId, agentId),
    with: { user: true },
  });

  return agentUsers.map((agentUser) => ({
    userId: agentUser.userId,
    name: agentUser.user.name,
    email: agentUser.user.email,
    canEdit: agentUser.canEdit,
    canApprove: agentUser.canApprove,
  }));
}

export async function grantEditor(
  userId: string,
  agentId: string,
  targetUserId: string,
) {
  const { agent } = await requireOperatorAgentEdit(userId, agentId);

  if (targetUserId === agent.createdByUserId) {
    throw new Error("Agent creator already has edit");
  }

  await assertTargetCompanyMembership(
    agent.companyId,
    targetUserId,
    agent.company,
  );

  await db
    .insert(operatorAgentEditors)
    .values({
      agentId,
      userId: targetUserId,
      canEdit: true,
      canApprove: false,
      grantedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [operatorAgentEditors.agentId, operatorAgentEditors.userId],
      set: { canEdit: true },
    });
}

export async function revokeEditor(
  userId: string,
  agentId: string,
  targetUserId: string,
) {
  await requireOperatorAgentEdit(userId, agentId);

  await setFlag(agentId, targetUserId, "canEdit", false);
  await deleteEmptyAgentUser(agentId, targetUserId);
}

async function requireApproveGrantor(userId: string, agentId: string) {
  const { agent } = await requireOperatorAgentAccess(userId, agentId);

  if (!isCompanyOwner(userId, agent.company)) {
    throw new Error(
      "Unauthorized: Only the company owner can grant or revoke approve",
    );
  }

  return { agent };
}

export async function grantApprover(
  userId: string,
  agentId: string,
  targetUserId: string,
) {
  const { agent } = await requireApproveGrantor(userId, agentId);

  if (isCompanyOwner(targetUserId, agent.company)) {
    throw new Error("Owner already approves");
  }

  if (targetUserId === agent.createdByUserId) {
    throw new Error("Agent creator already approves");
  }

  await assertTargetCompanyMembership(
    agent.companyId,
    targetUserId,
    agent.company,
  );

  await db
    .insert(operatorAgentEditors)
    .values({
      agentId,
      userId: targetUserId,
      canEdit: false,
      canApprove: true,
      grantedByUserId: userId,
    })
    .onConflictDoUpdate({
      target: [operatorAgentEditors.agentId, operatorAgentEditors.userId],
      set: { canApprove: true },
    });
}

export async function revokeApprover(
  userId: string,
  agentId: string,
  targetUserId: string,
) {
  await requireApproveGrantor(userId, agentId);

  await setFlag(agentId, targetUserId, "canApprove", false);
  await deleteEmptyAgentUser(agentId, targetUserId);
}
