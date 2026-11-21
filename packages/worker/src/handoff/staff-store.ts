import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  agentHandoffSettings,
  agents,
  channels,
  companies,
  db,
  handoffRequests,
} from "@relay/db";
import type { WhatsAppSenderCredentials } from "../integrations/whatsapp";
import type { HandoffSettingsRow } from "./store";

/**
 * Reads and writes behind staff notification (S35). Kept apart from
 * `store.ts`, which mirrors the web app's handoff rules line for line.
 */

/**
 * The company's WhatsApp sender: the active WhatsApp channel of the agent that
 * asked, else the company's oldest active one. Each company sends from its own
 * number with its own token; there is no Relay-wide sender.
 */
export async function findStaffSender(
  companyId: string,
  preferredAgentId: string | null,
): Promise<WhatsAppSenderCredentials | null> {
  const rows = await db
    .select({ agentId: channels.agentId, config: channels.config })
    .from(channels)
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(channels.type, "whatsapp"),
        eq(channels.status, "active"),
      ),
    )
    .orderBy(asc(channels.createdAt));

  const ordered = [
    ...rows.filter((row) => row.agentId === preferredAgentId),
    ...rows.filter((row) => row.agentId !== preferredAgentId),
  ];
  for (const row of ordered) {
    const { phoneNumberId, accessToken } = row.config ?? {};
    if (phoneNumberId && accessToken) return { phoneNumberId, accessToken };
  }
  return null;
}

/** Whether `phoneNumberId` is an active WhatsApp sender of this company. */
export async function isCompanySender(
  phoneNumberId: string,
  companyId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: channels.id })
    .from(channels)
    .innerJoin(agents, eq(agents.id, channels.agentId))
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(channels.type, "whatsapp"),
        eq(channels.status, "active"),
        sql`${channels.config}->>'phoneNumberId' = ${phoneNumberId}`,
      ),
    )
    .limit(1);
  return !!row;
}

export async function getCompanyName(companyId: string): Promise<string | null> {
  const row = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
    columns: { name: true },
  });
  return row?.name ?? null;
}

/** The agent's saved settings row, or null when it has none (no recipient). */
export async function getHandoffSettingsRow(
  agentId: string,
): Promise<HandoffSettingsRow | null> {
  const [row] = await db
    .select()
    .from(agentHandoffSettings)
    .where(eq(agentHandoffSettings.agentId, agentId))
    .limit(1);
  return row ?? null;
}

/**
 * First accepted notification only; a retry never moves the timestamp. The
 * wamid is stored with status `sent` so the WhatsApp webhook's statuses[] can
 * find the request and move its delivery status forward.
 */
export async function markHandoffNotified(
  requestId: string,
  at: Date,
  providerMessageId: string | null = null,
): Promise<void> {
  await db
    .update(handoffRequests)
    .set({
      notifiedAt: at,
      updatedAt: at,
      ...(providerMessageId
        ? {
            notificationMessageId: providerMessageId,
            notificationStatus: "sent" as const,
            notificationStatusAt: at,
            notificationError: null,
          }
        : {}),
    })
    .where(and(eq(handoffRequests.id, requestId), isNull(handoffRequests.notifiedAt)));
}

/**
 * Confirm the recipient, but only if the number on file is still the one the
 * confirmation was for: a number changed in between stays unconfirmed.
 */
export async function confirmRecipient(input: {
  agentId: string;
  companyId: string;
  recipientWhatsapp: string;
  now: Date;
}): Promise<boolean> {
  const rows = await db
    .update(agentHandoffSettings)
    .set({
      recipientConfirmed: true,
      recipientConfirmedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(agentHandoffSettings.agentId, input.agentId),
        eq(agentHandoffSettings.companyId, input.companyId),
        eq(agentHandoffSettings.recipientWhatsapp, input.recipientWhatsapp),
        eq(agentHandoffSettings.recipientConfirmed, false),
      ),
    )
    .returning({ agentId: agentHandoffSettings.agentId });
  return rows.length > 0;
}
