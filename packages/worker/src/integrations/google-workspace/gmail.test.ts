import { describe, expect, it, vi } from "vitest";
import {
  GMAIL_SEND_URL,
  GOOGLE_TOKEN_URL,
  buildGmailRawMessage,
  googleOAuthClient,
  isSendableEmail,
  refreshGoogleAccessToken,
  sendGmailMessage,
} from "./gmail";

const client = { clientId: "cid", clientSecret: "csecret" };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function decode(raw: string) {
  return Buffer.from(raw, "base64url").toString("utf8");
}

describe("googleOAuthClient", () => {
  it("needs both the client id and secret", () => {
    expect(googleOAuthClient({ GOOGLE_OAUTH_CLIENT_ID: "a" })).toBeNull();
    expect(
      googleOAuthClient({
        GOOGLE_OAUTH_CLIENT_ID: "a",
        GOOGLE_OAUTH_CLIENT_SECRET: "b",
      }),
    ).toEqual({ clientId: "a", clientSecret: "b" });
  });
});

describe("refreshGoogleAccessToken", () => {
  it("trades the refresh token for an access token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "at-1" }));
    await expect(
      refreshGoogleAccessToken({ client, refreshToken: "rt-1", fetchImpl }),
    ).resolves.toEqual({ ok: true, accessToken: "at-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(init.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-1");
    expect(form.get("client_id")).toBe("cid");
  });

  it("reports a revoked grant so the connector can ask for a reconnect", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "invalid_grant" }, 400));
    const result = await refreshGoogleAccessToken({ client, refreshToken: "rt", fetchImpl });
    expect(result).toMatchObject({ ok: false, revoked: true });
  });

  it("treats a network failure as transient", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const result = await refreshGoogleAccessToken({ client, refreshToken: "rt", fetchImpl });
    expect(result).toMatchObject({ ok: false, revoked: false });
  });
});

describe("buildGmailRawMessage", () => {
  it("builds a UTF-8 plain-text message", () => {
    const raw = buildGmailRawMessage({
      from: "me@agency.com",
      to: "ada@acme.com",
      subject: "Quick idea",
      body: "Merhaba Ada, nasılsın?",
    });
    expect(raw).not.toMatch(/[+/=]/);
    const text = decode(raw);
    expect(text).toContain("From: me@agency.com\r\n");
    expect(text).toContain("To: ada@acme.com\r\n");
    expect(text).toContain("Subject: Quick idea\r\n");
    expect(text).toContain('Content-Type: text/plain; charset="UTF-8"');
    const body = text.split("\r\n\r\n")[1].replace(/\r\n/g, "");
    expect(Buffer.from(body, "base64").toString("utf8")).toBe("Merhaba Ada, nasılsın?");
  });

  it("encodes a non-ASCII subject and strips header line breaks", () => {
    const text = decode(
      buildGmailRawMessage({
        from: "me@agency.com",
        to: "ada@acme.com\r\nBcc: evil@x.com",
        subject: "Görüşme\nBcc: evil@x.com",
        body: "Hi",
      }),
    );
    expect(text).not.toMatch(/^Bcc:/m);
    expect(text).toMatch(/^Subject: =\?UTF-8\?B\?.+\?=\r$/m);
  });
});

describe("isSendableEmail", () => {
  it("accepts one address and rejects lists or names", () => {
    expect(isSendableEmail("ada@acme.com")).toBe(true);
    expect(isSendableEmail("ada@acme.com, bob@acme.com")).toBe(false);
    expect(isSendableEmail("+905551112233")).toBe(false);
  });
});

describe("sendGmailMessage", () => {
  it("posts the raw message with the access token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "msg-1", threadId: "th-1" }));
    await expect(
      sendGmailMessage({ accessToken: "at", raw: "cmF3", fetchImpl }),
    ).resolves.toEqual({ ok: true, messageId: "msg-1", threadId: "th-1" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GMAIL_SEND_URL);
    expect(init.headers.Authorization).toBe("Bearer at");
    expect(JSON.parse(init.body)).toEqual({ raw: "cmF3" });
  });

  it("returns Gmail's error message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { message: "Invalid To header" } }, 400));
    await expect(
      sendGmailMessage({ accessToken: "at", raw: "x", fetchImpl }),
    ).resolves.toEqual({ ok: false, error: "Gmail answered 400: Invalid To header" });
  });
});
