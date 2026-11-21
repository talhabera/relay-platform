import { getVapidConfig } from "./config";
import { dispatchNeedsYouPush } from "./dispatch";
import { dbDispatchDeps } from "./store";

/** How often new Needs you items are pushed. Items are created by the worker and cron. */
export const PUSH_DISPATCH_INTERVAL_MS = 30_000;

const STARTED = Symbol.for("relay.push.dispatcher");

/**
 * Starts the in-process dispatcher once per server process (called from
 * `instrumentation.ts`). No-op without VAPID keys. Several web replicas may
 * each run it: the delivery claim keeps it to one notification per item.
 */
export function startPushDispatcher(intervalMs: number = PUSH_DISPATCH_INTERVAL_MS): boolean {
  const g = globalThis as { [STARTED]?: boolean };
  if (g[STARTED]) return false;
  const vapid = getVapidConfig();
  if (!vapid) return false;
  g[STARTED] = true;

  const deps = dbDispatchDeps(vapid);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchNeedsYouPush(deps);
    } catch (error) {
      console.error("[push] dispatch failed", error);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref?.();
  return true;
}
