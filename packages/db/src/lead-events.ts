import { and, eq, sql, type SQL } from "drizzle-orm";
import type {
  PgDatabase,
  PgQueryResultHKT,
  PgUpdateSetSource,
} from "drizzle-orm/pg-core";
import type { InferSelectModel } from "drizzle-orm";
import {
  companyRecords,
  type CompanyRecordStatus,
} from "./schema/company-records";
import { leadEvents } from "./schema/lead-events";
import { companies } from "./schema/companies";

// The one write path for lead status changes (lead attribution spec,
// decisions 1-2). Every transition, whether an agent tool, a checkpoint
// resolution or a person's Borderline accept/reject, goes through
// `transitionLeadStatus`, so the event log and `company_records.status` never
// disagree. `insertLeadEvent` is for the creation event of a new lead, written
// in the same transaction as the insert.

/** Who made the change: exactly one agent or one person. */
export type LeadEventActor = { agentId: string } | { userId: string };

export type LeadEventRow = InferSelectModel<typeof leadEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LeadEventExecutor = PgDatabase<PgQueryResultHKT, any, any>;

export class LeadEventActorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadEventActorError";
  }
}

/**
 * Normalizes an actor to the two columns, refusing anything but exactly one
 * non-empty id. Mirrors `lead_events_one_actor_chk` so a bad caller fails
 * before the round trip.
 */
export function leadEventActorColumns(actor: LeadEventActor): {
  agentId: string | null;
  userId: string | null;
} {
  const raw = actor as { agentId?: unknown; userId?: unknown };
  const agentId =
    typeof raw.agentId === "string" && raw.agentId !== "" ? raw.agentId : null;
  const userId =
    typeof raw.userId === "string" && raw.userId !== "" ? raw.userId : null;
  if ((agentId === null) === (userId === null)) {
    throw new LeadEventActorError(
      "A lead event needs exactly one actor: an agentId or a userId",
    );
  }
  return { agentId, userId };
}

export type InsertLeadEventInput = {
  companyId: string;
  recordId: string;
  fromStatus: CompanyRecordStatus | null;
  toStatus: CompanyRecordStatus;
  actor: LeadEventActor;
  at?: Date;
};

/** Appends one event. Use for a lead's creation (`fromStatus: null`). */
export async function insertLeadEvent(
  executor: LeadEventExecutor,
  input: InsertLeadEventInput,
): Promise<LeadEventRow> {
  const actor = leadEventActorColumns(input.actor);
  const [event] = await executor
    .insert(leadEvents)
    .values({
      companyId: input.companyId,
      recordId: input.recordId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      ...actor,
      ...(input.at ? { at: input.at } : {}),
    })
    .returning();
  return event;
}

export type TransitionLeadStatusInput = {
  companyId: string;
  recordId: string;
  toStatus: CompanyRecordStatus;
  actor: LeadEventActor;
  at?: Date;
  /**
   * Extra condition the locked row must meet (e.g. "claimable for research").
   * When it does not, nothing is written and the result is `guard_failed`.
   */
  guard?: SQL;
  /** Other record columns to write in the same update (e.g. `score`). */
  set?: Omit<
    PgUpdateSetSource<typeof companyRecords>,
    "id" | "companyId" | "status" | "createdAt"
  >;
};

export type TransitionLeadStatusResult =
  | { changed: true; event: LeadEventRow }
  | { changed: false; reason: "not_found" | "same_status" | "guard_failed" };

/**
 * Moves one lead to `toStatus` and logs the change, in one transaction (a
 * savepoint when `executor` is already a transaction). The row is locked while
 * its current status is read, so two concurrent transitions log a consistent
 * from -> to chain. A transition to the current status writes nothing and logs
 * nothing: no credit without a change.
 */
export async function transitionLeadStatus(
  executor: LeadEventExecutor,
  input: TransitionLeadStatusInput,
): Promise<TransitionLeadStatusResult> {
  const actor = leadEventActorColumns(input.actor);
  const at = input.at ?? new Date();
  return executor.transaction(async (tx) => {
    const where = and(
      eq(companyRecords.id, input.recordId),
      eq(companyRecords.companyId, input.companyId),
    );
    const [current] = await tx
      .select({
        status: companyRecords.status,
        allowed: input.guard
          ? sql<boolean>`coalesce((${input.guard}), false)`
          : sql<boolean>`true`,
      })
      .from(companyRecords)
      .where(where)
      .for("update");
    if (!current) return { changed: false, reason: "not_found" } as const;
    if (!current.allowed) {
      return { changed: false, reason: "guard_failed" } as const;
    }
    if (current.status === input.toStatus) {
      return { changed: false, reason: "same_status" } as const;
    }
    await tx
      .update(companyRecords)
      .set({ ...input.set, status: input.toStatus, updatedAt: at })
      .where(where);
    const [event] = await tx
      .insert(leadEvents)
      .values({
        companyId: input.companyId,
        recordId: input.recordId,
        fromStatus: current.status,
        toStatus: input.toStatus,
        ...actor,
        at,
      })
      .returning();
    return { changed: true, event } as const;
  });
}

/**
 * Who to credit when no agent or person is acting directly (a sweep, a
 * migration): the agent that sourced the record, else the company owner.
 * Same rule as the 0028 and 0032 backfills.
 */
export async function recordFallbackActor(
  executor: LeadEventExecutor,
  record: { companyId: string; sourceAgentId: string | null },
): Promise<LeadEventActor> {
  if (record.sourceAgentId) return { agentId: record.sourceAgentId };
  const [company] = await executor
    .select({ ownerId: companies.ownerId })
    .from(companies)
    .where(eq(companies.id, record.companyId));
  if (!company) {
    throw new LeadEventActorError(`Company ${record.companyId} not found`);
  }
  return { userId: company.ownerId };
}
