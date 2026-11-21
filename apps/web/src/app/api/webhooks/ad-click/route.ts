import { z } from "zod";
import {
  AD_CHANNELS,
  AD_CODE_PREFIX,
  CLICK_TTL_DAYS,
  adClicks,
  ipSubject,
  isValidAdCode,
} from "@relay/db";
import { db } from "@/db";
import {
  AD_CLICK_MAX_BODY_BYTES,
  clickBodyTooLarge,
  isFreshTimestamp,
  verifyClickSignature,
} from "@/lib/ads/click-signature";
import {
  RATE_LIMIT_SURFACES,
  enforceSurface,
  rateLimitedResponse,
} from "@/lib/rate-limit";

// `db` comes from "@/db" and the table from "@relay/db" on purpose: the web
// test setup mocks "@/db" as `{ db: mockDb }` only.

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Click ids and most `utm_*` values: at most 200 chars, no whitespace. */
const token = z.string().min(1).max(200).regex(/^\S+$/);
/** `utm_term` / `utm_content` may carry spaces, but no other whitespace. */
const phrase = z.string().min(1).max(200).regex(/^(?:\S| )+$/);

/**
 * The request contract koleva-web (KW2a) signs. One flat object; optional
 * keys are omitted when absent, never `null` or empty. Unknown keys, a
 * `company` field included, are rejected: the tenant comes from the env.
 */
const adClickSchema = z
  .strictObject({
    code: z.string().refine(isValidAdCode),
    channel: z.enum(AD_CHANNELS),
    ts: z.number().int(),
    visitor_ip: z.string().min(1).max(64),
    landing_path: z
      .string()
      .max(200)
      .regex(/^\/[^?\s]*$/),
    gclid: token.optional(),
    gbraid: token.optional(),
    wbraid: token.optional(),
    fbclid: token.optional(),
    utm_source: token.optional(),
    utm_medium: token.optional(),
    utm_campaign: token.optional(),
    utm_term: phrase.optional(),
    utm_content: phrase.optional(),
  })
  .refine((click) => click.code[0] === AD_CODE_PREFIX[click.channel]);

function reject(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/**
 * Record one ad click from koleva-web so the lead quoting its code can be
 * bound to it later (worker `recordLead`). Order: secrets, size cap, raw read,
 * signature, JSON, schema, freshness, rate limit, insert. Rejections log a
 * fixed reason only: never the body, the secret or the visitor IP.
 */
export async function POST(request: Request) {
  const secret = process.env.AD_CLICK_HMAC_SECRET;
  const salt = process.env.AD_CLICK_IP_SALT;
  const companyId = process.env.AD_CLICK_COMPANY_ID;
  if (!secret || !salt || !companyId) {
    console.error("[AdClick] endpoint is not configured");
    return reject(500, "not_configured");
  }

  // Checked before the read: the signature can only be verified once the
  // whole body is in memory, so the declared size is the first filter.
  if (clickBodyTooLarge(request.headers.get("content-length"))) {
    console.warn("[AdClick] refused an oversized body");
    return reject(413, "payload_too_large");
  }

  // The signature covers the exact bytes received: read text, then verify.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > AD_CLICK_MAX_BODY_BYTES) {
    console.warn("[AdClick] refused an oversized body");
    return reject(413, "payload_too_large");
  }

  if (!verifyClickSignature(rawBody, request.headers.get("x-koleva-signature"), secret)) {
    console.warn("[AdClick] rejected a bad signature");
    return reject(401, "invalid_signature");
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    console.warn("[AdClick] rejected a body that is not JSON");
    return reject(400, "invalid_body");
  }

  const parsed = adClickSchema.safeParse(json);
  if (!parsed.success) {
    console.warn("[AdClick] rejected an invalid body");
    return reject(400, "invalid_body");
  }

  const now = new Date();
  if (!isFreshTimestamp(parsed.data.ts, Math.floor(now.getTime() / 1000))) {
    console.warn("[AdClick] rejected a stale timestamp");
    return reject(401, "stale_timestamp");
  }

  // The visitor IP only becomes a salted, per-UTC-day rate-limit subject.
  // It is pulled out here so the insert below cannot receive it.
  const { visitor_ip: visitorIp, ...click } = parsed.data;
  const subject = ipSubject(salt, now.toISOString().slice(0, 10), visitorIp);

  try {
    // After the signature check, so unsigned traffic cannot fill the counters.
    const limited = await enforceSurface(
      RATE_LIMIT_SURFACES.adClick({ ipSubject: subject, companyId }),
    );
    if (!limited.ok) {
      console.warn("[AdClick] rate limited");
      return rateLimitedResponse(limited.denial);
    }
    await limited.release();

    const inserted = await db
      .insert(adClicks)
      .values({
        companyId,
        code: click.code,
        channel: click.channel,
        gclid: click.gclid,
        gbraid: click.gbraid,
        wbraid: click.wbraid,
        fbclid: click.fbclid,
        utmSource: click.utm_source,
        utmMedium: click.utm_medium,
        utmCampaign: click.utm_campaign,
        utmTerm: click.utm_term,
        utmContent: click.utm_content,
        landingPath: click.landing_path,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CLICK_TTL_DAYS * DAY_MS),
      })
      .onConflictDoNothing({ target: [adClicks.companyId, adClicks.code] })
      .returning({ id: adClicks.id });

    // The code is already stored for this company: koleva-web regenerates.
    if (inserted.length === 0) return reject(409, "duplicate_code");
  } catch {
    console.error("[AdClick] failed to record a click");
    return reject(500, "server_error");
  }

  return Response.json({ ok: true }, { status: 201 });
}
