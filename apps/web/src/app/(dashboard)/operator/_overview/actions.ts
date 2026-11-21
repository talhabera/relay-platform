"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { agentVersions } from "@/db/schema";
import { createChatSession, saveUserMessage } from "@/lib/ai/chat-persistence";
import { requireOperatorAgentAccess } from "@/lib/operator/access";

import { briefTitle } from "./overview-model";

const startOperatorSessionSchema = z.object({
  agentId: z.string().uuid(),
  versionId: z.string().uuid(),
  brief: z.string().trim().max(4000).default(""),
});

export type StartOperatorSessionInput = z.input<typeof startOperatorSessionSchema>;

/**
 * New-session dialog: one session with one pre-defined agent. The brief is the
 * session's first user message; the session view sends it to the agent on open
 * (OperatorChat `autoContinueOnUserOnlyHistory`).
 */
export async function startOperatorSession(input: StartOperatorSessionInput) {
  const { agentId, versionId, brief } = startOperatorSessionSchema.parse(input);
  const { session, agent } = await requireOperatorAgentAccess(agentId);

  const version = await db.query.agentVersions.findFirst({
    where: eq(agentVersions.id, versionId),
    columns: { id: true, agentId: true },
  });
  if (!version || version.agentId !== agentId) {
    throw new Error("Version not found");
  }

  const chatId = await createChatSession(
    session.user.id,
    agent.companyId,
    agentId,
    briefTitle(brief),
    undefined,
    "operator",
    versionId,
  );
  if (brief) await saveUserMessage(chatId, brief);

  revalidatePath("/operator");

  return { chatId, agentId, versionId };
}
