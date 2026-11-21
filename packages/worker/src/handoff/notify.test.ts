import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandoffNotifier } from "./notify";
import { createSmsStaffChannel, createWhatsAppStaffChannel } from "./staff-channel";
import type { HandoffRequestRow } from "./store";

const SENDER = { phoneNumberId: "111222333444555", accessToken: "EAAGcompanytoken" };
const NOW = new Date("2026-10-03T10:00:00Z");

function request(overrides: Partial<HandoffRequestRow> = {}): HandoffRequestRow {
  return {
    id: "req-1",
    companyId: "company-1",
    agentId: "agent-1",
    chatId: "chat-1",
    status: "open",
    mode: "quick_answer",
    tokenHash: "hash",
    reason: "Price is not in the price list",
    confidence: 30,
    questions: [{ text: "Can we do 140 m2 for 300k?", askedAt: NOW.toISOString() }],
    suggestedReplies: [],
    recipientName: "Markus Albrecht",
    recipientWhatsapp: "+49 151 12345678",
    canTakeOver: false,
    notifiedAt: null,
    notificationMessageId: null,
    notificationStatus: null,
    notificationStatusAt: null,
    notificationError: null,
    expiresAt: NOW,
    answer: null,
    replyMode: null,
    answeredAt: null,
    takenOverAt: null,
    lastHumanMessageAt: null,
    handedBackAt: null,
    handBackReason: null,
    expiredAt: null,
    linkClosedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const findSender = vi.fn();
const markNotified = vi.fn();

function notifier() {
  return createHandoffNotifier({
    findSender,
    companyName: async () => "Acme GmbH",
    markNotified,
    now: () => NOW,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  findSender.mockResolvedValue(SENDER);
  markNotified.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("notifyHandoffRecipient (Meta Cloud API, mocked)", () => {
  it("sends the handoff template from the company's own sender and marks the request notified", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.N1" }] }), { status: 200 }),
    );

    const outcome = await notifier()({ request: request(), token: "raw-token" });

    expect(outcome).toEqual({
      notified: true,
      delivery: { status: "sent", channel: "whatsapp", providerMessageId: "wamid.N1" },
    });
    expect(findSender).toHaveBeenCalledWith("company-1", "agent-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`/${SENDER.phoneNumberId}/messages`);
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${SENDER.accessToken}`,
    );
    const body = JSON.parse(init.body as string);
    expect(body.to).toBe("4915112345678");
    expect(body.template.name).toBe("relay_handoff_request");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Markus Albrecht",
      "Acme GmbH",
      "Can we do 140 m2 for 300k?",
    ]);
    expect(body.template.components[1].parameters[0].text).toBe("raw-token");
    // The wamid is stored so status webhooks can find the request.
    expect(markNotified).toHaveBeenCalledWith("req-1", NOW, "wamid.N1");
  });

  it("never logs the quick-link token", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.N2" }] }), { status: 200 }),
    );

    await notifier()({ request: request(), token: "raw-token" });

    const logged = [console.info, console.warn, console.error]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat())
      .map(String);
    expect(logged.some((line) => line.includes("raw-token"))).toBe(false);
  });

  it("leaves the request unnotified when Meta rejects the send", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Recipient not on WhatsApp" } }), {
        status: 400,
      }),
    );

    const outcome = await notifier()({ request: request(), token: "raw-token" });

    expect(outcome).toEqual({
      notified: false,
      reason: "failed",
      error: "Recipient not on WhatsApp",
    });
    expect(markNotified).not.toHaveBeenCalled();
  });

  it("keeps an unconfirmed recipient (no snapshot) in the Inbox without sending", async () => {
    const outcome = await notifier()({
      request: request({ recipientWhatsapp: null }),
      token: "raw-token",
    });

    expect(outcome).toEqual({ notified: false, reason: "no_recipient" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts Team chat requests in the group, never to the recipient", async () => {
    const postTeamChat = vi
      .fn()
      .mockResolvedValue({ posted: true, messageId: "wamid.Q1", code: "K7Q2" });
    const outcome = await createHandoffNotifier({ findSender, postTeamChat })({
      request: request({ mode: "team_chat", tokenHash: null }),
      token: null,
    });

    expect(outcome).toEqual({
      notified: true,
      teamChat: { posted: true, messageId: "wamid.Q1", code: "K7Q2" },
    });
    expect(postTeamChat).toHaveBeenCalledTimes(1);
    expect(findSender).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps a Team chat request in the Inbox without an Official Business Account", async () => {
    const postTeamChat = vi.fn().mockResolvedValue({ posted: false, reason: "needs_oba" });
    const outcome = await createHandoffNotifier({ findSender, postTeamChat })({
      request: request({ mode: "team_chat", tokenHash: null }),
      token: null,
    });

    expect(outcome).toEqual({ notified: false, reason: "needs_oba", error: undefined });
    expect(findSender).not.toHaveBeenCalled();
  });

  it("falls back to the Inbox when the company has no WhatsApp sender", async () => {
    findSender.mockResolvedValue(null);

    const outcome = await notifier()({ request: request(), token: "raw-token" });

    expect(outcome).toEqual({ notified: false, reason: "no_sender" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("delivers through any channel behind the same interface (SMS seam)", async () => {
    const outcome = await createHandoffNotifier({
      findSender,
      companyName: async () => "Acme GmbH",
      channelFor: () => createSmsStaffChannel(),
      markNotified,
      now: () => NOW,
    })({ request: request(), token: "raw-token" });

    expect(outcome).toMatchObject({ notified: false, reason: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });
});

describe("staff channels", () => {
  it("WhatsApp and SMS expose the same interface", () => {
    const keys = (c: object) => Object.keys(c).sort();
    expect(keys(createSmsStaffChannel())).toEqual(keys(createWhatsAppStaffChannel(SENDER)));
  });
});
