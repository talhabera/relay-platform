import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import {
  AD_CHANGE_CARD_TTL_MS,
  OPEN_CHECKPOINT_STATUSES,
  agentQuestions,
  chats,
  checkpoints,
  db,
  deriveSessionStatus,
  type ChatStatus,
  type CheckpointKind,
  type CheckpointStatus,
} from "@relay/db";

/**
 * 08b2 (RELAY-167): an `ad_change` card nobody answered within 24 hours is
 * discarded by the cron sweep and never applied. One guarded UPDATE
 * (`status = 'pending'`), so a card approved a moment earlier is left alone
 * and a second run changes nothing; then each touched session's
 * `chats.status` is recomputed with the shared `deriveSessionStatus`.
 */

export const EXPIRED_AD_CHANGE_RESULT = { status: "expired" } as const;

export type ExpirableCard = {
  kind: CheckpointKind;
  status: CheckpointStatus;
  createdAt: Date;
};

/** The predicate the UPDATE runs in SQL, as a pure function for store doubles. */
export function isExpiredAdChangeCard(card: ExpirableCard, cutoff: Date): boolean {
  return (
    card.kind === "ad_change" &&
    card.status === "pending" &&
    card.createdAt.getTime() < cutoff.getTime()
  );
}

export type SessionState = {
  status: ChatStatus;
  openCheckpoints: number;
  openQuestions: number;
};

export interface ExpireAdChangeStore {
  /** Pending ad_change cards created before `cutoff` -> discarded; returns what moved. */
  discardExpired(input: {
    cutoff: Date;
    now: Date;
    result: Record<string, unknown>;
  }): Promise<{ id: string; chatId: string | null }[]>;
  sessionState(chatId: string): Promise<SessionState | null>;
  setSessionStatus(chatId: string, status: ChatStatus): Promise<void>;
}

export async function expireAdChangeCards(
  now: Date,
  store: ExpireAdChangeStore = pgExpireAdChangeStore,
): Promise<string[]> {
  const moved = await store.discardExpired({
    cutoff: new Date(now.getTime() - AD_CHANGE_CARD_TTL_MS),
    now,
    result: { ...EXPIRED_AD_CHANGE_RESULT },
  });
  const chatIds = new Set(moved.map((m) => m.chatId).filter((id): id is string => Boolean(id)));
  for (const chatId of chatIds) {
    const state = await store.sessionState(chatId);
    if (!state) continue;
    const next = deriveSessionStatus({
      // The cron replica cannot see a live run; keep what the session says.
      running: state.status === "running",
      failed: state.status === "failed",
      openCheckpoints: state.openCheckpoints,
      openQuestions: state.openQuestions,
    });
    if (next !== state.status) await store.setSessionStatus(chatId, next);
  }
  return moved.map((m) => m.id);
}

export const pgExpireAdChangeStore: ExpireAdChangeStore = {
  discardExpired({ cutoff, now, result }) {
    return db
      .update(checkpoints)
      .set({ status: "discarded", executeResult: result, resolvedAt: now, resolvedByUserId: null })
      .where(
        and(
          eq(checkpoints.kind, "ad_change"),
          eq(checkpoints.status, "pending"),
          lt(checkpoints.createdAt, cutoff),
        ),
      )
      .returning({ id: checkpoints.id, chatId: checkpoints.chatId });
  },
  async sessionState(chatId) {
    const chat = await db.query.chats.findFirst({
      columns: { status: true },
      where: eq(chats.id, chatId),
    });
    if (!chat) return null;
    const [[open], [questions]] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(checkpoints)
        .where(
          and(
            eq(checkpoints.chatId, chatId),
            inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
            isNull(checkpoints.supersededBy),
          ),
        ),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentQuestions)
        .where(and(eq(agentQuestions.chatId, chatId), eq(agentQuestions.status, "open"))),
    ]);
    return {
      status: chat.status,
      openCheckpoints: open?.n ?? 0,
      openQuestions: questions?.n ?? 0,
    };
  },
  async setSessionStatus(chatId, status) {
    await db.update(chats).set({ status }).where(eq(chats.id, chatId));
  },
};
