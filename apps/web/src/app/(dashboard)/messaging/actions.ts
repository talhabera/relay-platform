"use server";

import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { chats, handoffRequests, messages } from "@/db/schema";
import { answerNowAsCompanyUser } from "@/lib/handoff/requests";
import { requirePageAccess } from "@/lib/page-access";
import { enforceSurface, RATE_LIMIT_SURFACES } from "@/lib/rate-limit";
import { deliverHumanMessageOnWorker } from "@/lib/worker-proxy";
import { CUSTOMER_CHANNELS } from "@/components/messaging/inbox-model";

export type InboxActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "not_found" | "read_only" | "conflict" | "rate_limited";
    };

const chatInput = z.object({
  companyId: z.uuid(),
  chatId: z.uuid(),
});

const messageInput = chatInput.extend({
  text: z.string().trim().min(1).max(4000),
});

/** Inbox access = company membership + the `messaging` page; clients never have it. */
async function authorize(companyId: string) {
  try {
    return await requirePageAccess(companyId, "messaging");
  } catch {
    return null;
  }
}

async function findCustomerChat(companyId: string, chatId: string) {
  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(
      and(
        eq(chats.id, chatId),
        eq(chats.companyId, companyId),
        inArray(chats.channelType, [...CUSTOMER_CHANNELS]),
      ),
    )
    .limit(1);
  return chat ?? null;
}

/**
 * The Inbox composer. Two cases only (spec decision 13 and takeover):
 * - the latest handoff expired (Waiting for you): the reply goes out as the
 *   company, and the conversation leaves Waiting for you;
 * - the chat is taken over: the person writes live and the idle clock resets.
 * Everything else is read-only.
 */
export async function sendInboxMessage(input: unknown): Promise<InboxActionResult> {
  const parsed = messageInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { companyId, chatId, text } = parsed.data;

  const access = await authorize(companyId);
  if (!access) return { ok: false, error: "forbidden" };
  if (!(await findCustomerChat(companyId, chatId))) return { ok: false, error: "not_found" };

  const now = new Date();
  type SendOutcome = { messageId: string } | { error: "read_only" | "conflict" };
  const result = await db.transaction(async (tx): Promise<SendOutcome> => {
    const [latest] = await tx
      .select()
      .from(handoffRequests)
      .where(and(eq(handoffRequests.chatId, chatId), eq(handoffRequests.companyId, companyId)))
      .orderBy(desc(handoffRequests.createdAt))
      .limit(1);
    if (!latest) return { error: "read_only" };

    let authorDisplayName: string;
    if (latest.status === "taken_over") {
      const [held] = await tx
        .update(handoffRequests)
        .set({ lastHumanMessageAt: now, updatedAt: now })
        .where(and(eq(handoffRequests.id, latest.id), eq(handoffRequests.status, "taken_over")))
        .returning({ id: handoffRequests.id });
      if (!held) return { error: "conflict" };
      authorDisplayName = access.session.user.name?.trim() || access.company.name;
    } else if (latest.status === "expired") {
      authorDisplayName = access.company.name;
    } else {
      return { error: "read_only" };
    }

    const id = randomUUID();
    await tx.insert(messages).values({
      id,
      chatId,
      content: text,
      role: "assistant",
      author: "human",
      authorDisplayName,
      createdAt: now,
    });
    return { messageId: id };
  });

  if ("error" in result) return { ok: false, error: result.error };
  // After commit: the worker sends it on the customer's channel (the widget reads the row).
  await deliverHumanMessageOnWorker(result.messageId);
  revalidatePath("/messaging");
  return { ok: true };
}

/**
 * Take over again (Figma `08/inbox/takeover-auto-ended`): the signed-in user
 * takes the chat over under their own name, as Answer now does for clients.
 */
export async function takeOverFromInbox(input: unknown): Promise<InboxActionResult> {
  const parsed = chatInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { companyId, chatId } = parsed.data;

  const access = await authorize(companyId);
  if (!access) return { ok: false, error: "forbidden" };

  const limited = await enforceSurface(
    RATE_LIMIT_SURFACES.handoffAnswerNow({ userId: access.session.user.id }),
  );
  if (!limited.ok) return { ok: false, error: "rate_limited" };
  await limited.release();

  const result = await answerNowAsCompanyUser({
    companyId,
    chatId,
    authorName: access.session.user.name ?? "",
  });
  if (!result.ok) return { ok: false, error: result.error };
  revalidatePath("/messaging");
  return { ok: true };
}

/** "Hand back to agent" from the Inbox. The agent resumes with the full transcript. */
export async function handBackFromInbox(input: unknown): Promise<InboxActionResult> {
  const parsed = chatInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { companyId, chatId } = parsed.data;

  const access = await authorize(companyId);
  if (!access) return { ok: false, error: "forbidden" };

  const now = new Date();
  const rows = await db
    .update(handoffRequests)
    .set({ status: "handed_back", handedBackAt: now, handBackReason: "manual", updatedAt: now })
    .where(
      and(
        eq(handoffRequests.chatId, chatId),
        eq(handoffRequests.companyId, companyId),
        eq(handoffRequests.status, "taken_over"),
      ),
    )
    .returning({ id: handoffRequests.id });
  if (rows.length === 0) return { ok: false, error: "conflict" };
  revalidatePath("/messaging");
  return { ok: true };
}
