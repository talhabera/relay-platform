import {
  createPgRateLimitStore,
  enforceRateLimits,
  rateLimitHeaders,
  rateLimitMessage,
  type EnforceResult,
  type RateLimitDenial,
  type RateLimitStore,
  type SurfaceLimits,
} from "@relay/db/rate-limit";
import { db } from "@/db";

export { RATE_LIMIT_SURFACES } from "@relay/db/rate-limit";

let store: RateLimitStore | null = null;

function getStore(): RateLimitStore {
  store ??= createPgRateLimitStore(db);
  return store;
}

/**
 * Apply a surface's limits (see `@relay/db/rate-limit` surfaces). On success,
 * call `release()` when the work ends, or pass it to `holdUntilStreamEnds`.
 */
export function enforceSurface(limits: SurfaceLimits): Promise<EnforceResult> {
  return enforceRateLimits(getStore(), limits);
}

export class RateLimitError extends Error {
  constructor(readonly denial: RateLimitDenial) {
    super(rateLimitMessage(denial));
    this.name = "RateLimitError";
  }
}

/**
 * For server actions and other non-streaming work: consume the surface's rate
 * checks or throw `RateLimitError`. Surfaces passed here must not use leases.
 */
export async function assertWithinLimits(limits: SurfaceLimits): Promise<void> {
  const result = await enforceSurface(limits);
  if (!result.ok) {
    throw new RateLimitError(result.denial);
  }
  await result.release();
}

export function rateLimitedResponse(
  denial: RateLimitDenial,
  extraHeaders: Record<string, string> = {},
): Response {
  return Response.json(
    {
      error: rateLimitMessage(denial),
      code: denial.kind === "rate" ? "rate_limited" : "too_many_concurrent",
      retryAfter: denial.retryAfterSec,
    },
    {
      status: 429,
      headers: { ...extraHeaders, ...rateLimitHeaders(denial) },
    },
  );
}

/**
 * The client IP as seen by our own reverse proxy.
 *
 * `X-Forwarded-For` is a list the client can prepend to, so its first entry is
 * attacker-controlled. Each trusted proxy appends the peer it saw; with
 * `TRUSTED_PROXY_HOPS` proxies in front of the app (default 1: Traefik), the
 * real client is that many entries from the right. Set `CLIENT_IP_HEADER`
 * (e.g. `cf-connecting-ip`) when a CDN in front sets a single trusted header.
 */
export function clientIp(headers: Headers): string {
  const dedicated = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (dedicated) {
    const value = headers.get(dedicated)?.trim();
    if (value) return value;
  }

  const hops = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1);
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (forwarded && forwarded.length > 0) {
    return forwarded[Math.max(0, forwarded.length - hops)]!;
  }

  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Return `res` with its body wrapped so `release` runs once the body has been
 * fully read, errors, or the client disconnects. Leases on streaming chat turns
 * are held for exactly as long as the stream is open.
 */
export function holdUntilStreamEnds(
  res: Response,
  release: () => Promise<void>,
): Response {
  let released = false;
  const done = () => {
    if (released) return;
    released = true;
    void release();
  };

  if (!res.body || !res.ok) {
    done();
    return res;
  }

  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done: finished, value } = await reader.read();
        if (finished) {
          controller.close();
          done();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        done();
      }
    },
    async cancel(reason) {
      done();
      await reader.cancel(reason);
    },
  });

  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}
