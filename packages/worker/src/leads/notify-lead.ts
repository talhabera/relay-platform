import { and, eq, isNull, sql } from "drizzle-orm";
import { channels, companies, companyRecords, db, pushSubscriptions } from "@relay/db";
import { whatsappCredentials } from "../ai/channel-credentials";
import { sendMessage } from "../integrations/messaging";

export type NotifyOutcome =
  | "sent"
  | "push"
  | "already-notified"
  | "no-recipient"
  | "no-channel"
  | "failed";

interface NotifiableLead {
  name: string;
  phone: string | null;
  score: number | null;
  payload: Record<string, unknown>;
}

export interface ClaimedLead extends NotifiableLead {
  id: string;
  companyId: string;
  sourceAgentId: string | null;
}

/** Intake answers in stored order, then the fit score once there is one. */
export function formatLeadNotification(lead: NotifiableLead): string {
  const intake = lead.payload.intake;
  const answers =
    intake && typeof intake === "object" && !Array.isArray(intake)
      ? Object.entries(intake as Record<string, unknown>)
      : [];
  const lines = ["Yeni nitelikli lead", `Ad: ${lead.name}`];
  if (lead.phone) lines.push(`Telefon: ${lead.phone}`);
  for (const [key, value] of answers) {
    // The migrated 1-10 skor (x10) is the old agent's own rating, not a fit score.
    if (key === "skor" || value === null || value === undefined || value === "") continue;
    lines.push(`${key}: ${String(value)}`);
  }
  if (lead.score !== null) lines.push(`Skor: ${lead.score}/100`);
  return lines.join("\n");
}

async function ownerHasPushSubscription(companyId: string): Promise<boolean> {
  const company = await db.query.companies.findFirst({
    where: eq(companies.id, companyId),
  });
  if (!company?.ownerId) return false;
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, company.ownerId))
    .limit(1);
  return rows.length > 0;
}

/**
 * The WhatsApp branch, shared by the first notice and the unpushed backup
 * sweep. It only attempts the send: claiming and releasing stay with the
 * caller, so the sweep never touches `notified_at`. Never throws.
 */
export async function sendWhatsappNotice(
  claimedLead: ClaimedLead,
): Promise<Exclude<NotifyOutcome, "push" | "already-notified">> {
  const leadId = claimedLead.id;
  try {
    const company = await db.query.companies.findFirst({
      where: eq(companies.id, claimedLead.companyId),
    });
    const recipient = company?.leadNotifyWhatsapp;
    if (!recipient) return "no-recipient";

    const channel = claimedLead.sourceAgentId
      ? await db.query.channels.findFirst({
          where: and(
            eq(channels.agentId, claimedLead.sourceAgentId),
            eq(channels.type, "whatsapp"),
            eq(channels.status, "active"),
          ),
        })
      : undefined;
    const credentials = whatsappCredentials(channel?.config);
    if (!credentials) {
      console.warn("[Lead notify] no usable WhatsApp channel", leadId);
      return "no-channel";
    }

    const result = await sendMessage(
      "whatsapp",
      recipient.replace(/^\+/, ""),
      formatLeadNotification(claimedLead),
      credentials,
    );
    if (!result.success) {
      console.error("[Lead notify] send failed", leadId, result.error);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error("[Lead notify] unexpected failure", leadId, error);
    return "failed";
  }
}

/**
 * Raise the one "lead qualified" notice for the company owner (lead scoring
 * spec, decision 16): fires once a lead is qualified (fit >= 70 or a
 * borderline lead a person accepted).
 *
 * Push first: when the owner has a browser push subscription, the qualified
 * lead Needs you item is the notification and no WhatsApp is sent here. The
 * `payload.pushExpectedAt` stamp lets the backup sweep send WhatsApp only if
 * that push never lands. Without a subscription, the WhatsApp text is sent
 * from the sourcing agent's channel as before.
 *
 * This is a system notification, not an agent decision, so it does not go
 * through `checkpoints`. The UPDATE ... WHERE notified_at IS NULL is the
 * only thing that decides who sends: a second call finds no row and stops,
 * which also makes it safe across replicas. Every path that did not deliver
 * puts `notified_at` back to NULL so a later call can try again.
 *
 * Never throws: a failed notification must not fail the lead that caused it.
 */
export async function notifyQualifiedLead(
  leadId: string,
): Promise<NotifyOutcome> {
  const release = async () => {
    try {
      await db
        .update(companyRecords)
        .set({ notifiedAt: null })
        .where(eq(companyRecords.id, leadId));
    } catch (error) {
      console.error("[Lead notify] could not release the claim", leadId, error);
    }
  };

  try {
    const [claimed] = await db
      .update(companyRecords)
      .set({ notifiedAt: new Date() })
      .where(
        and(
          eq(companyRecords.id, leadId),
          eq(companyRecords.status, "qualified"),
          isNull(companyRecords.notifiedAt),
        ),
      )
      .returning();
    if (!claimed) return "already-notified";

    try {
      if (await ownerHasPushSubscription(claimed.companyId)) {
        await db
          .update(companyRecords)
          .set({
            payload: sql`coalesce(${companyRecords.payload}, '{}'::jsonb) || ${JSON.stringify(
              { pushExpectedAt: new Date().toISOString() },
            )}::jsonb`,
          })
          .where(eq(companyRecords.id, leadId));
        return "push";
      }
    } catch (error) {
      console.error("[Lead notify] unexpected failure", leadId, error);
      await release();
      return "failed";
    }

    const outcome = await sendWhatsappNotice(claimed);
    if (outcome !== "sent") await release();
    return outcome;
  } catch (error) {
    console.error("[Lead notify] could not claim", leadId, error);
    return "failed";
  }
}
