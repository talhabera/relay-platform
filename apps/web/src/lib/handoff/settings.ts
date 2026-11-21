import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { agentHandoffSettings } from "@/db/schema";
import type { HandoffSettings } from "./validators";

type SettingsRow = typeof agentHandoffSettings.$inferSelect;
type SettingsInsert = typeof agentHandoffSettings.$inferInsert;

/** `agent` must come from `requireAgentAccess`; ids are never taken from the client. */
export interface HandoffAgentScope {
  id: string;
  companyId: string;
}

/** What an agent with no settings row behaves as. Mirrors the column defaults. */
export function defaultHandoffSettings(agent: HandoffAgentScope): SettingsRow {
  const epoch = new Date(0);
  return {
    agentId: agent.id,
    companyId: agent.companyId,
    mode: "quick_answer",
    triggerPriceNotListed: true,
    triggerAsksForPerson: true,
    triggerComplaintOrRefund: true,
    triggerLowConfidence: true,
    recipientName: null,
    recipientWhatsapp: null,
    recipientConfirmed: false,
    recipientConfirmedAt: null,
    expiryMinutes: 120,
    defaultReply: "agent",
    recipientCanTakeOver: false,
    waitingText: null,
    ifNobodyAnswers: "reply_here",
    createdAt: epoch,
    updatedAt: epoch,
  };
}

export async function getAgentHandoffSettings(
  agent: HandoffAgentScope,
): Promise<SettingsRow> {
  const [row] = await db
    .select()
    .from(agentHandoffSettings)
    .where(
      and(
        eq(agentHandoffSettings.agentId, agent.id),
        eq(agentHandoffSettings.companyId, agent.companyId),
      ),
    )
    .limit(1);
  return row ?? defaultHandoffSettings(agent);
}

/**
 * The row to store for a settings save. A changed (or cleared) WhatsApp number
 * is unconfirmed again: requests go to the Inbox until the new recipient
 * confirms, and `needsConfirmation` tells the caller to send the one-time
 * confirmation message.
 */
export function buildHandoffSettingsWrite(
  agent: HandoffAgentScope,
  input: HandoffSettings,
  previous: Pick<
    SettingsRow,
    "recipientWhatsapp" | "recipientConfirmed" | "recipientConfirmedAt"
  >,
  now: Date,
): { values: SettingsInsert; needsConfirmation: boolean } {
  const numberChanged = input.recipientWhatsapp !== previous.recipientWhatsapp;
  const confirmed = !numberChanged && previous.recipientConfirmed;

  return {
    values: {
      agentId: agent.id,
      companyId: agent.companyId,
      mode: input.mode,
      triggerPriceNotListed: input.triggers.priceNotListed,
      triggerAsksForPerson: input.triggers.asksForPerson,
      triggerComplaintOrRefund: input.triggers.complaintOrRefund,
      triggerLowConfidence: input.triggers.lowConfidence,
      recipientName: input.recipientName,
      recipientWhatsapp: input.recipientWhatsapp,
      recipientConfirmed: confirmed,
      recipientConfirmedAt: confirmed ? previous.recipientConfirmedAt : null,
      expiryMinutes: input.expiryMinutes,
      defaultReply: input.defaultReply,
      recipientCanTakeOver: input.recipientCanTakeOver,
      waitingText: input.waitingText,
      ifNobodyAnswers: input.ifNobodyAnswers,
      updatedAt: now,
    },
    needsConfirmation:
      numberChanged &&
      input.recipientWhatsapp !== null &&
      input.mode !== "team_chat",
  };
}

export async function saveAgentHandoffSettings(
  agent: HandoffAgentScope,
  input: HandoffSettings,
  now: Date = new Date(),
) {
  const previous = await getAgentHandoffSettings(agent);
  const { values, needsConfirmation } = buildHandoffSettingsWrite(
    agent,
    input,
    previous,
    now,
  );
  const { agentId: _agentId, companyId: _companyId, ...update } = values;

  const [row] = await db
    .insert(agentHandoffSettings)
    .values(values)
    .onConflictDoUpdate({ target: agentHandoffSettings.agentId, set: update })
    .returning();

  return { settings: row, needsConfirmation };
}

/**
 * The recipient confirmed. Matching the number as well as the agent means a
 * late confirmation of a replaced number confirms nothing.
 */
export async function confirmHandoffRecipient(
  agentId: string,
  whatsapp: string,
  now: Date = new Date(),
): Promise<boolean> {
  const rows = await db
    .update(agentHandoffSettings)
    .set({ recipientConfirmed: true, recipientConfirmedAt: now, updatedAt: now })
    .where(
      and(
        eq(agentHandoffSettings.agentId, agentId),
        eq(agentHandoffSettings.recipientWhatsapp, whatsapp),
      ),
    )
    .returning({ agentId: agentHandoffSettings.agentId });
  return rows.length > 0;
}
