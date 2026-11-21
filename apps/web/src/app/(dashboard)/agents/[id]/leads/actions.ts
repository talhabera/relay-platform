"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { companies } from "@/db/schema";
import { requireAgentAccess } from "@/lib/authorization";
import {
  leadNotifyNumberSchema,
  type LeadNotifyNumberInput,
} from "@/lib/validators/lead-settings";

/**
 * Owner-only. The company id is read from the agent that
 * `requireAgentAccess` authorised, never from the client.
 */
export async function updateLeadNotifyNumber(
  agentId: string,
  input: LeadNotifyNumberInput,
) {
  const { agent } = await requireAgentAccess(agentId);
  if (agent.kind === "operator") {
    throw new Error("Operator agents do not have leads");
  }

  const { whatsapp } = leadNotifyNumberSchema.parse(input);

  await db
    .update(companies)
    .set({ leadNotifyWhatsapp: whatsapp })
    .where(eq(companies.id, agent.companyId));

  revalidatePath(`/agents/${agentId}/leads`);
  return { whatsapp };
}
