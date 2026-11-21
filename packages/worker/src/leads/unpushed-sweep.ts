import { and, eq, gt, lt, sql } from "drizzle-orm";
import { companyRecords, db, pushDeliveries } from "@relay/db";
import { sendWhatsappNotice, type ClaimedLead } from "./notify-lead";

const BACKUP_AFTER_MS = 3 * 60_000;
const BACKUP_WINDOW_MS = 24 * 60 * 60_000;
const SWEEP_LIMIT = 50;

function payloadOf(lead: ClaimedLead): Record<string, unknown> {
  return lead.payload && typeof lead.payload === "object" ? lead.payload : {};
}

/**
 * WhatsApp backup for a qualified lead whose push was expected but never
 * landed: claimed with `pushExpectedAt`, old enough that the 30 s push
 * dispatcher had its chance, young enough to still matter, and with no
 * `push_deliveries` row for `lead:<id>`. A lead notified by WhatsApp in the
 * first place (or a historical lead) has no `pushExpectedAt` and never
 * matches, so it is never sent twice.
 *
 * `whatsappBackupAt` is stamped before sending, guarded on its absence, so
 * two ticks cannot both send; the stamp is released when the send does not
 * go out, so a later tick can retry. Returns how many backups were sent.
 */
export async function sweepUnpushedQualifiedLeads(now: Date): Promise<number> {
  const backupAfter = new Date(now.getTime() - BACKUP_AFTER_MS);
  const windowStart = new Date(now.getTime() - BACKUP_WINDOW_MS);

  const found = await db.query.companyRecords.findMany({
    where: and(
      eq(companyRecords.status, "qualified"),
      sql`${companyRecords.payload} ? 'pushExpectedAt'`,
      sql`NOT (${companyRecords.payload} ? 'whatsappBackupAt')`,
      lt(companyRecords.notifiedAt, backupAfter),
      gt(companyRecords.notifiedAt, windowStart),
    ),
    limit: SWEEP_LIMIT,
  });
  const candidates = (Array.isArray(found) ? found : []) as (ClaimedLead & {
    status: string;
    notifiedAt: Date | string | null;
  })[];

  let sent = 0;
  for (const lead of candidates) {
    const payload = payloadOf(lead);
    if (lead.status !== "qualified") continue;
    if (!("pushExpectedAt" in payload) || "whatsappBackupAt" in payload) continue;
    if (!lead.notifiedAt) continue;
    const notifiedAt = new Date(lead.notifiedAt).getTime();
    if (notifiedAt >= backupAfter.getTime() || notifiedAt <= windowStart.getTime()) continue;

    const deliveries = await db
      .select({ itemId: pushDeliveries.itemId })
      .from(pushDeliveries)
      .where(eq(pushDeliveries.itemId, `lead:${lead.id}`))
      .limit(1);
    if (deliveries.length > 0) continue;

    const [stamped] = await db
      .update(companyRecords)
      .set({
        payload: sql`coalesce(${companyRecords.payload}, '{}'::jsonb) || ${JSON.stringify(
          { whatsappBackupAt: now.toISOString() },
        )}::jsonb`,
      })
      .where(
        and(
          eq(companyRecords.id, lead.id),
          sql`NOT (coalesce(${companyRecords.payload}, '{}'::jsonb) ? 'whatsappBackupAt')`,
        ),
      )
      .returning();
    if (!stamped) continue;

    const outcome = await sendWhatsappNotice(lead);
    if (outcome === "sent") {
      sent++;
      continue;
    }
    try {
      await db
        .update(companyRecords)
        .set({
          payload: sql`coalesce(${companyRecords.payload}, '{}'::jsonb) - 'whatsappBackupAt'`,
        })
        .where(eq(companyRecords.id, lead.id));
    } catch (error) {
      console.error("[Lead notify] could not release the backup stamp", lead.id, error);
    }
  }
  return sent;
}
