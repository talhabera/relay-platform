"use server";

import { headers } from "next/headers";
import { requireSession } from "@/lib/auth-server";
import { getVapidConfig } from "@/lib/push/config";
import { deletePushSubscription, hasPushSubscription, savePushSubscription } from "@/lib/push/store";
import { pushEndpointSchema, pushSubscriptionSchema } from "@/lib/push/subscription-schema";

export type PushActionResult = { ok: true } | { error: string };

/**
 * Preferences › Browser notifications on: stores this browser's push
 * subscription for the signed-in user. Personal setting, so the session is
 * the only gate; what gets pushed is filtered by the Needs you viewer rules.
 */
export async function enableBrowserNotifications(input: unknown): Promise<PushActionResult> {
  const session = await requireSession();
  if (!getVapidConfig()) return { error: "Browser notifications are not set up on this server" };
  const parsed = pushSubscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "This browser's push service is not supported" };
  const userAgent = (await headers()).get("user-agent")?.slice(0, 512) ?? null;
  await savePushSubscription(session.user.id, parsed.data, userAgent);
  return { ok: true };
}

/** Preferences › Browser notifications off for this browser only. */
export async function disableBrowserNotifications(input: unknown): Promise<PushActionResult> {
  const session = await requireSession();
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid subscription" };
  await deletePushSubscription(session.user.id, parsed.data.endpoint);
  return { ok: true };
}

/** Whether this browser's subscription is stored for the signed-in user. */
export async function isBrowserNotificationsOn(input: unknown): Promise<boolean> {
  const session = await requireSession();
  const parsed = pushEndpointSchema.safeParse(input);
  if (!parsed.success) return false;
  return hasPushSubscription(session.user.id, parsed.data.endpoint);
}
