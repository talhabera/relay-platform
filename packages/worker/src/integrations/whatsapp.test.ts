import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWhatsAppGroup,
  getWhatsAppGroupInviteLink,
  isOfficialBusinessAccount,
  normalizeWhatsAppNumber,
  sendWhatsAppGroupText,
  sendWhatsAppTemplate,
  templateText,
} from "./whatsapp";

const SENDER = { phoneNumberId: "123456789012345", accessToken: "EAAGsecrettoken" };

let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sentBody() {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendWhatsAppTemplate", () => {
  it("sends body parameters and the quick-link token as the URL button suffix", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.T1" }] }));

    const result = await sendWhatsAppTemplate(SENDER, "4915112345678", {
      name: "relay_handoff_request",
      language: "en",
      bodyParams: ["Markus", "Acme", "Can we do\n140 m2   for 300k?"],
      urlButtonSuffix: "tok_abc",
    });

    expect(result).toEqual({ success: true, messageId: "wamid.T1", error: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://graph.facebook.com/v21.0/123456789012345/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer EAAGsecrettoken",
    );
    expect(sentBody()).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "4915112345678",
      type: "template",
      template: {
        name: "relay_handoff_request",
        language: { code: "en" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: "Markus" },
              { type: "text", text: "Acme" },
              { type: "text", text: "Can we do 140 m2 for 300k?" },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: "tok_abc" }],
          },
        ],
      },
    });
  });

  it("sends a quick-reply payload for a confirmation button", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.T2" }] }));

    await sendWhatsAppTemplate(SENDER, "4915112345678", {
      name: "relay_handoff_recipient_confirm",
      language: "en",
      bodyParams: ["Markus", "Acme"],
      quickReplyPayload: "handoff_confirm:x",
    });

    expect(sentBody().template.components[1]).toEqual({
      type: "button",
      sub_type: "quick_reply",
      index: "0",
      parameters: [{ type: "payload", payload: "handoff_confirm:x" }],
    });
  });

  it("returns the Graph error instead of throwing", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "Template name does not exist" } }, 404),
    );

    const result = await sendWhatsAppTemplate(SENDER, "4915112345678", {
      name: "missing",
      language: "en",
      bodyParams: [],
    });

    expect(result).toEqual({
      success: false,
      messageId: null,
      error: "Template name does not exist",
    });
  });

  it("returns a transport failure instead of throwing", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));

    const result = await sendWhatsAppTemplate(SENDER, "4915112345678", {
      name: "relay_handoff_request",
      language: "en",
      bodyParams: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNRESET");
    expect(result.error).not.toContain(SENDER.accessToken);
  });
});

describe("normalizeWhatsAppNumber", () => {
  it.each([
    ["+49 151 1234-5678", "4915112345678"],
    ["0049 151 12345678", "4915112345678"],
    ["905551112233", "905551112233"],
  ])("normalizes %s", (raw, expected) => {
    expect(normalizeWhatsAppNumber(raw)).toBe(expected);
  });

  it.each([null, "", "12345", "1234567890123456"])("rejects %s", (raw) => {
    expect(normalizeWhatsAppNumber(raw)).toBeNull();
  });
});

describe("templateText", () => {
  it("caps long values", () => {
    expect(templateText("a".repeat(600))).toHaveLength(500);
  });
});

describe("Groups API", () => {
  it("posts group text with recipient_type group and an optional quote", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.G1" }] }));

    const result = await sendWhatsAppGroupText(SENDER, "GROUP1", "Sent to Lukas", "wamid.A1");

    expect(result).toEqual({ success: true, messageId: "wamid.G1", error: null });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(`/${SENDER.phoneNumberId}/messages`);
    expect(sentBody()).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "group",
      to: "GROUP1",
      type: "text",
      text: { body: "Sent to Lukas", preview_url: false },
      context: { message_id: "wamid.A1" },
    });
  });

  it("reads the Official Business Account flag and treats any failure as not OBA", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ is_official_business_account: true }));
    expect(await isOfficialBusinessAccount(SENDER)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("fields=is_official_business_account");
    expect(init.method).toBe("GET");

    fetchMock.mockResolvedValueOnce(jsonResponse({ is_official_business_account: false }));
    expect(await isOfficialBusinessAccount(SENDER)).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "no" } }, 400));
    expect(await isOfficialBusinessAccount(SENDER)).toBe(false);

    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await isOfficialBusinessAccount(SENDER)).toBe(false);
  });

  it("creates a group asynchronously and returns the request id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ request_id: "REQ1" }));

    const result = await createWhatsAppGroup(SENDER, { subject: "Acme\nhandoff" });

    expect(result).toEqual({ success: true, requestId: "REQ1", groupId: null, inviteLink: null });
    expect(sentBody()).toEqual({ messaging_product: "whatsapp", subject: "Acme handoff" });
  });

  it("fails a group create that returns neither a request id nor a group id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    expect(await createWhatsAppGroup(SENDER, { subject: "Acme" })).toEqual({
      success: false,
      error: "WhatsApp API returned no group request id",
    });
  });

  it("reads a group's invite link", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ invite_link: "https://chat.whatsapp.com/X" }));
    expect(await getWhatsAppGroupInviteLink(SENDER, "GROUP1")).toBe("https://chat.whatsapp.com/X");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/GROUP1/invite_link");
  });
});
