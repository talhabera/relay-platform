import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMessage, type WhatsAppCredentials } from "./messaging";

const CREDENTIALS: WhatsAppCredentials = {
  phoneNumberId: "123456789012345",
  accessToken: "EAAGsecrettoken",
};

const RECIPIENT = "905551112233";

/** Mirrors a successful WhatsApp Cloud API send response. */
function sendAcceptedBody(wamid: string) {
  return {
    messaging_product: "whatsapp",
    contacts: [{ input: RECIPIENT, wa_id: RECIPIENT }],
    messages: [{ id: wamid, message_status: "accepted" }],
  };
}

/** Mirrors a Graph API error envelope. */
function graphErrorBody(message: string) {
  return {
    error: {
      message,
      type: "OAuthException",
      code: 131030,
      fbtrace_id: "AbCdEfGhIjK",
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

/** The URL and init the code under test handed to fetch. */
function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendMessage on whatsapp", () => {
  it("posts to the Cloud API messages endpoint of the configured phone number", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sendAcceptedBody("wamid.ONE")));

    await sendMessage("whatsapp", RECIPIENT, "Merhaba", CREDENTIALS);

    const { url, init } = sentRequest();
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/123456789012345/messages",
    );
    expect(init.method).toBe("POST");
  });

  it("authorizes the request with the channel access token", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sendAcceptedBody("wamid.TWO")));

    await sendMessage("whatsapp", RECIPIENT, "Merhaba", CREDENTIALS);

    const headers = sentRequest().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer EAAGsecrettoken");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sends the content as an individual text message", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sendAcceptedBody("wamid.THREE")));

    await sendMessage("whatsapp", RECIPIENT, "Siparisiniz yolda", CREDENTIALS);

    expect(JSON.parse(sentRequest().init.body as string)).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: RECIPIENT,
      type: "text",
      text: { preview_url: false, body: "Siparisiniz yolda" },
    });
  });

  it("bounds the request with an abort signal so a hung call cannot stall the tool", async () => {
    fetchMock.mockResolvedValue(jsonResponse(sendAcceptedBody("wamid.FOUR")));

    await sendMessage("whatsapp", RECIPIENT, "Merhaba", CREDENTIALS);

    expect(sentRequest().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the wamid whatsapp assigned to the message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(sendAcceptedBody("wamid.HBgNOTA1NTUxMTEyMjMzFQIAERgS")),
    );

    const result = await sendMessage(
      "whatsapp",
      RECIPIENT,
      "Merhaba",
      CREDENTIALS,
    );

    expect(result).toEqual({
      success: true,
      messageId: "wamid.HBgNOTA1NTUxMTEyMjMzFQIAERgS",
      error: null,
      platform: "whatsapp",
    });
  });

  it("reports the graph error message when whatsapp rejects the send", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        graphErrorBody("(#131030) Recipient phone number not in allowed list"),
        400,
      ),
    );

    const result = await sendMessage(
      "whatsapp",
      RECIPIENT,
      "Merhaba",
      CREDENTIALS,
    );

    expect(result.success).toBe(false);
    expect(result.messageId).toBeNull();
    expect(result.error).toContain(
      "(#131030) Recipient phone number not in allowed list",
    );
  });

  it("reports failure rather than throwing when the network call fails", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendMessage(
      "whatsapp",
      RECIPIENT,
      "Merhaba",
      CREDENTIALS,
    );

    expect(result.success).toBe(false);
    expect(result.messageId).toBeNull();
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("reports failure when the response body is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", { status: 502 }),
    );

    const result = await sendMessage(
      "whatsapp",
      RECIPIENT,
      "Merhaba",
      CREDENTIALS,
    );

    expect(result.success).toBe(false);
    expect(result.messageId).toBeNull();
    expect(result.error).toContain("502");
  });

  it("reports failure when a 200 response carries no message id", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ messaging_product: "whatsapp", messages: [] }),
    );

    const result = await sendMessage(
      "whatsapp",
      RECIPIENT,
      "Merhaba",
      CREDENTIALS,
    );

    expect(result.success).toBe(false);
    expect(result.messageId).toBeNull();
  });

  it("fails without calling the API when credentials are missing", async () => {
    const result = await sendMessage("whatsapp", RECIPIENT, "Merhaba");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/credential|config/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the access token out of the logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse(sendAcceptedBody("wamid.FIVE")));

    await sendMessage("whatsapp", RECIPIENT, "Merhaba", CREDENTIALS);

    const logged = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join(" ");
    expect(logged).not.toContain(CREDENTIALS.accessToken);
  });
});

describe("sendMessage on instagram", () => {
  const IG_CREDENTIALS = {
    accountId: "17841400000000000",
    accessToken: "IGQVJtoken",
  };

  it("posts a real direct message to the account messages endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.IG" }));

    const result = await sendMessage(
      "instagram",
      "5551234567890123",
      "Merhaba",
      IG_CREDENTIALS,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/messages",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { id: "5551234567890123" },
      message: { text: "Merhaba" },
    });
    expect(result).toEqual({
      success: true,
      messageId: "mid.IG",
      error: null,
      platform: "instagram",
    });
  });

  it("fails without calling the API when credentials are missing", async () => {
    const result = await sendMessage("instagram", "5551234567890123", "Merhaba");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/accountId|accessToken/i);
  });
});

describe("sendMessage on messenger", () => {
  const PAGE_CREDENTIALS = { pageId: "1029384756", accessToken: "EAAPagetoken" };

  it("posts a response message to the page messages endpoint", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ recipient_id: "2468013579", message_id: "m_abc" }),
    );

    const result = await sendMessage("facebook", "2468013579", "Hallo", PAGE_CREDENTIALS);

    const { url, init } = sentRequest();
    expect(url).toBe("https://graph.facebook.com/v21.0/1029384756/messages");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer EAAPagetoken",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { id: "2468013579" },
      messaging_type: "RESPONSE",
      message: { text: "Hallo" },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(result).toEqual({
      success: true,
      messageId: "m_abc",
      error: null,
      platform: "facebook",
    });
  });

  it("reports the graph error when messenger rejects the send", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(graphErrorBody("(#10) Outside the allowed window"), 400),
    );

    const result = await sendMessage("facebook", "2468013579", "Hallo", PAGE_CREDENTIALS);

    expect(result).toEqual({
      success: false,
      messageId: null,
      error: "(#10) Outside the allowed window",
      platform: "facebook",
    });
  });

  it("reports failure rather than throwing when the network call fails", async () => {
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const result = await sendMessage("facebook", "2468013579", "Hallo", PAGE_CREDENTIALS);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/socket hang up/);
  });

  it("fails without calling the API when credentials are missing", async () => {
    const result = await sendMessage("facebook", "fb_user_001", "Hi");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.messageId).toBeNull();
    expect(result.error).toMatch(/pageId|accessToken/i);
  });
});
