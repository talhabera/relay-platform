"use server";

import { revalidatePath } from "next/cache";
import { requireAgentAccess } from "@/lib/authorization";
import {
  requestRecipientConfirmationOnWorker,
  type RecipientConfirmationOutcome,
} from "@/lib/worker-proxy";
import {
  answerHandoffRequest,
  closeHandoffLink,
  handBackHandoffRequest,
  sendTakeoverMessage,
  takeOverHandoffRequest,
} from "./requests";
import { saveAgentHandoffSettings } from "./settings";
import {
  handoffAnswerSchema,
  handoffSettingsSchema,
  type HandoffAnswerInput,
  type HandoffSettingsInput,
} from "./validators";

/**
 * Owner-only, customer agents only. The company id comes from the agent that
 * `requireAgentAccess` authorised, never from the client. `needsConfirmation`
 * tells the UI a confirmation message is due for the new number; the worker
 * is then asked to send it, and `confirmation` reports what happened (null
 * when no message was due). The save stands whatever the worker answers.
 */
export async function updateHandoffSettings(
  agentId: string,
  input: HandoffSettingsInput,
) {
  const { agent } = await requireAgentAccess(agentId);
  if (agent.kind !== "customer") {
    throw new Error("Only customer agents have human handoff");
  }
  const parsed = handoffSettingsSchema.parse(input);
  const result = await saveAgentHandoffSettings(agent, parsed);
  revalidatePath(`/agents/${agentId}`);
  const confirmation: RecipientConfirmationOutcome | null = result.needsConfirmation
    ? await requestRecipientConfirmationOnWorker({
        agentId: agent.id,
        companyId: agent.companyId,
      })
    : null;
  return { ...result, confirmation };
}

// Quick-link actions. The link token is the credential: the recipient may be
// someone outside the company with no session.

export async function answerHandoff(token: string, input: HandoffAnswerInput) {
  return answerHandoffRequest(token, handoffAnswerSchema.parse(input));
}

export async function takeOverHandoff(token: string) {
  return takeOverHandoffRequest(token);
}

export async function sendHandoffTakeoverMessage(token: string, text: string) {
  const parsed = handoffAnswerSchema.shape.text.parse(text);
  return sendTakeoverMessage(token, parsed);
}

export async function handBackHandoff(token: string) {
  return handBackHandoffRequest(token);
}

export async function closeHandoff(token: string) {
  return closeHandoffLink(token);
}
