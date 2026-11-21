import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agentQuestions, chats, checkpoints, integrations } from "@/db/schema";
import { z } from "zod";
import type { Checkpoint } from "@/types";
import type { CheckpointAction } from "@/lib/operator/approvals";
import {
  adChangeOnWorker,
  deliverLeadOnWorker,
  sendOutreachOnWorker,
} from "@/lib/worker-proxy";
import {
  OPEN_CHECKPOINT_STATUSES,
  checkpointArtifactHash,
  deriveSessionStatus,
} from "@relay/db";

// Side helpers for the checkpoint transition table: draft hashing (eager
// stale), execution per kind, and keeping chats.status in step.

/** True when the card's draft no longer matches the hash it was proposed with. */
export function isDraftChanged(
  row: Pick<Checkpoint, "artifactHash" | "payload">,
): boolean {
  if (!row.artifactHash) return false;
  return checkpointArtifactHash(row.payload) !== row.artifactHash;
}

export class CheckpointExecutionError extends Error {}

/**
 * Run an approved card. An email outreach sends from Gmail when the company
 * has Google Workspace connected (S73, the send lives in the worker);
 * otherwise outreach resolves to the copy path: the person copies the draft
 * and sends it. A lead delivery and an ad change run in the worker. Kinds without a
 * connector throw, which lands the card in `failed` with Retry available once
 * the connector exists.
 */
export async function executeCheckpoint(
  row: Pick<Checkpoint, "id" | "kind" | "payload" | "companyId">,
): Promise<Record<string, unknown>> {
  const payload = row.payload;
  switch (payload.kind) {
    case "outreach":
      if (payload.channel === "email" && (await hasGmailConnected(row.companyId))) {
        const outcome = await sendOutreachOnWorker(row.id);
        if (!outcome.ok) throw new CheckpointExecutionError(outcome.error);
        return outcome.result;
      }
      return {
        mode: "copy",
        channel: payload.channel,
        recipient: payload.recipient,
        ...(payload.subject ? { subject: payload.subject } : {}),
        body: payload.body,
      };
    case "lead_delivery": {
      // The send lives in the worker (S26). The card is already claimed as
      // approved, which the worker checks before sending.
      const outcome = await deliverLeadOnWorker(row.id);
      if (!outcome.ok) throw new CheckpointExecutionError(outcome.error);
      return outcome.result;
    }
    case "email_sequence":
    case "post":
    case "review_reply":
      throw new CheckpointExecutionError(
        `No connector can run a ${payload.kind} checkpoint yet`,
      );
    case "ad_change": {
      // The change (or, in manual mode, the record of the owner's panel
      // change) runs in the worker through part a's applyAdChange; a cap
      // refusal or a failed change lands the card in failed.
      const outcome = await adChangeOnWorker(row.id);
      if (!outcome.ok) throw new CheckpointExecutionError(outcome.error);
      return outcome.result;
    }
    default: {
      const exhaustive: never = payload;
      throw new CheckpointExecutionError(
        `Unknown checkpoint kind: ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

/** True when the company's Google Workspace connector can send (S73). */
async function hasGmailConnected(companyId: string): Promise<boolean> {
  const row = await db.query.integrations.findFirst({
    columns: { status: true },
    where: and(
      eq(integrations.companyId, companyId),
      eq(integrations.type, "google_workspace"),
      isNull(integrations.agentId),
    ),
  });
  return row?.status === "connected";
}

/**
 * Recompute chats.status from the session's open checkpoints and open agent
 * questions, and bump last_activity_at. `running` is true when the agent is
 * about to work again (Ask for changes, Refresh, an answered question).
 */
export async function syncChatStatus(
  chatId: string | null,
  opts: { running: boolean; now: Date },
): Promise<void> {
  if (!chatId) return;
  const [open, openQuestions] = await Promise.all([
    db.query.checkpoints.findMany({
      columns: { id: true },
      where: and(
        eq(checkpoints.chatId, chatId),
        inArray(checkpoints.status, [...OPEN_CHECKPOINT_STATUSES]),
        isNull(checkpoints.supersededBy),
      ),
    }),
    db.query.agentQuestions.findMany({
      columns: { id: true },
      where: and(
        eq(agentQuestions.chatId, chatId),
        eq(agentQuestions.status, "open"),
      ),
    }),
  ]);
  const status = deriveSessionStatus({
    running: opts.running,
    failed: false,
    openCheckpoints: open.length,
    openQuestions: openQuestions.length,
  });
  await db
    .update(chats)
    .set({ status, lastActivityAt: opts.now })
    .where(eq(chats.id, chatId));
}

/**
 * Eager stale (checkpoints spec decision 4): an edit to the work-pane artifact
 * a card was drafted from marks every pending card on it stale at write time,
 * so Needs you shows it at once. Call from the artifact write path with the
 * hash the cards were drafted from.
 */
export async function markCheckpointsStaleForArtifact(input: {
  companyId: string;
  artifactHash: string;
  now?: Date;
}): Promise<string[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .update(checkpoints)
    .set({
      status: "stale",
      executeResult: { error: "The draft was edited after this card was proposed." },
    })
    .where(
      and(
        eq(checkpoints.companyId, input.companyId),
        eq(checkpoints.artifactHash, input.artifactHash),
        eq(checkpoints.status, "pending"),
      ),
    )
    .returning({ id: checkpoints.id, chatId: checkpoints.chatId });

  const chatIds = new Set(
    rows.map((row) => row.chatId).filter((id): id is string => Boolean(id)),
  );
  for (const chatId of chatIds) {
    await syncChatStatus(chatId, { running: false, now });
  }
  return rows.map((row) => row.id);
}

/**
 * Body of POST /api/operator/actions/:id and /api/operator/cron/actions/:id.
 * `reject` is the pre-S10 name for Discard and stays accepted.
 */
export const checkpointActionBodySchema = z
  .object({
    action: z.enum([
      "approve",
      "reject",
      "discard",
      "retry",
      "ask_for_changes",
      "refresh",
    ]),
    feedback: z.string().max(4000).optional(),
  })
  .transform((body) => ({
    action: (body.action === "reject" ? "discard" : body.action) as CheckpointAction,
    feedback: body.feedback,
  }));

export type CheckpointActionBody = z.infer<typeof checkpointActionBodySchema>;

/** Tool result the agent reads when its session or run resumes. */
export function checkpointToolResult(
  checkpointId: string,
  status: string,
  executeResult: Record<string, unknown>,
): Record<string, unknown> {
  return { kind: "checkpoint_result", checkpointId, ...executeResult, status };
}
