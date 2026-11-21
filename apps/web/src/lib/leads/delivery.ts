import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  companyRecords,
  PORTAL_EVENT_CHANNELS,
  type PortalEventChannel,
} from "@/db/schema";
import { DELIVERABLE_LEAD_STATUSES, transitionLeadStatus } from "@relay/db";
import { emitPortalEvent } from "@/lib/live/portal-events";

// A lead reached the client (S26). The weekly target and the Live feed both
// read this: `lead_events` gets a `delivered` row (S23 counts the first one
// per lead), `first_delivered_at` is stamped once, and the Live feed gets a
// `lead_delivered` event, all in one transaction. Only a qualified or
// interested lead (or one already delivered, a re-delivery) moves: a rejected
// or gathered lead is `not_deliverable` and the caller fails the card (W3GAP).

export type MarkLeadDeliveredResult =
  | { delivered: true }
  | {
      delivered: false;
      reason: "not_found" | "already_delivered" | "not_deliverable";
    };

export async function markLeadDelivered(input: {
  companyId: string;
  leadId: string;
  /** The person who approved the delivery card. */
  userId: string;
  at?: Date;
}): Promise<MarkLeadDeliveredResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx) => {
    const moved = await transitionLeadStatus(tx, {
      companyId: input.companyId,
      recordId: input.leadId,
      toStatus: "delivered",
      actor: { userId: input.userId },
      at,
      guard: inArray(companyRecords.status, [...DELIVERABLE_LEAD_STATUSES]),
      set: {
        firstDeliveredAt: sql`coalesce(${companyRecords.firstDeliveredAt}, ${at})`,
      },
    });
    if (!moved.changed) {
      return {
        delivered: false,
        reason:
          moved.reason === "not_found"
            ? "not_found"
            : moved.reason === "guard_failed"
              ? "not_deliverable"
              : "already_delivered",
      } as const;
    }

    const [lead] = await tx
      .select({ name: companyRecords.name, source: companyRecords.source })
      .from(companyRecords)
      .where(
        and(
          eq(companyRecords.id, input.leadId),
          eq(companyRecords.companyId, input.companyId),
        ),
      );
    await emitPortalEvent(tx, {
      companyId: input.companyId,
      type: "lead_delivered",
      title: `Lead delivered: ${lead?.name ?? "lead"}`,
      channel: portalChannel(lead?.source ?? null),
      refId: input.leadId,
      at,
    });
    return { delivered: true } as const;
  });
}

const CHANNELS: ReadonlySet<string> = new Set(PORTAL_EVENT_CHANNELS);

/** Lead sources the Live feed has no chip for (telegram, messenger) show none. */
function portalChannel(source: string | null): PortalEventChannel | null {
  return source && CHANNELS.has(source) ? (source as PortalEventChannel) : null;
}
