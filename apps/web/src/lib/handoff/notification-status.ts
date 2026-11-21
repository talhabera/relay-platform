import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { handoffRequests, type HandoffNotificationStatus } from "@relay/db";

/**
 * The statuses a notification may hold for `next` to replace it. Order only
 * moves forward (sent < delivered < read); failed is terminal, so nothing
 * follows it, and a late `sent` never overwrites anything.
 */
export function statusesBefore(
  next: HandoffNotificationStatus,
): HandoffNotificationStatus[] {
  switch (next) {
    case "sent":
      return [];
    case "delivered":
      return ["sent"];
    case "read":
      return ["sent", "delivered"];
    case "failed":
      return ["sent", "delivered", "read"];
  }
}

/**
 * Record a WhatsApp delivery status on the handoff request whose staff
 * notification carries this wamid. `companyId` is the company that owns the
 * channel the webhook arrived for: the signature authenticates Meta, not the
 * business, so a status may only touch that company's requests.
 *
 * One conditional UPDATE, with the forward-only guard in its WHERE, so
 * `delivered` and `read` racing each other cannot roll the winner back.
 * Returns false when no request matched or the status was out of order.
 */
export async function updateHandoffNotificationStatus(input: {
  waMessageId: string;
  companyId: string;
  status: HandoffNotificationStatus;
  statusAt: Date;
  error?: { code?: number; title?: string } | null;
}): Promise<boolean> {
  const before = statusesBefore(input.status);
  const statusGuard = before.length
    ? or(
        isNull(handoffRequests.notificationStatus),
        inArray(handoffRequests.notificationStatus, before),
      )
    : isNull(handoffRequests.notificationStatus);

  const updated = await db
    .update(handoffRequests)
    .set({
      notificationStatus: input.status,
      notificationStatusAt: input.statusAt,
      notificationError:
        input.status === "failed" ? (input.error ?? null) : null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(handoffRequests.notificationMessageId, input.waMessageId),
        eq(handoffRequests.companyId, input.companyId),
        statusGuard,
      ),
    )
    .returning({ id: handoffRequests.id });

  return updated.length > 0;
}
