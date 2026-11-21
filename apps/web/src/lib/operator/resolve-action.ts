import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { checkpoints, type CheckpointStatus } from "@/db/schema";
import { markLeadDelivered, transitionLeadStatus } from "@/lib/leads";
import type { Checkpoint } from "@/types";
import {
  isPersistRetryable,
  isStuckApproved,
  transitionCheckpoint,
  type CheckpointAction,
} from "@/lib/operator/approvals";
import {
  executeCheckpoint,
  isDraftChanged,
  syncChatStatus,
} from "@/lib/operator/checkpoint-actions";

const FOLLOW_UP_MS = 3 * 24 * 60 * 60 * 1000;
// A Refresh the agent never answered (run died) may be asked again after this.
export const REFRESH_RETRY_MS = 5 * 60 * 1000;

export type ResolveCheckpointResult =
  | {
      ok: true;
      status: CheckpointStatus;
      executeResult: Record<string, unknown>;
      checkpoint: Checkpoint;
      /**
       * Refresh only: true when an earlier Refresh is still unanswered. The
       * caller must not write transcript messages or poke the run again.
       */
      alreadyRequested?: boolean;
    }
  | { ok: false; httpStatus: 400 | 404 | 409; status?: string };

/**
 * Apply one person's action to a card along the transition table.
 *
 * Every write is guarded on the status the card was read in (and the attempt
 * count for Retry). Only the request whose guard updated a row goes on to
 * execute and to touch the company record; a concurrent loser gets 409.
 */
export async function resolveCheckpoint(input: {
  checkpointId: string;
  action: CheckpointAction;
  userId: string;
  feedback?: string;
  now?: Date;
  /**
   * False when the card's chat is a customer conversation (W3GAP2): its
   * `chats.status` / `lastActivityAt` are not an operator session's to move.
   */
  syncSession?: boolean;
}): Promise<ResolveCheckpointResult> {
  const now = input.now ?? new Date();
  const row = await db.query.checkpoints.findFirst({
    where: eq(checkpoints.id, input.checkpointId),
  });

  if (!row) {
    return { ok: false, httpStatus: 404 };
  }

  const sessionChatId = input.syncSession === false ? null : row.chatId;

  if (row.supersededBy) {
    return { ok: false, httpStatus: 409, status: row.status };
  }

  const feedback = input.feedback?.trim();
  if (input.action === "ask_for_changes" && !feedback) {
    // A rejection always carries direction.
    return { ok: false, httpStatus: 400 };
  }

  const draftChanged =
    input.action === "approve" && row.status === "pending"
      ? isDraftChanged(row)
      : false;
  // A card whose claim landed but whose execution never reported back, or a
  // lead delivery that sent but whose bookkeeping failed.
  const persistRetry = isPersistRetryable(row);
  const stuck = isStuckApproved(row, now) || persistRetry;
  const next = transitionCheckpoint(
    row.status,
    input.action,
    draftChanged,
    stuck,
  );

  if (next === null) {
    return { ok: false, httpStatus: 409, status: row.status };
  }

  // Refresh leaves the stale card as is; the agent's new card supersedes it.
  // Only the request that stamps refreshRequestedAt asks the agent; a repeat
  // while that request is unanswered is a no-op.
  if (input.action === "refresh") {
    const stamped = await claimRefresh(row, now);
    if (stamped) {
      await syncChatStatus(sessionChatId, { running: true, now });
    }
    return {
      ok: true,
      status: row.status,
      executeResult: { status: "refresh_requested" },
      checkpoint: row,
      alreadyRequested: !stamped,
    };
  }

  let executeResult: Record<string, unknown>;
  switch (next) {
    case "discarded":
      executeResult = { status: "discarded" };
      break;
    case "changes_requested":
      executeResult = { status: "changes_requested", feedback };
      break;
    case "stale":
      executeResult = {
        error:
          "The draft changed after this card was proposed. Refresh to get a new card.",
      };
      break;
    case "approved":
      // Filled after execution; the claim must win before anything runs.
      executeResult = {};
      break;
    case "pending":
    case "failed":
      return { ok: false, httpStatus: 409, status: row.status };
    default: {
      const exhaustive: never = next;
      throw new Error(`Unhandled status: ${exhaustive}`);
    }
  }

  const won = await claimTransition(row, next, persistRetry, {
    executeResult: next === "approved" ? null : executeResult,
    userId: input.userId,
    now,
    attemptCount:
      input.action === "retry" ? row.attemptCount + 1 : row.attemptCount,
  });
  if (!won) {
    return { ok: false, httpStatus: 409, status: row.status };
  }

  let status: CheckpointStatus = next;
  if (next === "approved") {
    let executed: Record<string, unknown> | null = null;
    try {
      executed = await executeCheckpoint(row);
    } catch (error) {
      status = "failed";
      executeResult = {
        error: errorText(error),
        attempt: input.action === "retry" ? row.attemptCount + 1 : row.attemptCount,
      };
      await db
        .update(checkpoints)
        .set({ status, executeResult })
        .where(
          and(eq(checkpoints.id, row.id), eq(checkpoints.status, "approved")),
        );
    }

    if (executed) {
      // The action already happened; a bookkeeping error after this point
      // must not offer Retry (it would act twice). Keep the card approved
      // and record what failed.
      executeResult = executed;
      try {
        await db
          .update(checkpoints)
          .set({ executeResult })
          .where(
            and(eq(checkpoints.id, row.id), eq(checkpoints.status, "approved")),
          );
        await persistRecord(row, input.userId, {
          status: "outreach_approved",
          nextFollowUpAt: new Date(now.getTime() + FOLLOW_UP_MS),
          now,
        });
        if (row.payload.kind === "lead_delivery") {
          const delivered = await markLeadDelivered({
            companyId: row.companyId,
            leadId: row.payload.leadId,
            userId: input.userId,
            at: now,
          });
          if (!delivered.delivered && delivered.reason === "not_deliverable") {
            // The lead left qualified (rejected, excluded) after the card
            // was proposed. Never count it as delivered.
            status = "failed";
            executeResult = {
              ...executed,
              error:
                "The lead is not qualified any more, so it was not marked delivered",
            };
            await db
              .update(checkpoints)
              .set({ status, executeResult })
              .where(
                and(eq(checkpoints.id, row.id), eq(checkpoints.status, "approved")),
              );
          }
        }
      } catch (error) {
        executeResult = { ...executed, persistError: errorText(error) };
        await db
          .update(checkpoints)
          .set({ executeResult })
          .where(
            and(eq(checkpoints.id, row.id), eq(checkpoints.status, "approved")),
          );
      }
    }
  } else if (next === "discarded") {
    await persistRecord(row, input.userId, { status: "researched", now });
  }

  await syncChatStatus(sessionChatId, {
    running: status === "changes_requested",
    now,
  });

  return { ok: true, status, executeResult, checkpoint: row };
}

/** Guarded write; true only for the request that moved the card. */
async function claimTransition(
  row: Checkpoint,
  next: CheckpointStatus,
  persistRetry: boolean,
  values: {
    executeResult: Record<string, unknown> | null;
    userId: string;
    now: Date;
    attemptCount: number;
  },
): Promise<boolean> {
  const claimed = await db
    .update(checkpoints)
    .set({
      status: next,
      executeResult: values.executeResult,
      attemptCount: values.attemptCount,
      resolvedAt: values.now,
      resolvedByUserId: values.userId,
    })
    .where(
      and(
        eq(checkpoints.id, row.id),
        eq(checkpoints.status, row.status),
        eq(checkpoints.attemptCount, row.attemptCount),
        // Retry on a stuck approved card: lose to a late execute result.
        // Retry of a lead delivery's bookkeeping: only while it still failed.
        row.status === "approved"
          ? persistRetry
            ? sql`${checkpoints.executeResult}->>'persistError' IS NOT NULL`
            : isNull(checkpoints.executeResult)
          : undefined,
      ),
    )
    .returning({ id: checkpoints.id });
  return claimed.length > 0;
}

/** Stamp the Refresh; false when an earlier one is still unanswered. */
async function claimRefresh(row: Checkpoint, now: Date): Promise<boolean> {
  const retryBefore = new Date(now.getTime() - REFRESH_RETRY_MS);
  const stamped = await db
    .update(checkpoints)
    .set({ refreshRequestedAt: now })
    .where(
      and(
        eq(checkpoints.id, row.id),
        eq(checkpoints.status, row.status),
        isNull(checkpoints.supersededBy),
        or(
          isNull(checkpoints.refreshRequestedAt),
          lt(checkpoints.refreshRequestedAt, retryBefore),
        ),
      ),
    )
    .returning({ id: checkpoints.id });
  return stamped.length > 0;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function persistRecord(
  row: Pick<Checkpoint, "kind" | "recordId" | "companyId">,
  userId: string,
  values: {
    status: "researched" | "outreach_approved";
    nextFollowUpAt?: Date;
    now: Date;
  },
) {
  // Posts and review replies carry no company record; only outreach moves
  // the record through its outreach states. The person who resolved the card
  // is credited in the lead event log.
  if (!row.recordId || row.kind !== "outreach") return;
  await transitionLeadStatus(db, {
    companyId: row.companyId,
    recordId: row.recordId,
    toStatus: values.status,
    actor: { userId },
    at: values.now,
    ...(values.nextFollowUpAt
      ? { set: { nextFollowUpAt: values.nextFollowUpAt } }
      : {}),
  });
}
