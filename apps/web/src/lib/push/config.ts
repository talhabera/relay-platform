import type { VapidConfig } from "./web-push";

/**
 * VAPID keys from env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
 * `VAPID_SUBJECT`). Without all three, browser notifications are off: the
 * Preferences toggle is disabled and the dispatcher never starts.
 */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/** The browser's `applicationServerKey`; null when push is not configured. */
export function getVapidPublicKey(): string | null {
  return getVapidConfig()?.publicKey ?? null;
}
