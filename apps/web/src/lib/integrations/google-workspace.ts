import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Google Workspace connector (S73): Gmail send-only OAuth. The owner signs in
// with Google from Settings › Connectors; the callback stores the refresh
// token on the company's `google_workspace` integration row and the worker
// sends approved email outreach with it. Calendar, sequences and reviews are
// phase 2, so the only Google API scope asked for is `gmail.send`.

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_WORKSPACE_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const GOOGLE_WORKSPACE_CALLBACK_PATH = "/api/connectors/google-workspace/callback";

const STATE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

/** The app's Google OAuth client from env; null when it is not configured. */
export function googleOAuthConfig(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const base = (env.AUTH_URL ?? env.NEXT_PUBLIC_APP_URL)?.trim();
  const redirectUri =
    env.GOOGLE_OAUTH_REDIRECT_URI?.trim() ||
    (base ? `${base.replace(/\/$/, "")}${GOOGLE_WORKSPACE_CALLBACK_PATH}` : "");
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function buildGoogleConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
    // Offline + consent: Google returns a refresh token every time, so a
    // reconnect always replaces a revoked one.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

type StatePayload = { companyId: string; userId: string; exp: number; nonce: string };

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

/**
 * Signed OAuth `state`: binds the consent to the company and to the person
 * who started it, so a callback link from someone else's consent is refused.
 */
export function createOAuthState(
  input: { companyId: string; userId: string; now?: number },
  secret: string,
): string {
  const payload: StatePayload = {
    companyId: input.companyId,
    userId: input.userId,
    exp: (input.now ?? Date.now()) + STATE_TTL_MS,
    nonce: randomBytes(12).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): { companyId: string; userId: string } | null {
  if (!state || !secret) return null;
  const [body, mac] = state.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    if (typeof payload.exp !== "number" || payload.exp < now) return null;
    if (typeof payload.companyId !== "string" || typeof payload.userId !== "string") {
      return null;
    }
    return { companyId: payload.companyId, userId: payload.userId };
  } catch {
    return null;
  }
}

export type GoogleConnectResult =
  | { ok: true; refreshToken: string; email: string; scope: string }
  | { ok: false; error: string };

/** Trade the consent code for tokens and read which mailbox was connected. */
export async function exchangeGoogleCode(input: {
  config: GoogleOAuthConfig;
  code: string;
  fetchImpl?: typeof fetch;
}): Promise<GoogleConnectResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let token: { access_token?: unknown; refresh_token?: unknown; scope?: unknown } | null;
  try {
    const res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        redirect_uri: input.config.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    token = (await res.json().catch(() => null)) as typeof token;
    if (!res.ok) return { ok: false, error: "Google sign-in failed. Try again." };
  } catch {
    return { ok: false, error: "Google sign-in is unreachable. Try again." };
  }

  const scope = typeof token?.scope === "string" ? token.scope : "";
  if (!scope.split(" ").includes(GMAIL_SEND_SCOPE)) {
    return {
      ok: false,
      error: "Allow Relay to send email as you, or approved outreach can't send from Gmail.",
    };
  }
  if (typeof token?.refresh_token !== "string" || typeof token.access_token !== "string") {
    return { ok: false, error: "Google didn't grant offline access. Try again." };
  }

  try {
    const res = await fetchImpl(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const info = (await res.json().catch(() => null)) as { email?: unknown } | null;
    if (!res.ok || typeof info?.email !== "string") {
      return { ok: false, error: "Couldn't read the Google account's email address." };
    }
    return { ok: true, refreshToken: token.refresh_token, email: info.email, scope };
  } catch {
    return { ok: false, error: "Google sign-in is unreachable. Try again." };
  }
}

/** Best effort: tell Google to drop Relay's access. Never throws. */
export async function revokeGoogleToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchImpl(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}
