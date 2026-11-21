import { describe, expect, it } from "vitest";
import {
  hasWhatsAppGroupEvents,
  parseWhatsAppButtonReplies,
  parseWhatsAppMessageEvents,
  parseWhatsAppStatusEvents,
} from "./whatsapp-webhook";

const WABA_ID = "102290129340398";
const PHONE_NUMBER_ID = "106540352242922";

function delivery(value: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: WABA_ID, changes: [{ field: "messages", value }] }],
  });
}

function textDelivery(overrides: Record<string, unknown> = {}) {
  return delivery({
    messaging_product: "whatsapp",
    metadata: {
      display_phone_number: "15550001111",
      phone_number_id: PHONE_NUMBER_ID,
    },
    contacts: [{ profile: { name: "Sarah Johnson" }, wa_id: "905551112233" }],
    messages: [
      {
        from: "905551112233",
        id: "wamid.HBgMOTA1NTUxMTEyMjMzFQIAEhgU",
        timestamp: "1757000000",
        type: "text",
        text: { body: "Siparisim ne zaman gelir?" },
        ...overrides,
      },
    ],
  });
}

describe("parseWhatsAppMessageEvents", () => {
  it("returns the phone number id from metadata, not the WABA id in entry.id", () => {
    const [event] = parseWhatsAppMessageEvents(textDelivery());

    expect(event.phoneNumberId).toBe(PHONE_NUMBER_ID);
    expect(event.phoneNumberId).not.toBe(WABA_ID);
  });

  it("flattens a text message into the fields we store", () => {
    const [event] = parseWhatsAppMessageEvents(textDelivery());

    expect(event).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      waMessageId: "wamid.HBgMOTA1NTUxMTEyMjMzFQIAEhgU",
      fromWaId: "905551112233",
      profileName: "Sarah Johnson",
      content: "Siparisim ne zaman gelir?",
      messageType: "text",
      sentAt: new Date(1_757_000_000 * 1000),
      referral: null,
    });
  });

  it("keeps a Click-to-WhatsApp referral, camelCased", () => {
    const [event] = parseWhatsAppMessageEvents(
      textDelivery({
        referral: {
          source_url: "https://fb.me/abc",
          source_id: "120212345",
          source_type: "ad",
          headline: "Mutfak yenileme",
          body: "Ücretsiz keşif",
          media_type: "image",
          ctwa_clid: "ARAkLk",
        },
      }),
    );

    expect(event.referral).toEqual({
      sourceUrl: "https://fb.me/abc",
      sourceId: "120212345",
      sourceType: "ad",
      headline: "Mutfak yenileme",
      body: "Ücretsiz keşif",
      ctwaClid: "ARAkLk",
    });
  });

  it("ignores a referral that is not an object", () => {
    const [event] = parseWhatsAppMessageEvents(textDelivery({ referral: "ad" }));

    expect(event.referral).toBeNull();
  });

  it("stores a placeholder for a media message so the agent knows one arrived", () => {
    const [event] = parseWhatsAppMessageEvents(
      textDelivery({ type: "image", text: undefined, image: { id: "media-1" } }),
    );

    expect(event.content).toBe("[image]");
    expect(event.messageType).toBe("image");
  });

  it("yields nothing for a reaction, so a thumbs-up costs no agent run", () => {
    expect(
      parseWhatsAppMessageEvents(
        textDelivery({
          type: "reaction",
          text: undefined,
          reaction: { message_id: "wamid.A", emoji: "\u{1F44D}" },
        }),
      ),
    ).toEqual([]);
  });

  it("yields nothing for a system message", () => {
    expect(
      parseWhatsAppMessageEvents(
        textDelivery({
          type: "system",
          text: undefined,
          system: { body: "Customer changed their number", type: "user_changed_number" },
        }),
      ),
    ).toEqual([]);
  });

  it("yields nothing for a statuses-only delivery", () => {
    const raw = delivery({
      messaging_product: "whatsapp",
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [{ id: "wamid.X", status: "delivered", timestamp: "1757000001" }],
    });

    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
  });

  it("leaves profileName null when no contact matches the sender", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [{ profile: { name: "Someone Else" }, wa_id: "999999999999" }],
      messages: [
        {
          from: "905551112233",
          id: "wamid.A",
          timestamp: "1757000000",
          type: "text",
          text: { body: "hi" },
        },
      ],
    });

    expect(parseWhatsAppMessageEvents(raw)[0].profileName).toBeNull();
  });

  it("accepts a numeric timestamp as well as a string one", () => {
    const [event] = parseWhatsAppMessageEvents(
      textDelivery({ timestamp: 1_757_000_000 }),
    );

    expect(event.sentAt).toEqual(new Date(1_757_000_000 * 1000));
  });

  it("skips a change whose field is not messages", () => {
    const raw = JSON.stringify({
      entry: [
        {
          id: WABA_ID,
          changes: [{ field: "message_template_status_update", value: {} }],
        },
      ],
    });

    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
  });

  it("returns an empty list rather than throwing on junk", () => {
    expect(parseWhatsAppMessageEvents("not json")).toEqual([]);
    expect(parseWhatsAppMessageEvents("{}")).toEqual([]);
    expect(parseWhatsAppMessageEvents('{"entry":"nope"}')).toEqual([]);
    expect(parseWhatsAppMessageEvents("")).toEqual([]);
    // Guard against bare null (valid JSON, but not an object).
    expect(parseWhatsAppMessageEvents("null")).toEqual([]);
    // Guard against null entry in entries array.
    expect(parseWhatsAppMessageEvents('{"entry":[null]}')).toEqual([]);
    // Guard against null change in changes array.
    expect(
      parseWhatsAppMessageEvents(
        '{"entry":[{"id":"x","changes":[null]}]}',
      ),
    ).toEqual([]);
  });

  it("drops a message with no id or no sender", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      messages: [
        { id: "wamid.A", timestamp: "1757000000", type: "text", text: { body: "x" } },
        { from: "905551112233", timestamp: "1757000000", type: "text", text: { body: "y" } },
      ],
    });

    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
  });

  it("skips null messages in the messages array but processes valid ones", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      messages: [
        null,
        {
          from: "905551112233",
          id: "wamid.A",
          timestamp: "1757000000",
          type: "text",
          text: { body: "hi" },
        },
      ],
    });

    expect(parseWhatsAppMessageEvents(raw)).toHaveLength(1);
    expect(parseWhatsAppMessageEvents(raw)[0].content).toBe("hi");
  });

  it("skips null contacts in the contacts array but uses matching real ones", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      contacts: [
        null,
        { profile: { name: "Sarah Johnson" }, wa_id: "905551112233" },
      ],
      messages: [
        {
          from: "905551112233",
          id: "wamid.A",
          timestamp: "1757000000",
          type: "text",
          text: { body: "hi" },
        },
      ],
    });

    expect(parseWhatsAppMessageEvents(raw)[0].profileName).toBe("Sarah Johnson");
  });
});

function statusDelivery(status: Record<string, unknown> = {}) {
  return delivery({
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
  });
}

describe("parseWhatsAppStatusEvents", () => {
  it("flattens a delivered status into the fields we store", () => {
    const [event] = parseWhatsAppStatusEvents(statusDelivery());

    expect(event).toEqual({
      phoneNumberId: PHONE_NUMBER_ID,
      waMessageId: "wamid.OUT",
      status: "delivered",
      statusAt: new Date(1_757_000_001 * 1000),
      error: null,
    });
  });

  it("reads sent, read, and failed the same way", () => {
    expect(parseWhatsAppStatusEvents(statusDelivery({ status: "sent" }))[0].status).toBe(
      "sent",
    );
    expect(parseWhatsAppStatusEvents(statusDelivery({ status: "read" }))[0].status).toBe(
      "read",
    );
    expect(
      parseWhatsAppStatusEvents(statusDelivery({ status: "failed" }))[0].status,
    ).toBe("failed");
  });

  it("captures the error code and title on a failed status", () => {
    const [event] = parseWhatsAppStatusEvents(
      statusDelivery({
        status: "failed",
        errors: [{ code: 131053, title: "Media upload error" }],
      }),
    );

    expect(event.error).toEqual({ code: 131053, title: "Media upload error" });
  });

  it("ignores errors on a non-failed status", () => {
    const [event] = parseWhatsAppStatusEvents(
      statusDelivery({
        status: "delivered",
        errors: [{ code: 131053, title: "Media upload error" }],
      }),
    );

    expect(event.error).toBeNull();
  });

  it("drops a status with an unrecognised value", () => {
    expect(parseWhatsAppStatusEvents(statusDelivery({ status: "deleted" }))).toEqual(
      [],
    );
  });

  it("drops a status with no id or no timestamp", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [
        { status: "delivered", timestamp: "1757000001" },
        { id: "wamid.OUT", status: "delivered" },
      ],
    });

    expect(parseWhatsAppStatusEvents(raw)).toEqual([]);
  });

  it("yields nothing for a messages-only delivery", () => {
    expect(parseWhatsAppStatusEvents(textDelivery())).toEqual([]);
  });

  it("skips null statuses in the statuses array but processes valid ones", () => {
    const raw = delivery({
      metadata: { phone_number_id: PHONE_NUMBER_ID },
      statuses: [
        null,
        { id: "wamid.OUT", status: "read", timestamp: "1757000001" },
      ],
    });

    expect(parseWhatsAppStatusEvents(raw)).toHaveLength(1);
    expect(parseWhatsAppStatusEvents(raw)[0].waMessageId).toBe("wamid.OUT");
  });

  it("returns an empty list rather than throwing on junk", () => {
    expect(parseWhatsAppStatusEvents("not json")).toEqual([]);
    expect(parseWhatsAppStatusEvents("{}")).toEqual([]);
    expect(parseWhatsAppStatusEvents('{"entry":"nope"}')).toEqual([]);
    expect(parseWhatsAppStatusEvents("null")).toEqual([]);
  });
});

describe("parseWhatsAppButtonReplies", () => {
  const PAYLOAD = "handoff_confirm:6f1c2a8e-1b2c-4d3e-8f90-123456789abc";

  it("reads a template quick-reply tap", () => {
    const raw = textDelivery({
      type: "button",
      text: undefined,
      button: { payload: PAYLOAD, text: "Confirm" },
    });
    expect(parseWhatsAppButtonReplies(raw)).toEqual([
      {
        phoneNumberId: PHONE_NUMBER_ID,
        waMessageId: "wamid.HBgMOTA1NTUxMTEyMjMzFQIAEhgU",
        fromWaId: "905551112233",
        payload: PAYLOAD,
      },
    ]);
    // Never a customer message.
    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
  });

  it("reads an interactive button_reply tap", () => {
    const raw = textDelivery({
      type: "interactive",
      text: undefined,
      interactive: {
        type: "button_reply",
        button_reply: { id: PAYLOAD, title: "Confirm" },
      },
    });
    expect(parseWhatsAppButtonReplies(raw).map((e) => e.payload)).toEqual([PAYLOAD]);
    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
  });

  it("ignores text messages, list replies and empty payloads", () => {
    expect(parseWhatsAppButtonReplies(textDelivery())).toEqual([]);
    expect(
      parseWhatsAppButtonReplies(
        textDelivery({
          type: "interactive",
          interactive: { type: "list_reply", list_reply: { id: "x" } },
        }),
      ),
    ).toEqual([]);
    expect(
      parseWhatsAppButtonReplies(textDelivery({ type: "button", button: {} })),
    ).toEqual([]);
  });

  it("never throws on junk", () => {
    expect(parseWhatsAppButtonReplies("not json")).toEqual([]);
    expect(parseWhatsAppButtonReplies("null")).toEqual([]);
    expect(parseWhatsAppButtonReplies(JSON.stringify({ entry: [null] }))).toEqual([]);
  });
});

describe("WhatsApp Groups traffic", () => {
  it("never yields a group message as a customer message or button tap", () => {
    const raw = textDelivery({ group_id: "120363000000000001@g.us" });
    expect(hasWhatsAppGroupEvents(raw)).toBe(true);
    expect(parseWhatsAppMessageEvents(raw)).toEqual([]);
    expect(parseWhatsAppButtonReplies(raw)).toEqual([]);
  });

  it("detects a group_lifecycle_update change", () => {
    const raw = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: WABA_ID, changes: [{ field: "group_lifecycle_update", value: {} }] }],
    });
    expect(hasWhatsAppGroupEvents(raw)).toBe(true);
  });

  it("is false for an ordinary message and for junk", () => {
    expect(hasWhatsAppGroupEvents(textDelivery())).toBe(false);
    expect(hasWhatsAppGroupEvents("not json")).toBe(false);
    expect(hasWhatsAppGroupEvents("null")).toBe(false);
  });
});
