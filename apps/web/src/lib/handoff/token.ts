import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Quick-link tokens. The raw token only ever exists in the link sent to the
 * recipient; the database keeps its SHA-256 (`handoff_requests.token_hash`),
 * so a leaked table cannot be replayed as links.
 */
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashHandoffToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createHandoffToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashHandoffToken(token) };
}

/** Shape check before any lookup, so junk from a URL never reaches the database. */
export function isWellFormedHandoffToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

/** Constant-time comparison of a presented token against a stored hash. */
export function handoffTokenMatches(token: string, tokenHash: string): boolean {
  const presented = Buffer.from(hashHandoffToken(token), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
