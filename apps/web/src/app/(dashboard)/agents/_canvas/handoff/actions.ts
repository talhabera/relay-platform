"use server";

import { revalidatePath } from "next/cache";

import { requireAgentAccess } from "@/lib/authorization";
import {
  checkTeamChatAvailabilityOnWorker,
  ensureTeamChatGroupOnWorker,
  requestRecipientConfirmationOnWorker,
  type RecipientConfirmationOutcome,
  type TeamChatGroupOutcome,
} from "@/lib/worker-proxy";

import type { TeamChatAvailability } from "./handoff-model";

/** Owner-only, customer agents only; ids are never taken from the client beyond the agent id. */
async function customerAgent(agentId: string) {
  const { agent } = await requireAgentAccess(agentId);
  if (agent.kind !== "customer") throw new Error("Only customer agents have human handoff");
  return agent;
}

/** Whether Team chat can be chosen. Read-only: never creates a group. */
export async function getTeamChatAvailability(agentId: string): Promise<TeamChatAvailability> {
  const agent = await customerAgent(agentId);
  const outcome = await checkTeamChatAvailabilityOnWorker({ agentId: agent.id, companyId: agent.companyId });
  if (outcome.available) return "available";
  return outcome.reason === "needs_oba" || outcome.reason === "no_sender" ? "needs_oba" : "unknown";
}

/** Create the agent's Team chat group once and return its invite link. */
export async function setUpTeamChatGroup(agentId: string): Promise<TeamChatGroupOutcome> {
  const agent = await customerAgent(agentId);
  const outcome = await ensureTeamChatGroupOnWorker({ agentId: agent.id, companyId: agent.companyId });
  revalidatePath("/agents");
  return outcome;
}

/** Send the one-time recipient confirmation again ("Confirmation sent · Resend"). */
export async function resendRecipientConfirmation(agentId: string): Promise<RecipientConfirmationOutcome> {
  const agent = await customerAgent(agentId);
  return requestRecipientConfirmationOnWorker({ agentId: agent.id, companyId: agent.companyId });
}
