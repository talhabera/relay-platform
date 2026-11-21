import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  chats,
  messages,
  type LeadReferral,
  type MessageMetadata,
} from "@relay/db";

// `db` comes from "@/db" and the tables from "@relay/db" on purpose. The web
// test setup mocks "@/db" as `{ db: mockDb }` only, so a table imported from
// there would be undefined under test; the "@relay/db" mock spreads the real
// module and keeps the table definitions intact.

export type InboundPlatform = "whatsapp" | "instagram";

/**
 * One conversation per sender per channel. `visitorId` holds the sender's
 * phone number (WhatsApp) or Instagram-scoped user id — the same column the
 * widget uses for an anonymous visitor.
 */
export async function findOrCreateChat(input: {
  agentId: string;
  companyId: string;
  platform: InboundPlatform;
  senderId: string;
  title: string;
}): Promise<string> {
  const where = and(
    eq(chats.agentId, input.agentId),
    eq(chats.channelType, input.platform),
    eq(chats.visitorId, input.senderId),
    isNull(chats.archivedAt)
  );

  const existing = await db.query.chats.findFirst({ where });

  if (existing) return existing.id;

  // Check-then-insert races: "Hi" and "I have a question" a second apart are
  // two POSTs that can land on two web instances at once, both miss above,
  // and both insert — splitting the conversation permanently. The partial
  // unique index `chats_agent_channel_visitor_idx` turns the loser's insert
  // into a no-op, and we then re-select the row the winner created.
  const [created] = await db
    .insert(chats)
    .values({
      userId: null,
      companyId: input.companyId,
      agentId: input.agentId,
      channelType: input.platform,
      visitorId: input.senderId,
      title: input.title,
    })
    .onConflictDoNothing()
    .returning({ id: chats.id });

  if (created) return created.id;

  const winner = await db.query.chats.findFirst({ where });

  if (!winner) {
    // Neither inserted nor found: something transient. Throwing lets the
    // route answer 500 so Meta redelivers, which is the right outcome.
    throw new Error("findOrCreateChat: insert conflicted but no chat found");
  }

  return winner.id;
}

/**
 * Persist one inbound message as a user turn.
 *
 * Returns false when the platform message id was already stored — a Meta
 * redelivery. The caller must not answer in that case: the `returning` on a
 * conflicted insert is what stops a duplicate reply, not the index alone.
 */
export async function saveInboundMessage(input: {
  chatId: string;
  content: string;
  platformMessageId: string;
  senderName: string | null;
  /** Click-to-WhatsApp ad attribution; `record_lead` copies it onto the lead. */
  referral?: LeadReferral | null;
}): Promise<boolean> {
  const inserted = await db
    .insert(messages)
    .values({
      chatId: input.chatId,
      role: "user",
      content: input.content,
      metadata: {
        platformMessageId: input.platformMessageId,
        ...(input.senderName ? { senderName: input.senderName } : {}),
        ...(input.referral ? { referral: input.referral } : {}),
      },
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });

  return inserted.length > 0;
}

/** WhatsApp's delivery lifecycle for an outbound message, in order. */
const STATUS_RANK: Record<"sent" | "delivered" | "read" | "failed", number> = {
  sent: 0,
  delivered: 1,
  read: 2,
  failed: 3,
};

/**
 * Record a WhatsApp delivery-status webhook (sent/delivered/read/failed) on
 * the outbound message it refers to.
 *
 * Returns false, not an error, when no message carries this platform id --
 * the status can arrive before the send's own update lands, or for a message
 * from before this feature existed. Also returns false, without writing,
 * when the incoming status does not outrank what is already stored: a
 * redelivered or out-of-order webhook (e.g. a late "sent" after we already
 * recorded "read") must not regress the status we show.
 */
export async function updateMessageStatus(input: {
  waMessageId: string;
  agentId: string;
  status: "sent" | "delivered" | "read" | "failed";
  statusAt: Date;
  error?: { code?: number; title?: string } | null;
}): Promise<boolean> {
  const row = await db.query.messages.findFirst({
    where: sql`${messages.metadata}->>'platformMessageId' = ${input.waMessageId}`,
    with: { chat: { columns: { agentId: true } } },
  });

  if (!row) return false;

  // The signature on a status webhook authenticates Meta, not the business it
  // names, and a wamid is the whole address of the message. Any WABA
  // subscribed to this Meta app could otherwise write a status onto another
  // company's row, so the channel that received the webhook must be the one
  // that owns the conversation.
  if (row.chat?.agentId !== input.agentId) return false;

  const current = row.metadata?.status;
  if (current && STATUS_RANK[current] >= STATUS_RANK[input.status]) return false;

  const patch: Partial<MessageMetadata> = {
    status: input.status,
    statusAt: input.statusAt.toISOString(),
  };
  if (input.status === "failed" && input.error) {
    patch.error = input.error;
  }

  // Merged in the database rather than written back from what we read: the
  // send path writes `platformMessageId` onto this same row, and `delivered`
  // and `read` often arrive milliseconds apart. The rank guard is repeated in
  // the WHERE against the status we read, so the loser of that race matches
  // no row instead of rolling the winner back.
  const updated = await db
    .update(messages)
    .set({
      metadata: sql`coalesce(${messages.metadata}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(
      and(
        eq(messages.id, row.id),
        current
          ? sql`${messages.metadata}->>'status' = ${current}`
          : sql`${messages.metadata}->>'status' IS NULL`
      )
    )
    .returning({ id: messages.id });

  return updated.length > 0;
}
