// Next.js server start hook. Starts the Needs you browser-push dispatcher
// (S102) in the Node runtime; it is a no-op without VAPID keys. The import
// sits inside the runtime check so the Edge bundle never pulls in the DB.
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { startPushDispatcher } = await import("@/lib/push/scheduler");
    startPushDispatcher();
  }
}
