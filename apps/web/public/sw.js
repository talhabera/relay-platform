/* Relay service worker: Needs you browser notifications (S102).
 * Payload (lib/push/dispatch.ts buildPushPayload): { title, body, url, tag }.
 * Clicking a notification focuses an open Relay tab on the item, or opens one. */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(data) {
  if (!data) return null;
  try {
    const json = data.json();
    if (!json || typeof json.title !== "string") return null;
    return json;
  } catch {
    return null;
  }
}

self.addEventListener("push", (event) => {
  const payload = parsePayload(event.data);
  if (!payload) return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: typeof payload.body === "string" ? payload.body : "",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: { url: typeof payload.url === "string" ? payload.url : "/home" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || "/home";
  // Same-origin paths only: a payload can never send the user elsewhere.
  const target = new URL(raw, self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + "/home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.focus().then((focused) => (focused && "navigate" in focused ? focused.navigate(url) : focused));
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
