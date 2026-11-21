import { describe, expect, it, vi } from "vitest";
import {
  GMAIL_SEND_SCOPE,
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  buildGoogleConsentUrl,
  createOAuthState,
  exchangeGoogleCode,
  googleOAuthConfig,
  revokeGoogleToken,
  verifyOAuthState,
} from "./google-workspace";

const config = {
  clientId: "cid",
  clientSecret: "csecret",
  redirectUri: "https://app.relay.dev/api/connectors/google-workspace/callback",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

describe("googleOAuthConfig", () => {
  it("needs the client id and secret, and derives the redirect from AUTH_URL", () => {
    expect(googleOAuthConfig({ AUTH_URL: "https://x" })).toBeNull();
    expect(
      googleOAuthConfig({
        GOOGLE_OAUTH_CLIENT_ID: "a",
        GOOGLE_OAUTH_CLIENT_SECRET: "b",
        AUTH_URL: "https://app.relay.dev/",
      }),
    ).toEqual({
      clientId: "a",
      clientSecret: "b",
      redirectUri: "https://app.relay.dev/api/connectors/google-workspace/callback",
    });
  });

  it("prefers an explicit redirect URI", () => {
    expect(
      googleOAuthConfig({
        GOOGLE_OAUTH_CLIENT_ID: "a",
        GOOGLE_OAUTH_CLIENT_SECRET: "b",
        GOOGLE_OAUTH_REDIRECT_URI: "https://r/cb",
      })?.redirectUri,
    ).toBe("https://r/cb");
  });
});

describe("buildGoogleConsentUrl", () => {
  it("asks for gmail.send only, offline, with consent", () => {
    const url = new URL(buildGoogleConsentUrl({ ...config, state: "s1" }));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")).toBe(`openid email ${GMAIL_SEND_SCOPE}`);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
  });
});

describe("OAuth state", () => {
  it("round-trips the company and user", () => {
    const state = createOAuthState({ companyId: "co-1", userId: "u-1" }, "secret");
    expect(verifyOAuthState(state, "secret")).toEqual({ companyId: "co-1", userId: "u-1" });
  });

  it("refuses a tampered, foreign or expired state", () => {
    const state = createOAuthState({ companyId: "co-1", userId: "u-1", now: 0 }, "secret");
    expect(verifyOAuthState(state, "other", 0)).toBeNull();
    expect(verifyOAuthState(state, "secret", 11 * 60 * 1000)).toBeNull();
    const [body, mac] = state.split(".");
    const forged = Buffer.from(
      JSON.stringify({ companyId: "co-2", userId: "u-1", exp: 1e15, nonce: "n" }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${mac}`, "secret", 0)).toBeNull();
    expect(verifyOAuthState(body, "secret", 0)).toBeNull();
    expect(verifyOAuthState(null, "secret")).toBeNull();
  });
});

describe("exchangeGoogleCode", () => {
  it("returns the refresh token and the connected mailbox", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        json({ access_token: "at", refresh_token: "rt", scope: `openid email ${GMAIL_SEND_SCOPE}` }),
      )
      .mockResolvedValueOnce(json({ email: "me@agency.com" }));
    await expect(exchangeGoogleCode({ config, code: "c1", fetchImpl })).resolves.toEqual({
      ok: true,
      refreshToken: "rt",
      email: "me@agency.com",
      scope: `openid email ${GMAIL_SEND_SCOPE}`,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(init.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("c1");
  });

  it("refuses a consent that left Gmail sending unchecked", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "at", refresh_token: "rt", scope: "openid email" }));
    const result = await exchangeGoogleCode({ config, code: "c1", fetchImpl });
    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("reports a failed exchange", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json({ error: "invalid_grant" }, 400));
    await expect(exchangeGoogleCode({ config, code: "c1", fetchImpl })).resolves.toMatchObject({
      ok: false,
    });
  });
});

describe("revokeGoogleToken", () => {
  it("posts the token and never throws", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(revokeGoogleToken("rt", fetchImpl)).resolves.toBe(true);
    expect(fetchImpl.mock.calls[0][0]).toBe(GOOGLE_REVOKE_URL);
    await expect(revokeGoogleToken("rt", vi.fn().mockRejectedValue(new Error("x")))).resolves.toBe(
      false,
    );
  });
});
