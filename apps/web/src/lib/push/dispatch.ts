import type { NeedsYouItem } from "@/lib/operator/needs-you";
import type { PushSendResult, PushTarget } from "./web-push";

// Needs you browser notifications (S102, approve-rights spec decision 9):
// each new item a person can act on raises one notification per browser that
// turned them on, linking to the item. The item set and viewer filter are the
// Needs you list itself (`getNeedsYou`), so a push never shows what the bell
// would not.

export type StoredSubscription = PushTarget & {
  id: string;
  userId: string;
  createdAt: Date;
};

export type DispatchDeps = {
  listSubscriptions: () => Promise<StoredSubscription[]>;
  /** The user's Needs you items across every company they work in. */
  loadNeedsYouForUser: (userId: string) => Promise<NeedsYouItem[]>;
  /** Inserts the (subscription, item) row; false when it already existed. */
  claimDelivery: (subscriptionId: string, itemId: string) => Promise<boolean>;
  releaseDelivery: (subscriptionId: string, itemId: string) => Promise<void>;
  removeSubscription: (subscriptionId: string) => Promise<void>;
  send: (target: PushTarget, payload: string) => Promise<PushSendResult>;
};

export type DispatchResult = { sent: number; removed: number; failed: number };

/** What the service worker shows: `public/sw.js` reads these four fields. */
export function buildPushPayload(item: NeedsYouItem): string {
  const body = item.workflow ? `${item.agentName} · ${item.workflow}` : item.agentName;
  return JSON.stringify({
    title: item.title,
    body,
    url: item.href,
    tag: `needs-you:${item.id}`,
  });
}

/**
 * One pass. An item is new for a browser when it was created at or after the
 * browser subscribed; the delivery claim makes the pass idempotent across
 * ticks and replicas.
 */
export async function dispatchNeedsYouPush(deps: DispatchDeps): Promise<DispatchResult> {
  const result: DispatchResult = { sent: 0, removed: 0, failed: 0 };
  const subs = await deps.listSubscriptions();
  const byUser = new Map<string, StoredSubscription[]>();
  for (const s of subs) byUser.set(s.userId, [...(byUser.get(s.userId) ?? []), s]);

  for (const [userId, userSubs] of byUser) {
    let items: NeedsYouItem[];
    try {
      items = await deps.loadNeedsYouForUser(userId);
    } catch (error) {
      console.error("[push] Needs you load failed", { userId, error });
      continue;
    }
    if (items.length === 0) continue;

    for (const s of userSubs) {
      for (const item of items) {
        if (item.createdAt.getTime() < s.createdAt.getTime()) continue;
        if (!(await deps.claimDelivery(s.id, item.id))) continue;
        const sent = await deps.send(s, buildPushPayload(item));
        if (sent.ok) {
          result.sent++;
          continue;
        }
        if (sent.gone) {
          await deps.removeSubscription(s.id);
          result.removed++;
          break;
        }
        await deps.releaseDelivery(s.id, item.id);
        result.failed++;
      }
    }
  }
  return result;
}
