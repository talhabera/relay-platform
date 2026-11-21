import { createHmac, timingSafeEqual } from "node:crypto";

// Signed share links for report PDFs (S89, research #30): stateless,
// `<payload>.<signature>` in base64url, HMAC-SHA256 over the payload, checked
// with `timingSafeEqual`. The payload names one snapshot of one company and an
// expiry, so a link opens exactly that frozen report until it expires. The key
// is derived from `REPORT_SHARE_SECRET`, else `AUTH_SECRET`, under a fixed
// label so it never equals the session key. Links cannot be revoked one by
// one; rotating the secret revokes them all.

export const SHARE_LINK_DEFAULT_DAYS = 7;
export const SHARE_LINK_MAX_DAYS = 30;

const KEY_LABEL = "relay/report-share-link/v1";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Canonical form only: Node's base64url decoder skips characters outside the
 * alphabet, so without this `<payload>.<sig>!` would verify as the same link.
 * The signature is exactly one SHA-256 (43 characters, unpadded).
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{1,440}\.[A-Za-z0-9_-]{43}$/;

export type ReportShareClaims = { snapshotId: string; companyId: string; expiresAt: Date };

type Payload = { v: 1; s: string; c: string; e: number };

function shareKey(secret?: string): Buffer | null {
  const root = secret ?? process.env.REPORT_SHARE_SECRET ?? process.env.AUTH_SECRET;
  if (!root) return null;
  return createHmac("sha256", root).update(KEY_LABEL).digest();
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Null when no secret is configured. */
export function signReportShareToken(
  claims: ReportShareClaims,
  secret?: string,
): string | null {
  const key = shareKey(secret);
  if (!key) return null;
  const payload: Payload = {
    v: 1,
    s: claims.snapshotId,
    c: claims.companyId,
    e: Math.floor(claims.expiresAt.getTime() / 1000),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, key)}`;
}

/** The claims of a valid, unexpired token; null for anything else. */
export function verifyReportShareToken(
  token: string,
  now: Date = new Date(),
  secret?: string,
): ReportShareClaims | null {
  if (token.length > 512 || !TOKEN_SHAPE.test(token)) return null;
  const key = shareKey(secret);
  if (!key) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encoded, signature] = parts;

  const expected = Buffer.from(sign(encoded, key), "base64url");
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    payload.v !== 1 ||
    typeof payload.s !== "string" ||
    typeof payload.c !== "string" ||
    typeof payload.e !== "number"
  ) {
    return null;
  }
  const expiresAt = new Date(payload.e * 1000);
  if (expiresAt.getTime() <= now.getTime()) return null;
  return { snapshotId: payload.s, companyId: payload.c, expiresAt };
}

/** Expiry `days` (1..30, default 7) from `now`. */
export function shareLinkExpiry(now: Date, days: number = SHARE_LINK_DEFAULT_DAYS): Date {
  const clamped = Math.min(SHARE_LINK_MAX_DAYS, Math.max(1, Math.floor(days)));
  return new Date(now.getTime() + clamped * DAY_MS);
}
