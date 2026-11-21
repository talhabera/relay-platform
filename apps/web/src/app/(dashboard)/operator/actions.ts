"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { agentVersions, chats } from "@/db/schema";
import { createChatSession, updateChatTitle } from "@/lib/ai/chat-persistence";
import { requireSession } from "@/lib/auth-server";
import { requireOperatorAgentAccess } from "@/lib/operator/access";
import {
  createOperatorAgent as createOperatorAgentOp,
  forkOperatorVersion as forkOperatorVersionOp,
  updateOperatorVersion as updateOperatorVersionOp,
  promoteOperatorVersion as promoteOperatorVersionOp,
  grantEditor,
  revokeEditor,
  grantApprover,
  revokeApprover,
} from "@relay/agent-ops";
import { operatorRole } from "@/components/agent/agent-templates";
import {
  createOperatorAgentDialogSchema,
  renameOperatorSessionSchema,
  type CreateOperatorAgentDialogInput,
  type CreateOperatorAgentInput,
  type UpdateOperatorVersionInput,
} from "@/lib/validators/operator";

export async function createOperatorAgent(data: CreateOperatorAgentInput) {
  const session = await requireSession();
  const result = await createOperatorAgentOp(session.user.id, data);
  revalidatePath("/operator");
  return result;
}

/** Create operator agent dialog: create v1, then apply the model and the pre-defined role's instructions. */
export async function createOperatorAgentFromDialog(data: CreateOperatorAgentDialogInput) {
  const session = await requireSession();
  const parsed = createOperatorAgentDialogSchema.parse(data);
  const result = await createOperatorAgentOp(session.user.id, {
    companyId: parsed.companyId,
    name: parsed.name,
    description: parsed.description?.trim() || undefined,
  });
  const role = parsed.role ? operatorRole(parsed.role) : undefined;
  await updateOperatorVersionOp(session.user.id, result.versionId, {
    model: parsed.model,
    ...(role ? { instructions: role.instructions } : {}),
  });
  revalidatePath("/operator");
  return result;
}

export async function forkOperatorVersion(
  agentId: string,
  parentVersionId: string,
  name: string,
  changeNote?: string,
) {
  const session = await requireSession();
  const result = await forkOperatorVersionOp(
    session.user.id,
    agentId,
    parentVersionId,
    name,
    changeNote,
  );
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
  return result;
}

export async function updateOperatorVersion(
  versionId: string,
  data: UpdateOperatorVersionInput,
) {
  const session = await requireSession();
  await updateOperatorVersionOp(session.user.id, versionId, data);
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
}

export async function promoteOperatorVersion(versionId: string) {
  const session = await requireSession();
  await promoteOperatorVersionOp(session.user.id, versionId);
  revalidatePath("/operator");
  revalidatePath("/agents/operator");
  revalidatePath("/home");
}

/** Access tab Edit toggle (and Add person): anyone with edit on the agent grants or revokes edit. */
export async function setOperatorAgentUserEdit(agentId: string, userId: string, on: boolean) {
  const session = await requireSession();
  if (on) await grantEditor(session.user.id, agentId, userId);
  else await revokeEditor(session.user.id, agentId, userId);
  revalidatePath("/agents/operator");
}

/** Access tab Approve toggle: owner-only, enforced by `grantApprover` / `revokeApprover`. */
export async function setOperatorAgentUserApprove(agentId: string, userId: string, on: boolean) {
  const session = await requireSession();
  if (on) await grantApprover(session.user.id, agentId, userId);
  else await revokeApprover(session.user.id, agentId, userId);
  revalidatePath("/agents/operator");
}

export async function createOperatorSession({
  agentId,
  versionId,
  title,
}: {
  agentId: string;
  versionId: string;
  title?: string;
}) {
  const { session, agent } = await requireOperatorAgentAccess(agentId);

  const version = await db.query.agentVersions.findFirst({
    where: eq(agentVersions.id, versionId),
  });

  if (!version || version.agentId !== agentId) {
    throw new Error("Version not found");
  }

  const chatId = await createChatSession(
    session.user.id,
    agent.companyId,
    agentId,
    title?.trim() || "Untitled session",
    undefined,
    "operator",
    versionId,
  );

  revalidatePath("/operator");

  return { chatId };
}

export async function renameOperatorSession(chatId: string, title: string) {
  const session = await requireSession();
  const parsed = renameOperatorSessionSchema.parse({ title });

  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
  });

  if (!chat || chat.channelType !== "operator") {
    throw new Error("Session not found");
  }

  if (chat.userId !== session.user.id) {
    throw new Error("Unauthorized: You can only rename your own sessions");
  }

  await updateChatTitle(chatId, parsed.title);

  revalidatePath("/operator");
}
