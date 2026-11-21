import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, lte, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  deliverHumanMessageOnWorker,
  requestHandoffFollowUpOnWorker,
} from "@/lib/worker-proxy";
import {
  chats,
  handoffRequests,
  HANDOFF_TAKEOVER_IDLE_MINUTES,
  messages,
  type HandoffReplyMode,
} from "@/db/schema";
import { emitHandoffSent } from "./portal";
import {
  defaultHandoffSettings,
  getAgentHandoffSettings,
  type HandoffAgentScope,
} from "./settings";
import { createHandoffToken, hashHandoffToken, isWellFormedHandoffToken } from "./token";
import type { AskHumanInput } from "./validators";

export type HandoffRequest = typeof handoffRequests.$inferSelect;

/** Shown when a request has no named recipient (the Inbox answered). */
const FALLBACK_DISPLAY_NAME = "Team";

// Guards. Each status move is one conditional UPDATE: the WHERE re-checks the
// state the move starts from, so two clicks or two tabs cannot both win.

export function answerableWhere(tokenHash: string, now: Date): SQL | undefined {
  return and(
    eq(handoffRequests.tokenHash, tokenHash),
    eq(handoffRequests.status, "open"),
    gt(handoffRequests.expiresAt, now),
    isNull(handoffRequests.linkClosedAt),
  );
}

export function takeOverableWhere(tokenHash: string, now: Date): SQL | undefined {
  return and(
    eq(handoffRequests.tokenHash, tokenHash),
    inArray(handoffRequests.status, ["open", "answered"]),
    eq(handoffRequests.canTakeOver, true),
    gt(handoffRequests.expiresAt, now),
    isNull(handoffRequests.linkClosedAt),
  );
}

export function takenOverWhere(tokenHash: string): SQL | undefined {
  return and(
    eq(handoffRequests.tokenHash, tokenHash),
    eq(handoffRequests.status, "taken_over"),
  );
}

export function dueForExpiryWhere(now: Date): SQL | undefined {
  return and(
    eq(handoffRequests.status, "open"),
    lte(handoffRequests.expiresAt, now),
  );
}

export function idleTakeoverWhere(now: Date): SQL | undefined {
  const cutoff = new Date(now.getTime() - HANDOFF_TAKEOVER_IDLE_MINUTES * 60_000);
  return and(
    eq(handoffRequests.status, "taken_over"),
    lte(handoffRequests.lastHumanMessageAt, cutoff),
  );
}

export type OpenOrAppendResult =
  | { kind: "opened"; request: HandoffRequest; token: string | null }
  | { kind: "appended"; request: HandoffRequest };

/**
 * `ask_human`. Opens the conversation's request, or appends the question to
 * the one already open. Only "opened" should notify anyone: appending never
 * sends a second notification. The partial unique index on open requests
 * decides the race between two concurrent calls.
 *
 * The recipient is snapshotted only once confirmed; an unconfirmed recipient
 * means the request goes straight to the Inbox. `token` is the raw quick-link
 * token (null for Team chat) and is returned exactly once, here.
 */
export async function openOrAppendHandoffRequest(
  agent: HandoffAgentScope,
  chatId: string,
  ask: AskHumanInput,
  now: Date = new Date(),
): Promise<OpenOrAppendResult> {
  const question = { text: ask.question, askedAt: now.toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
    const appended = await db
      .update(handoffRequests)
      .set({
        questions: sql`${handoffRequests.questions} || ${JSON.stringify([question])}::jsonb`,
        updatedAt: now,
      })
      .where(
        and(
          eq(handoffRequests.chatId, chatId),
          eq(handoffRequests.companyId, agent.companyId),
          eq(handoffRequests.status, "open"),
        ),
      )
      .returning();
    if (appended[0]) return { kind: "appended", request: appended[0] };

    const settings = await getAgentHandoffSettings(agent);
    const confirmed =
      settings.mode !== "team_chat" &&
      settings.recipientConfirmed &&
      settings.recipientWhatsapp !== null;
    const link = settings.mode === "team_chat" ? null : createHandoffToken();

    const inserted = await db
      .insert(handoffRequests)
      .values({
        companyId: agent.companyId,
        agentId: agent.id,
        chatId,
        mode: settings.mode,
        tokenHash: link?.tokenHash ?? null,
        reason: ask.reason,
        confidence: ask.confidence,
        questions: [question],
        suggestedReplies: ask.suggestedReplies,
        recipientName: confirmed ? settings.recipientName : null,
        recipientWhatsapp: confirmed ? settings.recipientWhatsapp : null,
        canTakeOver:
          settings.mode === "takeover" ||
          (settings.mode === "quick_answer" && settings.recipientCanTakeOver),
        expiresAt: new Date(now.getTime() + settings.expiryMinutes * 60_000),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: handoffRequests.chatId,
        where: sql`${handoffRequests.status} = 'open'`,
      })
      .returning();
    if (inserted[0]) {
      return { kind: "opened", request: inserted[0], token: link?.token ?? null };
    }
    // Lost the race to a concurrent open: append to the winner.
  }
  throw new Error("Could not open or append a handoff request");
}

/** Resolve a quick link. Read-only, so opening a link twice changes nothing. */
export async function findHandoffRequestByToken(
  token: unknown,
): Promise<HandoffRequest | null> {
  if (!isWellFormedHandoffToken(token)) return null;
  const [row] = await db
    .select()
    .from(handoffRequests)
    .where(eq(handoffRequests.tokenHash, hashHandoffToken(token)))
    .limit(1);
  return row ?? null;
}

export type HandoffActionResult =
  | { ok: true; request: HandoffRequest; messageId?: string }
  | { ok: false; error: "not_found" | "conflict" };

async function failure(token: string): Promise<HandoffActionResult> {
  const existing = await findHandoffRequestByToken(token);
  return { ok: false, error: existing ? "conflict" : "not_found" };
}

/**
 * A person's message to the customer. The id is chosen here so the worker can
 * be asked to deliver exactly this row once the transaction commits.
 */
function humanMessage(request: HandoffRequest, content: string, now: Date) {
  return {
    id: randomUUID(),
    chatId: request.chatId,
    content,
    role: "assistant" as const,
    author: "human" as const,
    authorDisplayName: request.recipientName ?? FALLBACK_DISPLAY_NAME,
    createdAt: now,
  };
}

/**
 * The single answer a quick link allows. "person" stores the text verbatim
 * as a human message; "agent" leaves the wording to the customer runtime,
 * which reads `answer` and replies in its own voice.
 */
export async function answerHandoffRequest(
  token: string,
  answer: { text: string; replyMode: HandoffReplyMode },
  now: Date = new Date(),
): Promise<HandoffActionResult> {
  if (!isWellFormedHandoffToken(token)) return { ok: false, error: "not_found" };

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(handoffRequests)
      .set({
        status: "answered",
        answer: answer.text,
        replyMode: answer.replyMode,
        answeredAt: now,
        updatedAt: now,
      })
      .where(answerableWhere(hashHandoffToken(token), now))
      .returning();
    if (!row) return null;
    await emitHandoffSent(tx, row, now);
    if (answer.replyMode === "person") {
      const message = humanMessage(row, answer.text, now);
      await tx.insert(messages).values(message);
      return { request: row, messageId: message.id };
    }
    return { request: row };
  });
  if (!result) return failure(token);
  // "Let the agent phrase it": the agent follows up right away (decision 5).
  if (answer.replyMode === "agent") await requestHandoffFollowUpOnWorker(result.request.id);
  return delivered(result);
}

/**
 * After commit: a stored person message goes out on the customer's channel
 * (worker, S34). The widget reads the stored row; nothing to send there.
 */
async function delivered(result: {
  request: HandoffRequest;
  messageId?: string;
}): Promise<HandoffActionResult> {
  if (!result.messageId) return { ok: true, request: result.request };
  await deliverHumanMessageOnWorker(result.messageId);
  return { ok: true, request: result.request, messageId: result.messageId };
}

/** Take over from an open or answered request. Pauses the agent until hand-back. */
export async function takeOverHandoffRequest(
  token: string,
  now: Date = new Date(),
): Promise<HandoffActionResult> {
  if (!isWellFormedHandoffToken(token)) return { ok: false, error: "not_found" };
  const request = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(handoffRequests)
      .set({
        status: "taken_over",
        takenOverAt: now,
        lastHumanMessageAt: now,
        updatedAt: now,
      })
      .where(takeOverableWhere(hashHandoffToken(token), now))
      .returning();
    // A takeover after an answer was already reported by the answer.
    if (row && row.answeredAt === null) await emitHandoffSent(tx, row, now);
    return row ?? null;
  });
  return request ? { ok: true, request } : failure(token);
}

/** Chats that are not a customer conversation, so nobody can answer them now. */
const INTERNAL_CHANNELS = ["operator", "master"] as const;

/** The request a client user's Answer now creates when the chat has none to take. */
const ANSWER_NOW_REASON = "Answer now";

export type AnswerNowResult =
  | { ok: true; request: HandoffRequest; token: string }
  | { ok: false; error: "not_found" | "conflict" };

/**
 * Live "Answer now" for a client user (S72): a takeover authored by that user.
 * The caller has authorised the user for `companyId`. An open or answered
 * request is taken over under the user's name with a fresh link token (the
 * recipient's old link stops working); without one, a takeover request is
 * created. A takeover already running is a conflict. The raw token is
 * returned exactly once, so the user's page can drive the takeover through
 * `/api/h/[token]`.
 */
export async function answerNowAsCompanyUser(
  input: { companyId: string; chatId: string; authorName: string },
  now: Date = new Date(),
): Promise<AnswerNowResult> {
  const link = createHandoffToken();
  const authorName = input.authorName.trim() || FALLBACK_DISPLAY_NAME;

  return db.transaction(async (tx): Promise<AnswerNowResult> => {
    // Two Answer now clicks on one chat must not both create a takeover.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.chatId}, 0))`);

    const [chat] = await tx
      .select({ id: chats.id, agentId: chats.agentId })
      .from(chats)
      .where(
        and(
          eq(chats.id, input.chatId),
          eq(chats.companyId, input.companyId),
          notInArray(chats.channelType, [...INTERNAL_CHANNELS]),
        ),
      )
      .limit(1);
    if (!chat) return { ok: false, error: "not_found" };

    const [active] = await tx
      .select()
      .from(handoffRequests)
      .where(
        and(
          eq(handoffRequests.chatId, chat.id),
          inArray(handoffRequests.status, ["open", "answered", "taken_over"]),
        ),
      )
      .orderBy(desc(handoffRequests.createdAt))
      .limit(1);
    if (active?.status === "taken_over") return { ok: false, error: "conflict" };

    const takeover = {
      status: "taken_over" as const,
      tokenHash: link.tokenHash,
      recipientName: authorName,
      canTakeOver: true,
      takenOverAt: now,
      lastHumanMessageAt: now,
      updatedAt: now,
    };

    if (active) {
      const [row] = await tx
        .update(handoffRequests)
        .set(takeover)
        .where(
          and(
            eq(handoffRequests.id, active.id),
            inArray(handoffRequests.status, ["open", "answered"]),
          ),
        )
        .returning();
      if (!row) return { ok: false, error: "conflict" };
      if (row.answeredAt === null) await emitHandoffSent(tx, row, now);
      return { ok: true, request: row, token: link.token };
    }

    const scope = chat.agentId ? { id: chat.agentId, companyId: input.companyId } : null;
    const settings = scope
      ? await getAgentHandoffSettings(scope)
      : defaultHandoffSettings({ id: "", companyId: input.companyId });
    const [row] = await tx
      .insert(handoffRequests)
      .values({
        ...takeover,
        companyId: input.companyId,
        agentId: chat.agentId,
        chatId: chat.id,
        mode: "takeover",
        reason: ANSWER_NOW_REASON,
        questions: [],
        expiresAt: new Date(now.getTime() + settings.expiryMinutes * 60_000),
        createdAt: now,
      })
      .returning();
    await emitHandoffSent(tx, row, now);
    return { ok: true, request: row, token: link.token };
  });
}

/** A live message from the person during a takeover. Resets the idle clock. */
export async function sendTakeoverMessage(
  token: string,
  text: string,
  now: Date = new Date(),
): Promise<HandoffActionResult> {
  if (!isWellFormedHandoffToken(token)) return { ok: false, error: "not_found" };
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(handoffRequests)
      .set({ lastHumanMessageAt: now, updatedAt: now })
      .where(takenOverWhere(hashHandoffToken(token)))
      .returning();
    if (!row) return null;
    const message = humanMessage(row, text, now);
    await tx.insert(messages).values(message);
    return { request: row, messageId: message.id };
  });
  return result ? delivered(result) : failure(token);
}

/** "Hand back to agent". The agent resumes with the full transcript. */
export async function handBackHandoffRequest(
  token: string,
  now: Date = new Date(),
): Promise<HandoffActionResult> {
  if (!isWellFormedHandoffToken(token)) return { ok: false, error: "not_found" };
  const [request] = await db
    .update(handoffRequests)
    .set({
      status: "handed_back",
      handedBackAt: now,
      handBackReason: "manual",
      updatedAt: now,
    })
    .where(takenOverWhere(hashHandoffToken(token)))
    .returning();
  return request ? { ok: true, request } : failure(token);
}

/** "Done": the link can no longer answer or take over. Idempotent. */
export async function closeHandoffLink(
  token: string,
  now: Date = new Date(),
): Promise<HandoffActionResult> {
  if (!isWellFormedHandoffToken(token)) return { ok: false, error: "not_found" };
  const tokenHash = hashHandoffToken(token);
  await db
    .update(handoffRequests)
    .set({ linkClosedAt: now, updatedAt: now })
    .where(
      and(
        eq(handoffRequests.tokenHash, tokenHash),
        isNull(handoffRequests.linkClosedAt),
      ),
    );
  const request = await findHandoffRequestByToken(token);
  return request ? { ok: true, request } : { ok: false, error: "not_found" };
}

/**
 * Sweep: open requests past their deadline expire and land in Inbox
 * "Waiting for you". Returns the rows so the caller can send the
 * "If nobody answers" message.
 */
export async function expireDueHandoffRequests(
  now: Date = new Date(),
): Promise<HandoffRequest[]> {
  return db
    .update(handoffRequests)
    .set({ status: "expired", expiredAt: now, updatedAt: now })
    .where(dueForExpiryWhere(now))
    .returning();
}

/** Sweep: a takeover with no message from the person for 30 min hands back. */
export async function handBackIdleTakeovers(
  now: Date = new Date(),
): Promise<HandoffRequest[]> {
  return db
    .update(handoffRequests)
    .set({
      status: "handed_back",
      handedBackAt: now,
      handBackReason: "idle",
      updatedAt: now,
    })
    .where(idleTakeoverWhere(now))
    .returning();
}
