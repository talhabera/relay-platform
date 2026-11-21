import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  agentHandoffSettings,
  db,
  handoffRequests,
  messages,
  DEFAULT_HANDOFF_EXPIRY_MINUTES,
  HANDOFF_TAKEOVER_IDLE_MINUTES,
} from "@relay/db";

/**
 * The customer runtime's side of human handoff (spec
 * `docs/superpowers/specs/2026-10-02-human-handoff.md`).
 *
 * The web app owns the same rules in `apps/web/src/lib/handoff/`; the worker
 * cannot import from the app, so the two writes that the runtime needs (open
 * or append, read settings) are mirrored here. Keep them in step.
 */

export type HandoffSettingsRow = typeof agentHandoffSettings.$inferSelect;
export type HandoffRequestRow = typeof handoffRequests.$inferSelect;

export interface HandoffAgentScope {
  id: string;
  companyId: string;
}

export type AskHumanArgs = {
  reason: string;
  confidence: number | null;
  question: string;
  suggestedReplies: string[];
};

/** What an agent with no settings row behaves as. Mirrors the column defaults. */
export function defaultHandoffSettings(
  agent: HandoffAgentScope,
): HandoffSettingsRow {
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
    expiryMinutes: DEFAULT_HANDOFF_EXPIRY_MINUTES,
    defaultReply: "agent",
    recipientCanTakeOver: false,
    waitingText: null,
    ifNobodyAnswers: "reply_here",
    createdAt: epoch,
    updatedAt: epoch,
  };
}

export async function getHandoffSettings(
  agent: HandoffAgentScope,
): Promise<HandoffSettingsRow> {
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

/** The conversation's most recent handoff request, in any state. */
export async function getLatestHandoffRequest(
  chatId: string,
): Promise<HandoffRequestRow | null> {
  const [row] = await db
    .select()
    .from(handoffRequests)
    .where(eq(handoffRequests.chatId, chatId))
    .orderBy(desc(handoffRequests.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getHandoffRequest(
  requestId: string,
): Promise<HandoffRequestRow | null> {
  const [row] = await db
    .select()
    .from(handoffRequests)
    .where(eq(handoffRequests.id, requestId))
    .limit(1);
  return row ?? null;
}

const TAKEOVER_MESSAGE_LIMIT = 20;

/** What the person wrote to the customer during a takeover, oldest first. */
export async function getTakeoverMessages(
  request: Pick<HandoffRequestRow, "chatId" | "takenOverAt">,
): Promise<{ content: string; authorDisplayName: string | null }[]> {
  if (!request.takenOverAt) return [];
  return db
    .select({
      content: messages.content,
      authorDisplayName: messages.authorDisplayName,
    })
    .from(messages)
    .where(
      and(
        eq(messages.chatId, request.chatId),
        eq(messages.author, "human"),
        gte(messages.createdAt, request.takenOverAt),
      ),
    )
    .orderBy(asc(messages.createdAt))
    .limit(TAKEOVER_MESSAGE_LIMIT);
}

/** A takeover pauses the agent for the whole conversation until hand-back. */
export async function isChatTakenOver(chatId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: handoffRequests.id })
    .from(handoffRequests)
    .where(
      and(
        eq(handoffRequests.chatId, chatId),
        eq(handoffRequests.status, "taken_over"),
      ),
    )
    .limit(1);
  return !!row;
}

/** Same shape as the web app's quick-link token (`lib/handoff/token.ts`). */
export function createHandoffToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token, "utf8").digest("hex"),
  };
}

export type OpenOrAppendResult =
  | {
      kind: "opened";
      request: HandoffRequestRow;
      token: string | null;
      settings: HandoffSettingsRow;
    }
  | { kind: "appended"; request: HandoffRequestRow };

/**
 * `ask_human`. Opens the conversation's request, or appends the question to
 * the one already open. Only "opened" notifies anyone. The partial unique
 * index on open requests decides the race between two concurrent calls.
 *
 * The recipient is snapshotted only once confirmed; an unconfirmed recipient
 * means the request goes straight to the Inbox. `token` is the raw quick-link
 * token (null for Team chat), returned exactly once, here.
 */
export async function openOrAppendHandoffRequest(
  agent: HandoffAgentScope,
  chatId: string,
  ask: AskHumanArgs,
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

    const settings = await getHandoffSettings(agent);
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
      return {
        kind: "opened",
        request: inserted[0],
        token: link?.token ?? null,
        settings,
      };
    }
    // Lost the race to a concurrent open: append to the winner.
  }
  throw new Error("Could not open or append a handoff request");
}

/**
 * Sweep, every mode: open requests past their deadline expire and land in
 * Inbox "Waiting for you". One conditional UPDATE, so a request answered in
 * the same instant either wins as answered or expires, never both. Mirrors
 * `expireDueHandoffRequests` in the web app.
 */
export async function expireDueHandoffRequests(
  now: Date = new Date(),
): Promise<HandoffRequestRow[]> {
  return db
    .update(handoffRequests)
    .set({ status: "expired", expiredAt: now, updatedAt: now })
    .where(
      and(
        eq(handoffRequests.status, "open"),
        lte(handoffRequests.expiresAt, now),
      ),
    )
    .returning();
}

/**
 * Sweep: a takeover with no message from the person for 30 min hands back to
 * the agent. A takeover with no recorded message counts from the takeover.
 */
export async function handBackIdleTakeovers(
  now: Date = new Date(),
): Promise<HandoffRequestRow[]> {
  const cutoff = new Date(now.getTime() - HANDOFF_TAKEOVER_IDLE_MINUTES * 60_000);
  return db
    .update(handoffRequests)
    .set({
      status: "handed_back",
      handedBackAt: now,
      handBackReason: "idle",
      updatedAt: now,
    })
    .where(
      and(
        eq(handoffRequests.status, "taken_over"),
        or(
          lte(handoffRequests.lastHumanMessageAt, cutoff),
          and(
            isNull(handoffRequests.lastHumanMessageAt),
            lte(handoffRequests.takenOverAt, cutoff),
          ),
        ),
      ),
    )
    .returning();
}
