import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The largest ad click body the endpoint will read. A click is one flat JSON
 * object of a dozen short strings; 4 KB is generous. The cap exists because
 * the signature covers the exact bytes received, so an unauthenticated caller
 * decides how much is buffered before it can be rejected.
 */
export const AD_CLICK_MAX_BODY_BYTES = 4096;

/** How far a signed `ts` may sit from our clock, either way. */
export const AD_CLICK_MAX_SKEW_SECONDS = 300;

/**
 * Verify koleva-web's `X-Koleva-Signature: sha256=<64 hex>` over the raw
 * request body, HMAC-SHA256 with the shared `AD_CLICK_HMAC_SECRET`. The caller
 * must pass the exact bytes received. Throws when the secret is missing: an
 * unconfigured server is a 500, never a silent pass or a 401.
 */
export function verifyClickSignature(
  rawBody: string,
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret) throw new Error("Ad click HMAC secret is not configured");
  if (!header?.startsWith("sha256=")) return false;

  const digest = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(digest)) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(digest, "hex");

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Whether a signed unix-seconds `ts` is within the replay window of `nowSeconds`.
 * The signature proves koleva-web sent the bytes; this bounds when.
 */
export function isFreshTimestamp(ts: number, nowSeconds: number): boolean {
  if (!Number.isInteger(ts)) return false;
  return Math.abs(nowSeconds - ts) <= AD_CLICK_MAX_SKEW_SECONDS;
}

/**
 * Whether a request declares more body than the click endpoint will read.
 * A missing or unparseable `Content-Length` returns false; the route checks
 * the bytes it actually read as well.
 */
export function clickBodyTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;

  const declared = Number(contentLength);
  if (!Number.isFinite(declared)) return false;

  return declared > AD_CLICK_MAX_BODY_BYTES;
}
