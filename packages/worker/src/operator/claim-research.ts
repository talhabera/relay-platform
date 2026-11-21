import { and, eq, inArray, lt, sql } from "drizzle-orm";
import {
  companyRecords,
  db,
  recordFallbackActor,
  transitionLeadStatus,
  type LeadEventActor,
} from "@relay/db";

export const RESEARCH_STALE_MS = 5 * 60 * 1000;
export const RESEARCH_MAX_ATTEMPTS = 3;

export type ClaimResearchError = "not_found" | "locked";

/** Statuses research may start from; every other status is past research. */
const CLAIMABLE_STATUSES = ["pending", "failed"] as const;

/**
 * Lock a record for research. pending/failed -> processing is a status change
 * and goes through the lead event log; re-taking a stale `processing` lock
 * changes no status, so it is a plain guarded update with no event.
 */
export async function claimResearch(input: {
  companyId: string;
  recordId: string;
  now?: Date;
  /** Who started the research; defaults to the record's agent, else the owner. */
  actor?: LeadEventActor;
}): Promise<{ ok: true } | { error: ClaimResearchError }> {
  const now = input.now ?? new Date();
  const staleThreshold = new Date(now.getTime() - RESEARCH_STALE_MS);

  const row = await db.query.companyRecords.findFirst({
    where: eq(companyRecords.id, input.recordId),
  });

  if (!row || row.companyId !== input.companyId) {
    return { error: "not_found" };
  }

  const lock = {
    researchLockedAt: now,
    researchAttemptCount: sql`${companyRecords.researchAttemptCount} + 1`,
  };

  if (row.status === "processing") {
    const [claimed] = await db
      .update(companyRecords)
      .set(lock)
      .where(
        and(
          eq(companyRecords.id, input.recordId),
          eq(companyRecords.companyId, input.companyId),
          eq(companyRecords.status, "processing"),
          lt(companyRecords.researchLockedAt, staleThreshold),
        ),
      )
      .returning({ id: companyRecords.id });
    return claimed ? { ok: true } : { error: "locked" };
  }

  if (!(CLAIMABLE_STATUSES as readonly string[]).includes(row.status)) {
    return { error: "locked" };
  }

  const moved = await transitionLeadStatus(db, {
    companyId: input.companyId,
    recordId: input.recordId,
    toStatus: "processing",
    actor: input.actor ?? (await recordFallbackActor(db, row)),
    at: now,
    guard: inArray(companyRecords.status, [...CLAIMABLE_STATUSES]),
    set: lock,
  });

  if (moved.changed) return { ok: true };
  return moved.reason === "not_found"
    ? { error: "not_found" }
    : { error: "locked" };
}

/**
 * Undo a claim that found no connected vendor: processing -> pending, and the
 * attempt it counted. Logged like any other status change.
 */
export async function revertUnconnectedClaim(input: {
  recordId: string;
  companyId: string;
  actor?: LeadEventActor;
}): Promise<void> {
  const actor =
    input.actor ??
    (await recordActorFor(input.companyId, input.recordId));
  if (!actor) return;
  await transitionLeadStatus(db, {
    companyId: input.companyId,
    recordId: input.recordId,
    toStatus: "pending",
    actor,
    set: {
      researchAttemptCount: sql`greatest(${companyRecords.researchAttemptCount} - 1, 0)`,
      researchLockedAt: null,
    },
  });
}

/** The fallback actor for a record by id; null when it is gone. */
export async function recordActorFor(
  companyId: string,
  recordId: string,
): Promise<LeadEventActor | null> {
  const row = await db.query.companyRecords.findFirst({
    where: and(
      eq(companyRecords.id, recordId),
      eq(companyRecords.companyId, companyId),
    ),
    columns: { companyId: true, sourceAgentId: true },
  });
  return row ? recordFallbackActor(db, row) : null;
}
