import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { db } from "@/db";
import { notifyWorkerComment, notifyWorkerInbound } from "@/lib/worker-proxy";
import { findOrCreateChat, saveInboundMessage } from "@/lib/inbound-conversation";

vi.mock("@/lib/worker-proxy", () => ({
  notifyWorkerInbound: vi.fn(async () => true),
  notifyWorkerComment: vi.fn(async () => true),
}));

vi.mock("@/lib/inbound-conversation", () => ({
  findOrCreateChat: vi.fn(async () => "chat-1"),
  saveInboundMessage: vi.fn(async () => true),
}));

const AGENT = { id: "agent-1", companyId: "company-1" };

function dmBody(message: Record<string, unknown>, sender = "9876543210") {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_757_000_000,
        messaging: [
          {
            sender: { id: sender },
            recipient: { id: IG_ACCOUNT_ID },
            timestamp: 1_757_000_000_000,
            message,
          },
        ],
      },
    ],
  });
}

const APP_SECRET = "app-secret-value";
const VERIFY_TOKEN = "verify-token-value";
const IG_ACCOUNT_ID = "17841400000000000";

vi.stubEnv("META_APP_SECRET", APP_SECRET);
vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", VERIFY_TOKEN);

const CHANNEL = {
  id: "channel-1",
  agentId: "agent-1",
  type: "instagram",
  status: "active",
  config: {
    accountId: IG_ACCOUNT_ID,
    accessToken: "IGQVJtoken",
    autoCommentReply: true,
  },
};

function body(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    object: "instagram",
    entry: [
      {
        id: IG_ACCOUNT_ID,
        time: 1_757_000_000,
        changes: [
          {
            field: "comments",
            value: {
              id: "17900000000000000",
              text: "Bu urun stokta mi?",
              from: { id: "9876543210", username: "alex.creative" },
              media: { id: "17800000000000000" },
              ...overrides,
            },
          },
        ],
      },
    ],
  });
}

function post(raw: string, signature: string | null) {
  return new Request("http://localhost:3000/api/webhooks/instagram", {
    method: "POST",
    headers: signature
      ? { "x-hub-signature-256": signature, "content-type": "application/json" }
      : { "content-type": "application/json" },
    body: raw,
  });
}

function sign(raw: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

/** The values() call the route made, if any. */
let valuesMock: ReturnType<typeof vi.fn>;
/** The returning() call that terminates the insert chain. */
let returningMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  returningMock = vi.fn(async () => [{ id: "comment-row-1" }]);
  valuesMock = vi.fn(() => ({
    onConflictDoNothing: vi.fn(() => ({ returning: returningMock })),
  }));
  vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);
  vi.mocked(db.query.channels.findFirst).mockResolvedValue(CHANNEL as never);
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(AGENT as never);
  vi.mocked(findOrCreateChat).mockResolvedValue("chat-1");
  vi.mocked(saveInboundMessage).mockResolvedValue(true);
  vi.mocked(notifyWorkerInbound).mockResolvedValue(true);
  vi.mocked(notifyWorkerComment).mockResolvedValue(true);
});

describe("GET /api/webhooks/instagram", () => {
  function challenge(token: string, mode = "subscribe") {
    return new Request(
      `http://localhost:3000/api/webhooks/instagram?hub.mode=${mode}&hub.verify_token=${token}&hub.challenge=1158201444`,
    );
  }

  it("echoes the challenge for the configured verify token", async () => {
    const res = await GET(challenge(VERIFY_TOKEN));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("returns 403 for a wrong verify token", async () => {
    const res = await GET(challenge("not-our-token"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the mode is not subscribe", async () => {
    const res = await GET(challenge(VERIFY_TOKEN, "unsubscribe"));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/webhooks/instagram", () => {
  it("stores a comment delivered with a valid signature", async () => {
    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(valuesMock).toHaveBeenCalledTimes(1);
    expect(valuesMock.mock.calls[0][0]).toMatchObject({
      channelId: "channel-1",
      agentId: "agent-1",
      igCommentId: "17900000000000000",
      igMediaId: "17800000000000000",
      fromIgUserId: "9876543210",
      fromUsername: "alex.creative",
      content: "Bu urun stokta mi?",
    });
  });

  it("stores the delivered value verbatim as raw, including fields it does not model", async () => {
    const raw = body({
      media: { id: "17800000000000000", media_product_type: "REELS" },
      unmodelled_field: "surprise",
    });
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(valuesMock.mock.calls[0][0].raw).toEqual({
      id: "17900000000000000",
      text: "Bu urun stokta mi?",
      from: { id: "9876543210", username: "alex.creative" },
      media: { id: "17800000000000000", media_product_type: "REELS" },
      unmodelled_field: "surprise",
    });
  });

  it("rejects a bad signature with 401 and writes nothing", async () => {
    const raw = body();
    const res = await POST(post(raw, sign(raw, "wrong-secret")));

    expect(res.status).toBe(401);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("rejects a missing signature with 401", async () => {
    const raw = body();
    const res = await POST(post(raw, null));

    expect(res.status).toBe(401);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("accepts but ignores a comment for an unknown account", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue(undefined as never);
    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("skips the agent's own reply", async () => {
    const raw = body({ from: { id: IG_ACCOUNT_ID, username: "brand" } });
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("relies on the unique index rather than clobbering an existing row", async () => {
    const onConflictDoNothing = vi.fn(() => ({ returning: returningMock }));
    valuesMock.mockReturnValue({ onConflictDoNothing });
    const raw = body();

    const res = await POST(post(raw, sign(raw)));

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("returns 500 so Meta retries when the database is unreachable", async () => {
    vi.mocked(db.query.channels.findFirst).mockRejectedValue(
      new Error("ECONNREFUSED"),
    );
    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(500);
  });

  it("asks the worker to answer a newly stored comment", async () => {
    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(notifyWorkerComment).toHaveBeenCalledWith({
      channelId: "channel-1",
      commentId: "comment-row-1",
    });
  });

  // onConflictDoNothing returns no row for a comment we already stored, which
  // is how a Meta redelivery is told apart from a new comment. Without this
  // the customer gets a second public reply.
  it("does not ask again for a redelivered comment", async () => {
    returningMock.mockResolvedValue([]);

    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(notifyWorkerComment).not.toHaveBeenCalled();
  });

  it("does not ask when autoCommentReply is off", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...CHANNEL,
      config: { accountId: IG_ACCOUNT_ID, accessToken: "IGQVJtoken" },
    } as never);

    const raw = body();
    await POST(post(raw, sign(raw)));

    expect(notifyWorkerComment).not.toHaveBeenCalled();
  });

  // Meta must not retry: the comment is stored, and a retry would now be
  // dropped as a redelivery without producing the reply we failed to trigger.
  it("still answers 200 when the worker cannot be reached", async () => {
    vi.mocked(notifyWorkerComment).mockResolvedValue(false);

    const raw = body();
    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
  });

  it("leaves direct-message handling alone", async () => {
    const raw = dmBody({ mid: "mid-1", text: "Merhaba" });
    await POST(post(raw, sign(raw)));

    expect(notifyWorkerComment).not.toHaveBeenCalled();
  });
});

describe("POST /api/webhooks/instagram — direct messages", () => {
  it("stores a DM and asks the worker to answer it", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...CHANNEL,
      config: { ...CHANNEL.config, autoReply: true },
    } as never);
    const raw = dmBody({ mid: "aWdfZG1f", text: "Bu urun stokta mi?" });

    const res = await POST(post(raw, sign(raw)));

    expect(res.status).toBe(200);
    expect(vi.mocked(findOrCreateChat).mock.calls[0][0]).toEqual({
      agentId: "agent-1",
      companyId: "company-1",
      platform: "instagram",
      senderId: "9876543210",
      title: "9876543210",
    });
    expect(vi.mocked(saveInboundMessage).mock.calls[0][0]).toEqual({
      chatId: "chat-1",
      content: "Bu urun stokta mi?",
      platformMessageId: "aWdfZG1f",
      senderName: null,
    });
    expect(notifyWorkerInbound).toHaveBeenCalledWith({
      platform: "instagram",
      chatId: "chat-1",
      channelId: "channel-1",
    });
  });

  it("skips a DM we sent ourselves", async () => {
    const raw = dmBody({ mid: "m1", text: "our reply", is_echo: true }, IG_ACCOUNT_ID);

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(saveInboundMessage).not.toHaveBeenCalled();
  });

  it("stores but does not answer when auto-reply is off", async () => {
    const raw = dmBody({ mid: "m1", text: "hi" });

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(saveInboundMessage).toHaveBeenCalledTimes(1);
    expect(notifyWorkerInbound).not.toHaveBeenCalled();
  });

  it("handles a delivery carrying both a comment and a DM", async () => {
    vi.mocked(db.query.channels.findFirst).mockResolvedValue({
      ...CHANNEL,
      config: { ...CHANNEL.config, autoReply: true },
    } as never);
    const raw = JSON.stringify({
      object: "instagram",
      entry: [
        {
          id: IG_ACCOUNT_ID,
          time: 1_757_000_000,
          changes: [
            {
              field: "comments",
              value: {
                id: "17900000000000000",
                text: "Nice",
                from: { id: "5551", username: "alex.creative" },
                media: { id: "17800000000000000" },
              },
            },
          ],
          messaging: [
            {
              sender: { id: "9876543210" },
              recipient: { id: IG_ACCOUNT_ID },
              timestamp: 1_757_000_000_000,
              message: { mid: "m1", text: "hi" },
            },
          ],
        },
      ],
    });

    expect((await POST(post(raw, sign(raw)))).status).toBe(200);
    expect(db.insert).toHaveBeenCalled(); // the comment
    expect(saveInboundMessage).toHaveBeenCalledTimes(1); // the DM
  });
});
