import { describe, expect, it } from "vitest";
import { parseWhatsAppGroupWebhook } from "./whatsapp-groups";

const GROUP = "HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA";

function webhook(field: string, value: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field,
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550001111", phone_number_id: "PNID1" },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

describe("parseWhatsAppGroupWebhook", () => {
  it("reads a group text message with its sender and quote context", () => {
    const body = webhook("messages", {
      contacts: [{ wa_id: "16505551234", profile: { name: "Markus" } }],
      messages: [
        {
          from: "16505551234",
          group_id: GROUP,
          id: "wamid.A1",
          timestamp: "1790000000",
          type: "text",
          text: { body: "  Yes, 300k works  " },
          context: { from: "15550001111", id: "wamid.Q1" },
        },
      ],
    });

    expect(parseWhatsAppGroupWebhook(JSON.stringify(body))).toEqual({
      lifecycle: [],
      messages: [
        {
          phoneNumberId: "PNID1",
          groupId: GROUP,
          fromWaId: "16505551234",
          profileName: "Markus",
          messageId: "wamid.A1",
          text: "Yes, 300k works",
          quotedMessageId: "wamid.Q1",
        },
      ],
    });
  });

  it("tolerates a reply with no context (undocumented in groups)", () => {
    const body = webhook("messages", {
      messages: [
        { from: "16505551234", group_id: GROUP, id: "wamid.A2", type: "text", text: { body: "#K7Q2 yes" } },
      ],
    });

    const [event] = parseWhatsAppGroupWebhook(body).messages;
    expect(event.quotedMessageId).toBeNull();
    expect(event.profileName).toBeNull();
    expect(event.text).toBe("#K7Q2 yes");
  });

  it("skips 1:1 messages, non-text group messages and empty bodies", () => {
    const body = webhook("messages", {
      messages: [
        { from: "4915112345678", id: "wamid.C1", type: "text", text: { body: "customer" } },
        { from: "16505551234", group_id: GROUP, id: "wamid.I1", type: "image", image: { id: "m" } },
        { from: "16505551234", group_id: GROUP, id: "wamid.E1", type: "text", text: { body: "  " } },
      ],
    });

    expect(parseWhatsAppGroupWebhook(body).messages).toEqual([]);
  });

  it("reads a group_create lifecycle update with its invite link", () => {
    const body = webhook("group_lifecycle_update", {
      groups: [
        {
          timestamp: "1790000000",
          type: "group_create",
          request_id: "REQ1",
          group_id: GROUP,
          subject: "Acme handoff",
          invite_link: "https://chat.whatsapp.com/ABC",
          join_approval_mode: "auto_approve",
        },
      ],
    });

    expect(parseWhatsAppGroupWebhook(body).lifecycle).toEqual([
      {
        phoneNumberId: "PNID1",
        type: "group_create",
        groupId: GROUP,
        requestId: "REQ1",
        inviteLink: "https://chat.whatsapp.com/ABC",
        subject: "Acme handoff",
        error: null,
      },
    ]);
  });

  it("reports a failed group_create", () => {
    const body = webhook("group_lifecycle_update", {
      groups: [
        {
          type: "group_create",
          request_id: "REQ2",
          errors: [{ code: 131000, title: "Something went wrong", error_data: { details: "Not an OBA" } }],
        },
      ],
    });

    const [event] = parseWhatsAppGroupWebhook(body).lifecycle;
    expect(event.error).toBe("Not an OBA");
    expect(event.groupId).toBeNull();
  });

  it("returns nothing for garbage, other objects or a missing phone number id", () => {
    expect(parseWhatsAppGroupWebhook("{not json")).toEqual({ messages: [], lifecycle: [] });
    expect(parseWhatsAppGroupWebhook({ object: "instagram", entry: [] })).toEqual({
      messages: [],
      lifecycle: [],
    });
    expect(
      parseWhatsAppGroupWebhook({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: { messages: [{}] } }] }],
      }),
    ).toEqual({ messages: [], lifecycle: [] });
  });
});
