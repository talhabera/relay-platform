// Google Workspace connector (S73), Gmail send-only. The web app runs the
// OAuth consent and stores the refresh token on the company's
// `google_workspace` integration row; the worker trades it for a short-lived
// access token and sends one message per approved outreach checkpoint.

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

const REQUEST_TIMEOUT_MS = 15_000;

export type GoogleOAuthClient = { clientId: string; clientSecret: string };

/** The app's Google OAuth client from env; null when it is not configured. */
export function googleOAuthClient(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthClient | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  /** `revoked`: Google refused the refresh token; only a reconnect fixes it. */
  | { ok: false; revoked: boolean; error: string };

export async function refreshGoogleAccessToken(input: {
  client: GoogleOAuthClient;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<AccessTokenResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.client.clientId,
        client_secret: input.client.clientSecret,
        refresh_token: input.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, revoked: false, error: "Google sign-in is unreachable" };
  }

  const json = (await response.json().catch(() => null)) as {
    access_token?: unknown;
    error?: unknown;
  } | null;
  if (response.ok && typeof json?.access_token === "string") {
    return { ok: true, accessToken: json.access_token };
  }
  if (json?.error === "invalid_grant") {
    return {
      ok: false,
      revoked: true,
      error: "Google access was revoked. Reconnect Google Workspace.",
    };
  }
  return {
    ok: false,
    revoked: false,
    error: `Google sign-in answered ${response.status}`,
  };
}

/** Header values must stay on one line (no header injection from a draft). */
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

const EMAIL_PATTERN = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

export function isSendableEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/** RFC 2047 encoded-word for a non-ASCII header value. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function wrap76(base64: string): string {
  return base64.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/**
 * The base64url RFC 2822 message Gmail's `messages.send` takes as `raw`.
 * Plain text, UTF-8. `from` is the connected mailbox.
 */
export function buildGmailRawMessage(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    `From: ${oneLine(input.from)}`,
    `To: ${oneLine(input.to)}`,
    `Subject: ${encodeHeader(oneLine(input.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(input.body, "utf8").toString("base64")),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export type GmailSendResult =
  | { ok: true; messageId: string | null; threadId: string | null }
  | { ok: false; error: string };

export async function sendGmailMessage(input: {
  accessToken: string;
  raw: string;
  fetchImpl?: typeof fetch;
}): Promise<GmailSendResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: input.raw }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // A timeout may still have sent; the caller's receipt keeps Retry honest.
    return { ok: false, error: "Gmail is unreachable" };
  }

  const json = (await response.json().catch(() => null)) as {
    id?: unknown;
    threadId?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    const message =
      typeof json?.error?.message === "string" ? `: ${json.error.message}` : "";
    return { ok: false, error: `Gmail answered ${response.status}${message}` };
  }
  return {
    ok: true,
    messageId: typeof json?.id === "string" ? json.id : null,
    threadId: typeof json?.threadId === "string" ? json.threadId : null,
  };
}
