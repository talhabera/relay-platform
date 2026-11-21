import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verify Meta's `X-Hub-Signature-256` over the raw request body.
 * The caller must pass the exact bytes received — parsing the body first and
 * re-serialising it would change them and fail every check.
 * The digest must be exactly 64 hex characters (SHA-256 in hex is 256/4 = 64).
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string
): boolean {
  if (!header?.startsWith("sha256=")) return false;

  const digest = header.slice("sha256=".length);
  if (!/^[0-9a-f]{64}$/i.test(digest)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(digest, "hex");

  if (received.length !== expected.length) return false;
  return timingSafeEqual(received, expected);
}

/**
 * Meta's subscription handshake, shared by every webhook route. Answered only
 * for our verify token, so a stranger cannot point their app at this endpoint.
 */
export function challengeResponse(
  request: Request,
  verifyToken: string | undefined
): Response {
  const params = new URL(request.url).searchParams;

  if (
    verifyToken &&
    params.get("hub.mode") === "subscribe" &&
    params.get("hub.verify_token") === verifyToken
  ) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * The largest webhook body either route will read.
 *
 * Meta's own deliveries are a few kilobytes; a megabyte is generous. The cap
 * exists because the signature covers the exact bytes received, so the body
 * must be read in full *before* it can be authenticated — which means an
 * unauthenticated caller decides how much the web process buffers.
 */
export const META_MAX_BODY_BYTES = 1_000_000;

/**
 * Whether a request declares more body than we are willing to read.
 *
 * A missing or unparseable `Content-Length` returns false: the header is a
 * claim, not a guarantee, and refusing on its absence would reject legitimate
 * chunked deliveries. It is a cheap first filter, not the whole defence.
 */
export function bodyTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false;

  const declared = Number(contentLength);
  if (!Number.isFinite(declared)) return false;

  return declared > META_MAX_BODY_BYTES;
}
