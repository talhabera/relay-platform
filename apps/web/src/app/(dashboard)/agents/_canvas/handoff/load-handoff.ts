import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { handoffRequests, handoffTeamChatGroups } from "@/db/schema";
import { getAgentHandoffSettings, type HandoffAgentScope } from "@/lib/handoff/settings";

import { toExpiryMinutes, type HandoffPanelData } from "./handoff-model";

/** Handoff node + inspector data for one customer agent of the active company. */
export async function loadHandoffPanel(agent: HandoffAgentScope): Promise<HandoffPanelData> {
  const [settings, [group], [latest]] = await Promise.all([
    getAgentHandoffSettings(agent),
    db
      .select({
        status: handoffTeamChatGroups.status,
        subject: handoffTeamChatGroups.subject,
        inviteLink: handoffTeamChatGroups.inviteLink,
      })
      .from(handoffTeamChatGroups)
      .where(
        and(
          eq(handoffTeamChatGroups.agentId, agent.id),
          eq(handoffTeamChatGroups.companyId, agent.companyId),
        ),
      )
      .limit(1),
    db
      .select({
        status: handoffRequests.status,
        recipientName: handoffRequests.recipientName,
        handedBackAt: handoffRequests.handedBackAt,
        handBackReason: handoffRequests.handBackReason,
      })
      .from(handoffRequests)
      .where(and(eq(handoffRequests.agentId, agent.id), eq(handoffRequests.companyId, agent.companyId)))
      .orderBy(desc(handoffRequests.updatedAt))
      .limit(1),
  ]);

  return {
    settings: {
      mode: settings.mode,
      triggers: {
        priceNotListed: settings.triggerPriceNotListed,
        asksForPerson: settings.triggerAsksForPerson,
        complaintOrRefund: settings.triggerComplaintOrRefund,
        lowConfidence: settings.triggerLowConfidence,
      },
      recipientName: settings.recipientName,
      recipientWhatsapp: settings.recipientWhatsapp,
      recipientConfirmed: settings.recipientConfirmed,
      expiryMinutes: toExpiryMinutes(settings.expiryMinutes),
      defaultReply: settings.defaultReply,
      recipientCanTakeOver: settings.recipientCanTakeOver,
      waitingText: settings.waitingText,
      ifNobodyAnswers: settings.ifNobodyAnswers,
    },
    group: group ?? null,
    latest: latest ?? null,
  };
}
