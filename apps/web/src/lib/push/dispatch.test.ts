import { describe, expect, it, vi } from "vitest";
import type { NeedsYouItem } from "@/lib/operator/needs-you";
import { buildPushPayload, dispatchNeedsYouPush, type DispatchDeps, type StoredSubscription } from "./dispatch";
import { isAllowedPushEndpoint, pushSubscriptionSchema } from "./subscription-schema";

const at = (iso: string) => new Date(`2026-10-06T${iso}:00.000Z`);

function item(over: Partial<NeedsYouItem> = {}): NeedsYouItem {
  return {
    id: "cp-1",
    type: "checkpoint",
    agentId: "a1",
    agentName: "Mail Marketer",
    title: "Approve outreach",
    createdAt: at("10:00"),
    chatId: "chat-1",
    cronRunId: null,
    cronJobId: null,
    tier: 2,
    href: "/operator?agentId=a1&chatId=chat-1",
    workflow: "Lead engine",
    checkpointKind: "outreach",
    checkpointStatus: "pending",
    ...over,
  };
}

function sub(over: Partial<StoredSubscription> = {}): StoredSubscription {
  return {
    id: "s1",
    userId: "u1",
    endpoint: "https://fcm.googleapis.com/fcm/send/1",
    p256dh: "k",
    auth: "a",
    createdAt: at("09:00"),
    ...over,
  };
}

function deps(over: Partial<DispatchDeps> = {}): DispatchDeps & { claimed: Set<string> } {
  const claimed = new Set<string>();
  return {
    claimed,
    listSubscriptions: vi.fn(async () => [sub()]),
    loadNeedsYouForUser: vi.fn(async () => [item()]),
    claimDelivery: vi.fn(async (s: string, i: string) => {
      const key = `${s}:${i}`;
      if (claimed.has(key)) return false;
      claimed.add(key);
      return true;
    }),
    releaseDelivery: vi.fn(async (s: string, i: string) => {
      claimed.delete(`${s}:${i}`);
    }),
    removeSubscription: vi.fn(async () => {}),
    send: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

describe("buildPushPayload", () => {
  it("links to the item and tags by item id", () => {
    expect(JSON.parse(buildPushPayload(item()))).toEqual({
      title: "Approve outreach",
      body: "Mail Marketer · Lead engine",
      url: "/operator?agentId=a1&chatId=chat-1",
      tag: "needs-you:cp-1",
    });
  });

  it("raises the Daily brief as Today's brief, linked to the Home tile", () => {
    const brief = item({
      id: "brief-1",
      type: "brief",
      agentName: "Daily Manager",
      title: "Today's brief",
      chatId: null,
      href: "/home#brief",
      workflow: "Daily manager",
    });
    expect(JSON.parse(buildPushPayload(brief))).toEqual({
      title: "Today's brief",
      body: "Daily Manager · Daily manager",
      url: "/home#brief",
      tag: "needs-you:brief-1",
    });
  });

  it("raises a qualified lead linked to its conversation", () => {
    const lead = item({
      id: "lead:lead-1",
      type: "qualified_lead",
      agentName: "Karşılama",
      title: "Yeni nitelikli başvuru",
      chatId: "chat-9",
      href: "/messaging?chatId=chat-9",
      workflow: null,
      tier: 1,
    });
    expect(JSON.parse(buildPushPayload(lead))).toEqual({
      title: "Yeni nitelikli başvuru",
      body: "Karşılama",
      url: "/messaging?chatId=chat-9",
      tag: "needs-you:lead:lead-1",
    });
  });

  it("links a customer-agent question to the conversation, an operator one to the session", () => {
    const customer = item({
      id: "q-customer",
      type: "agent_question",
      href: "/messaging?chatId=chat-9",
      workflow: null,
    });
    expect(JSON.parse(buildPushPayload(customer)).url).toBe("/messaging?chatId=chat-9");
    const operator = item({ id: "q-op", type: "agent_question" });
    expect(JSON.parse(buildPushPayload(operator)).url).toBe("/operator?agentId=a1&chatId=chat-1");
  });

  it("omits the workflow when the agent is in none", () => {
    expect(JSON.parse(buildPushPayload(item({ workflow: null }))).body).toBe("Mail Marketer");
  });
});

describe("dispatchNeedsYouPush", () => {
  it("sends one notification per new item and never repeats it", async () => {
    const d = deps();
    expect(await dispatchNeedsYouPush(d)).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(await dispatchNeedsYouPush(d)).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("skips items that were already open before the browser subscribed", async () => {
    const d = deps({
      loadNeedsYouForUser: vi.fn(async () => [
        item({ id: "old", createdAt: at("08:59") }),
        item({ id: "new", createdAt: at("09:30") }),
      ]),
    });
    await dispatchNeedsYouPush(d);
    expect(d.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(d.send).mock.calls[0][1]).tag).toBe("needs-you:new");
  });

  it("pushes to every browser of the user and loads the list once per user", async () => {
    const d = deps({
      listSubscriptions: vi.fn(async () => [
        sub({ id: "s1" }),
        sub({ id: "s2", endpoint: "https://updates.push.services.mozilla.com/x" }),
        sub({ id: "s3", userId: "u2" }),
      ]),
      loadNeedsYouForUser: vi.fn(async (userId: string) => (userId === "u1" ? [item()] : [])),
    });
    expect((await dispatchNeedsYouPush(d)).sent).toBe(2);
    expect(d.loadNeedsYouForUser).toHaveBeenCalledTimes(2);
  });

  it("only sends what the viewer's Needs you list holds (viewer filter upstream)", async () => {
    const d = deps({ loadNeedsYouForUser: vi.fn(async () => []) });
    await dispatchNeedsYouPush(d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("deletes a subscription the push service reports gone", async () => {
    const d = deps({
      loadNeedsYouForUser: vi.fn(async () => [item({ id: "x" }), item({ id: "y" })]),
      send: vi.fn(async () => ({ ok: false as const, gone: true, status: 410 })),
    });
    expect(await dispatchNeedsYouPush(d)).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(d.removeSubscription).toHaveBeenCalledWith("s1");
    expect(d.send).toHaveBeenCalledTimes(1);
  });

  it("releases the claim on a transient failure so the next tick retries", async () => {
    const send = vi
      .fn<DispatchDeps["send"]>()
      .mockResolvedValueOnce({ ok: false, gone: false, status: 503 })
      .mockResolvedValue({ ok: true });
    const d = deps({ send });
    expect(await dispatchNeedsYouPush(d)).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(await dispatchNeedsYouPush(d)).toEqual({ sent: 1, removed: 0, failed: 0 });
  });

  it("does not send when another dispatcher already claimed the item", async () => {
    const d = deps({ claimDelivery: vi.fn(async () => false) });
    await dispatchNeedsYouPush(d);
    expect(d.send).not.toHaveBeenCalled();
  });

  it("keeps going for other users when one user's list fails to load", async () => {
    const d = deps({
      listSubscriptions: vi.fn(async () => [sub({ id: "s1" }), sub({ id: "s2", userId: "u2" })]),
      loadNeedsYouForUser: vi.fn(async (userId: string) => {
        if (userId === "u1") throw new Error("db");
        return [item()];
      }),
    });
    expect((await dispatchNeedsYouPush(d)).sent).toBe(1);
  });
});

describe("push subscription input", () => {
  it("accepts the browser's subscription JSON", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      expirationTime: null,
      keys: { p256dh: "BNc", auth: "xyz" },
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["https://fcm.googleapis.com/fcm/send/abc", true],
    ["https://updates.push.services.mozilla.com/wpush/v2/abc", true],
    ["https://web.push.apple.com/QGx", true],
    ["https://wns2-db5p.notify.windows.com/w/?token=1", true],
    ["http://fcm.googleapis.com/fcm/send/abc", false],
    ["https://evil.example.com/fcm.googleapis.com", false],
    ["https://fcm.googleapis.com.evil.com/x", false],
    ["https://localhost:3001/internal", false],
    ["not a url", false],
  ])("endpoint %s allowed=%s", (endpoint, allowed) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(allowed);
  });

  it("refuses an endpoint outside the known push services", () => {
    const parsed = pushSubscriptionSchema.safeParse({
      endpoint: "https://10.0.0.5/hook",
      keys: { p256dh: "BNc", auth: "xyz" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodes a base64url VAPID key", async () => {
    const { urlBase64ToUint8Array } = await import("./browser");
    const bytes = Buffer.from([4, 255, 254, 1, 2]);
    expect(Array.from(urlBase64ToUint8Array(bytes.toString("base64url")))).toEqual([4, 255, 254, 1, 2]);
  });
});
