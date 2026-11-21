import { and, eq, sql } from "drizzle-orm";
import { companyRecords, db, messages } from "@relay/db";

/**
 * Store how fast the first inbound message of a chat got its first assistant
 * reply, on the lead linked to that chat (`payload.firstResponse`). Read by
 * the daily table (RL6); never compared to a threshold here.
 *
 * Callable from either side, since `record_lead` may run before or after the
 * first reply: the guarded atomic merge writes it at most once, and is a
 * no-op while no lead is linked to the chat or either message is missing.
 * The merge (never a read-modify-write) cannot clobber payload keys written
 * under the lead-chat lock.
 */
export async function recordFirstResponse(chatId: string): Promise<void> {
  const inbound = await db.query.messages.findFirst({
    where: and(eq(messages.chatId, chatId), eq(messages.role, "user")),
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  if (!inbound) return;

  const replied = await db.query.messages.findFirst({
    where: and(eq(messages.chatId, chatId), eq(messages.role, "assistant")),
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });
  if (!replied) return;

  const inboundAt = new Date(inbound.createdAt);
  const repliedAt = new Date(replied.createdAt);
  const firstResponse = {
    inboundAt: inboundAt.toISOString(),
    repliedAt: repliedAt.toISOString(),
    ms: Math.round(repliedAt.getTime() - inboundAt.getTime()),
  };

  await db
    .update(companyRecords)
    .set({
      payload: sql`coalesce(${companyRecords.payload}, '{}'::jsonb) || ${JSON.stringify(
        { firstResponse },
      )}::jsonb`,
    })
    .where(
      and(
        eq(companyRecords.chatId, chatId),
        sql`NOT (coalesce(${companyRecords.payload}, '{}'::jsonb) ? 'firstResponse')`,
      ),
    );
}
