import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { pushDeliveries, pushSubscriptions } from "@/db/schema";
import { listAccessibleCompanies } from "@/lib/operator/companies";
import { getNeedsYou, type NeedsYouItem } from "@/lib/operator/needs-you";
import type { DispatchDeps } from "./dispatch";
import type { PushSubscriptionInput } from "./subscription-schema";
import { sendWebPush, type VapidConfig } from "./web-push";

/**
 * Saves this browser for `userId`. The endpoint is the browser's identity:
 * re-saving it keeps `createdAt` (so nothing already open is re-pushed),
 * while a browser that changes hands to another user starts fresh.
 */
export async function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent,
        createdAt: sql`CASE WHEN ${pushSubscriptions.userId} = ${userId} THEN ${pushSubscriptions.createdAt} ELSE now() END`,
        userId,
      },
    });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const rows = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
    .limit(1);
  return rows.length > 0;
}

/** Needs you across every company the user works in (owner or member; clients see none). */
async function loadNeedsYouForUser(userId: string): Promise<NeedsYouItem[]> {
  const companies = await listAccessibleCompanies(userId);
  const lists = await Promise.all(
    companies.map((c) => getNeedsYou({ companyId: c.id, viewerId: userId, ownerId: c.ownerId })),
  );
  return lists.flatMap((l) => l.items);
}

export function dbDispatchDeps(vapid: VapidConfig): DispatchDeps {
  return {
    listSubscriptions: () =>
      db
        .select({
          id: pushSubscriptions.id,
          userId: pushSubscriptions.userId,
          endpoint: pushSubscriptions.endpoint,
          p256dh: pushSubscriptions.p256dh,
          auth: pushSubscriptions.auth,
          createdAt: pushSubscriptions.createdAt,
        })
        .from(pushSubscriptions),
    loadNeedsYouForUser,
    claimDelivery: async (subscriptionId, itemId) => {
      const rows = await db
        .insert(pushDeliveries)
        .values({ subscriptionId, itemId })
        .onConflictDoNothing()
        .returning({ itemId: pushDeliveries.itemId });
      return rows.length > 0;
    },
    releaseDelivery: async (subscriptionId, itemId) => {
      await db
        .delete(pushDeliveries)
        .where(
          and(eq(pushDeliveries.subscriptionId, subscriptionId), eq(pushDeliveries.itemId, itemId)),
        );
    },
    removeSubscription: async (subscriptionId) => {
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscriptionId));
    },
    send: (target, payload) => sendWebPush(target, payload, { vapid }),
  };
}
