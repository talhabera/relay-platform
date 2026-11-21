import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { db } from "@/db";
import {
  forwardHandoffRecipientReply,
  forwardWhatsAppGroupWebhook,
  notifyWorkerInbound,
} from "@/lib/worker-proxy";
import { updateHandoffNotificationStatus } from "@/lib/handoff/notification-status";
import {
  findOrCreateChat,
  saveInboundMessage,
  updateMessageStatus,
} from "@/lib/inbound-conversation";

const APP_SECRET = "app-secret-value";
const VERIFY_TOKEN = "verify-token-value";
const PHONE_NUMBER_ID = "106540352242922";

vi.stubEnv("META_APP_SECRET", APP_SECRET);
vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);

vi.mock("@/lib/worker-proxy", () => ({
  notifyWorkerInbound: vi.fn(async () => true),
  forwardHandoffRecipientReply: vi.fn(async () => true),
  forwardWhatsAppGroupWebhook: vi.fn(async () => true),
}));

vi.mock("@/lib/handoff/notification-status", () => ({
  updateHandoffNotificationStatus: vi.fn(async () => true),
}));

vi.mock("@/lib/inbound-conversation", () => ({
  findOrCreateChat: vi.fn(async () => "chat-1"),
  saveInboundMessage: vi.fn(async () => true),
  updateMessageStatus: vi.fn(async () => true),
}));

const CHANNEL = {
  id: "channel-1",
  agentId: "agent-1",
  type: "whatsapp",
  status: "active",
  config: {
    phoneNumberId: PHONE_NUMBER_ID,
    accessToken: "EAAtoken",
    autoReply: true,
  },
};

const AGENT = { id: "agent-1", companyId: "company-1" };

function body(message: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              contacts: [
                { profile: { name: "Sarah Johnson" }, wa_id: "905551112233" },
              ],
              messages: [
                {
                  from: "905551112233",
                  id: "wamid.A",
                  timestamp: "1757000000",
                  type: "text",
                  text: { body: "Siparisim ne zaman gelir?" },
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function sign(raw: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function post(raw: string, signature: string | null) {
  return new Request("http://localhost:3000/api/webhooks/whatsapp", {
    method: "POST",
    headers: signature
      ? { "x-hub-signature-256": signature, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: raw,
  });
}

function statusBody(status: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "102290129340398",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              statuses: [
                {
                  id: "wamid.OUT",
                  status: "delivered",
                  timestamp: "1757000001",
                  recipient_id: "905551112233",
                  ...status,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findOrCreateChat).mockResolvedValue("chat-1");
  vi.mocked(saveInboundMessage).mockResolvedValue(true);
  vi.mocked(updateMessageStatus).mockResolvedValue(true);
  vi.mocked(notifyWorkerInbound).mockResolvedValue(true);
  vi.mocked(db.query.channels.findFirst).mockResolvedValue(CHANNEL as never);
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(AGENT as never);
});

describe("GET /api/webhooks/whatsapp", () => {
  function challenge(token: string, mode = "subscribe") {
    return new Request(
      `http://localhost:3000/api/webhooks/whatsapp?hub.mode=${mode}&hub.verify_token=${token}&hub.challenge=1158201444`,
    );
  }

  it("echoes the challenge for the configured verify token", async () => {
    const res = await GET(challenge(VERIFY_TOKEN));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("returns 403 for a wrong verify token", async () => {
    expect((await GET(challenge("not-our-token"))).status).toBe(403);
  });

  it("returns 403 when the mode is not subscribe", async () => {
    expect((await GET(challenge(VERIFY_TOKEN, "unsubscribe"))).status).toBe(403);
  });
});

describe("POST /api/webhooks/whatsapp", () => {
  it("stores a signed message and asks the worker to answer it", async () => {
    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(vi.mocked(findOrCreateChat).mock.calls[0][0]).toEqual({
      agentId: "agent-1",
      companyId: "company-1",
      platform: "whatsapp",
      senderId: "905551112233",
      title: "Sarah Johnson",
    });
    expect(vi.mocked(saveInboundMessage).mock.calls[0][0]).toEqual({
      chatId: "chat-1",
      content: "Siparisim ne zaman gelir?",
      platformMessageId: "wamid.A",
      senderName: "Sarah Johnson",
      referral: null,
    });
    expect(notifyWorkerInbound).toHaveBeenCalledWith({
      platform: "whatsapp",
      chatId: "chat-1",
      channelId: "channel-1",
    });
  });

  it("rejects a bad signature with 401 and touches nothing", async () => {
    const raw = body();
    const res = await POST(post(raw, sign(raw, "wrong-secret")));

    expect(res.status).toBe(401);
    expect(findOrCreateChat).not.toHaveBeenCalled();
  });

  it("rejects a missing signature with 401", async () => {
    const raw = body();
    expect((await POST(post(raw, null))).status).toBe(401);
    expect(findOrCreateChat).not.toHaveBeenCalled();
  });

  it("accepts but ignores a message for an unknown phone number", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(undefined as never);
    const raw = body();

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(findOrCreateChat).not.toHaveBeenCalled();
  });

  it("does not answer twice when Meta redelivers", async () => {
    vi.mocked(saveInboundMessage).mockResolvedValue(false);
    const raw = body();

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("stores but does not answer when auto-reply is off", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...CHANNEL,
      config: { ...CHANNEL.config, autoReply: false },
    } as never);
    const raw = body();

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(saveInboundMessage).toHaveBeenCalledTimes(1);
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("treats an absent auto-reply flag as off", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...CHANNEL,
      config: { phoneNumberId: PHONE_NUMBER_ID, accessToken: "EAAtoken" },
    } as never);
    const raw = body();

    await POST(post(raw, sign(raw)));
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("still answers Meta 200 when the worker poke fails", async () => {
    vi.mocked(notifyWorkerInbound).mockResolvedValue(false);
    const raw = body();

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
  });

  it("returns 500 so Meta retries when the database is unreachable", async () => {
    vi.mocked(db.query.channels.findFirst).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    const raw = body();

    expect((await POST(post(raw, sign(raw)))).status).toBe(500);
  });

  it("records a delivery status against the channel that received it", async () => {
    const raw = statusBody();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(updateMessageStatus).toHaveBeenCalledWith({
      waMessageId: "wamid.OUT",
      agentId: AGENT.id,
      status: "delivered",
      statusAt: new Date(1_757_000_001 * 1000),
      error: null,
    });
    expect(findOrCreateChat).not.toHaveBeenCalled();
  });

  // A status webhook names a message by wamid alone. Resolving the channel
  // first is what stops another WABA on this Meta app writing a status onto
  // a message that is not theirs.
  it("writes no status when no channel owns the number it came from", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(undefined as never);
    const raw = statusBody();

    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });

  it("passes the error through for a failed status", async () => {
    const raw = statusBody({
      status: "failed",
      errors: [{ code: 131053, title: "Media upload error" }],
    });

    await POST(post(raw, sign(raw)));

    expect(updateMessageStatus).toHaveBeenCalledWith({
      waMessageId: "wamid.OUT",
      agentId: AGENT.id,
      status: "failed",
      statusAt: new Date(1_757_000_001 * 1000),
      error: { code: 131053, title: "Media upload error" },
    });
  });

  it("returns 500 so Meta retries when recording a status fails", async () => {
    vi.mocked(updateMessageStatus).mockRejectedValue(new Error("ECONNREFUSED"));
    const raw = statusBody();

    expect((await POST(post(raw, sign(raw)))).status).toBe(500);
  });

  it("rejects an unsigned status webhook with 401", async () => {
    const raw = statusBody();

    expect((await POST(post(raw, null))).status).toBe(401);
    expect(updateMessageStatus).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/whatsapp handoff recipient Confirm", () => {
  const PAYLOAD = "handoff_confirm:6f1c2a8e-1b2c-4d3e-8f90-123456789abc";

  it.each([
    ["template quick reply", { type: "button", text: undefined, button: { payload: PAYLOAD, text: "Confirm" } }],
    [
      "interactive button reply",
      {
        type: "interactive",
        text: undefined,
        interactive: { type: "button_reply", button_reply: { id: PAYLOAD, title: "Confirm" } },
      },
    ],
  ])("forwards a %s to the worker and stores no message", async (_label, message) => {
    const raw = body(message);
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(forwardHandoffRecipientReply).toHaveBeenCalledWith({
      phoneNumberId: PHONE_NUMBER_ID,
      fromWaId: "905551112233",
      payload: PAYLOAD,
    });
    expect(saveInboundMessage).not.toHaveBeenCalled();
    expect(findOrCreateChat).not.toHaveBeenCalled();
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("ignores a button reply with any other payload", async () => {
    const raw = body({ type: "button", text: undefined, button: { payload: "other:1" } });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
    expect(forwardHandoffRecipientReply).not.toHaveBeenCalled();
    expect(saveInboundMessage).not.toHaveBeenCalled();
  });

  it("still answers Meta 200 when the worker is unreachable", async () => {
    vi.mocked(forwardHandoffRecipientReply).mockResolvedValueOnce(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = body({ type: "button", text: undefined, button: { payload: PAYLOAD } });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/whatsapp handoff notification statuses", () => {
  it("does not touch handoff requests when the wamid is a conversation message", async () => {
    const raw = statusBody();
    await POST(post(raw, sign(raw)));
    expect(updateHandoffNotificationStatus).not.toHaveBeenCalled();
  });

  it.each(["delivered", "read", "failed"] as const)(
    "records %s on the company's handoff request when no message matches",
    async (status) => {
      vi.mocked(updateMessageStatus).mockResolvedValue(false);
      const raw = statusBody({
        id: "wamid.N1",
        status,
        ...(status === "failed"
          ? { errors: [{ code: 131026, title: "Message undeliverable" }] }
          : {}),
      });

      const res = await POST(post(raw, sign(raw)));

      expect(res.status).toBe(200);
      expect(updateHandoffNotificationStatus).toHaveBeenCalledWith({
        waMessageId: "wamid.N1",
        companyId: "company-1",
        status,
        statusAt: new Date(1757000001 * 1000),
        error:
          status === "failed"
            ? { code: 131026, title: "Message undeliverable" }
            : null,
      });
    },
  );

  it("ignores a wamid matching neither a message nor a request", async () => {
    vi.mocked(updateMessageStatus).mockResolvedValue(false);
    vi.mocked(updateHandoffNotificationStatus).mockResolvedValueOnce(false);
    const raw = statusBody({ id: "wamid.NOBODY" });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/whatsapp WhatsApp Groups (Team chat)", () => {
  it("forwards a group message to the worker and writes no messages row", async () => {
    const raw = body({ group_id: "120363000000000001@g.us", text: { body: "#A3 49 EUR" } });
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(forwardWhatsAppGroupWebhook).toHaveBeenCalledWith(raw);
    expect(findOrCreateChat).not.toHaveBeenCalled();
    expect(saveInboundMessage).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("forwards a group_lifecycle_update and opens no chat", async () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "102290129340398",
          changes: [
            {
              field: "group_lifecycle_update",
              value: {
                metadata: { phone_number_id: PHONE_NUMBER_ID },
                groups: [{ type: "group_create", group_id: "g1", request_id: "r1" }],
              },
            },
          ],
        },
      ],
    });
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(forwardWhatsAppGroupWebhook).toHaveBeenCalledWith(raw);
    expect(findOrCreateChat).not.toHaveBeenCalled();
  });

  it("does not forward an ordinary customer message", async () => {
    const raw = body();
    await POST(post(raw, sign(raw)));
    expect(forwardWhatsAppGroupWebhook).not.toHaveBeenCalled();
    expect(saveInboundMessage).toHaveBeenCalled();
  });

  it("still answers Meta 200 when the worker is unreachable", async () => {
    vi.mocked(forwardWhatsAppGroupWebhook).mockResolvedValueOnce(false);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const raw = body({ group_id: "g1" });
    const res = await POST(post(raw, sign(raw)));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/webhooks/whatsapp body size", () => {
  it("refuses an oversized body before reading it", async () => {
    const raw = body();
    const request = new Request("https://relay.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: {
        "x-hub-signature-256": sign(raw),
        "content-length": String(2_000_000),
      },
      body: raw,
    });

    const res = await POST(request);

    expect(res.status).toBe(413);
    expect(db.query.channels.findFirst).not.toHaveBeenCalled();
  });
});
