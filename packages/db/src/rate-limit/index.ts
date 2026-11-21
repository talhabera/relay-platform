import {
  acquireLeases,
  consumeRateLimits,
  type LeaseDenied,
  type RateDenied,
  type RateLimitStore,
} from "./limiter";
import type { SurfaceLimits } from "./surfaces";
import type { RateLimitOverrides } from "./policies";

export * from "./policies";
export * from "./limiter";
export * from "./surfaces";

export type RateLimitDenial = RateDenied | LeaseDenied;

export type EnforceResult =
  | { ok: true; release: () => Promise<void> }
  | { ok: false; denial: RateLimitDenial };

/**
 * Apply a surface's limits: consume its rate checks, then acquire its leases.
 * On success the caller must call `release()` when the work ends (a no-op for
 * surfaces without leases).
 */
export async function enforceRateLimits(
  store: RateLimitStore,
  limits: SurfaceLimits,
  options: { now?: Date } = {},
): Promise<EnforceResult> {
  const overrides = limits.companyId
    ? await loadOverrides(store, limits.companyId)
    : undefined;
  const rate = await consumeRateLimits(store, limits.rate, {
    ...options,
    overrides,
  });
  if (!rate.allowed) {
    return { ok: false, denial: rate };
  }
  if (limits.leases.length === 0) {
    return { ok: true, release: async () => {} };
  }
  const lease = await acquireLeases(store, limits.leases, { overrides });
  if (!lease.acquired) {
    return { ok: false, denial: lease };
  }
  return { ok: true, release: lease.release };
}

/** A failed settings read falls back to platform defaults, never blocks. */
async function loadOverrides(
  store: RateLimitStore,
  companyId: string,
): Promise<RateLimitOverrides | undefined> {
  try {
    return await store.companyOverrides(companyId);
  } catch (error) {
    console.error("[rate-limit] company overrides unavailable; using defaults", error);
    return undefined;
  }
}

/** Standard 429 headers (IETF RateLimit draft + Retry-After). */
export function rateLimitHeaders(denial: RateLimitDenial): Record<string, string> {
  const limit = denial.kind === "rate" ? denial.limit : denial.max;
  const headers: Record<string, string> = {
    "Retry-After": String(denial.retryAfterSec),
    "RateLimit-Policy":
      denial.kind === "rate"
        ? `${denial.limit};w=${denial.windowSec}`
        : `${denial.max};concurrent`,
    "RateLimit": `limit=${limit}, remaining=0, reset=${denial.retryAfterSec}`,
  };
  return headers;
}

/** User-facing message for a denial. Never names internal subjects. */
export function rateLimitMessage(denial: RateLimitDenial): string {
  if (denial.kind === "concurrency") {
    return "Another response is still in progress. Wait for it to finish, then try again.";
  }
  return `Too many requests. Try again in ${denial.retryAfterSec} seconds.`;
}
