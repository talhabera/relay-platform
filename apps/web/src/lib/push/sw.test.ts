import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => void;

function loadServiceWorker() {
  const listeners = new Map<string, Listener>();
  const showNotification = vi.fn(async () => {});
  const navigate = vi.fn(async () => null);
  const focus = vi.fn(async function (this: unknown) {
    return { navigate };
  });
  const windows: { url: string; focus: typeof focus }[] = [];
  const openWindow = vi.fn(async () => null);
  const self = {
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    registration: { showNotification },
    location: { origin: "https://relay.example" },
    clients: { claim: vi.fn(), matchAll: vi.fn(async () => windows), openWindow },
    skipWaiting: vi.fn(),
  };
  const source = readFileSync(path.resolve(__dirname, "../../../public/sw.js"), "utf8");
  vm.runInNewContext(source, { self, URL });
  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    listeners.get(type)!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  };
  return { fire, showNotification, openWindow, windows, focus, navigate };
}

describe("public/sw.js", () => {
  it("shows the pushed Needs you item", async () => {
    const sw = loadServiceWorker();
    const payload = { title: "Approve outreach", body: "Mail Marketer", url: "/operator?agentId=a", tag: "needs-you:cp" };
    await sw.fire("push", { data: { json: () => payload } });
    expect(sw.showNotification).toHaveBeenCalledWith("Approve outreach", {
      body: "Mail Marketer",
      tag: "needs-you:cp",
      data: { url: "/operator?agentId=a" },
    });
  });

  it("ignores a push without a usable payload", async () => {
    const sw = loadServiceWorker();
    await sw.fire("push", { data: { json: () => { throw new Error("bad"); } } });
    await sw.fire("push", { data: null });
    expect(sw.showNotification).not.toHaveBeenCalled();
  });

  it("opens the item on click when no Relay tab is open", async () => {
    const sw = loadServiceWorker();
    const close = vi.fn();
    await sw.fire("notificationclick", { notification: { close, data: { url: "/operator?tab=cron&jobId=j" } } });
    expect(close).toHaveBeenCalled();
    expect(sw.openWindow).toHaveBeenCalledWith("https://relay.example/operator?tab=cron&jobId=j");
  });

  it("focuses an open tab and navigates it to the item", async () => {
    const sw = loadServiceWorker();
    sw.windows.push({ url: "https://relay.example/home", focus: sw.focus });
    await sw.fire("notificationclick", { notification: { close: vi.fn(), data: { url: "/messaging?chatId=c" } } });
    expect(sw.focus).toHaveBeenCalled();
    expect(sw.navigate).toHaveBeenCalledWith("https://relay.example/messaging?chatId=c");
    expect(sw.openWindow).not.toHaveBeenCalled();
  });

  it("never opens another origin", async () => {
    const sw = loadServiceWorker();
    await sw.fire("notificationclick", { notification: { close: vi.fn(), data: { url: "https://evil.example/x" } } });
    expect(sw.openWindow).toHaveBeenCalledWith("https://relay.example/home");
  });
});
