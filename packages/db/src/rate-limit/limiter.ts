import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  sanitizeCompanyOverrides,
  resolveConcurrencyPolicy,
  resolveRatePolicy,
  type ConcurrencyPolicyName,
  type RateLimitOverrides,
  type RatePolicyName,
} from "./policies";

/**
 * Storage the limiter needs. Postgres in production (shared by web, worker and
 * cron, and correct across replicas); an in-memory store for tests.
 */
export interface RateLimitStore {
  /** Add `cost` to the current window and return both windows' counts. */
  hit(input: {
    key: string;
    windowStart: Date;
    previousWindowStart: Date;
    cost: number;
    expiresAt: Date;
  }): Promise<{ current: number; previous: number }>;
  /** Take back a hit that was denied, so rejected calls do not extend a block. */
  undo(input: { key: string; windowStart: Date; cost: number }): Promise<void>;
  /** Insert a lease if fewer than `max` live leases hold `key`. */
  acquireLease(input: {
    key: string;
    max: number;
    ttlSec: number;
  }): Promise<string | null>;
  releaseLease(id: string): Promise<void>;
  prune(now: Date): Promise<void>;
  /** The company's own limits from Settings (`companies.rate_limits`). */
  companyOverrides(companyId: string): Promise<RateLimitOverrides>;
}

export type RateCheck = { policy: RatePolicyName; subject: string };
export type LeaseRequest = { policy: ConcurrencyPolicyName; subject: string };

export type RateDenied = {
  allowed: false;
  kind: "rate";
  policy: RatePolicyName;
  limit: number;
  windowSec: number;
  retryAfterSec: number;
};
export type RateDecision = { allowed: true } | RateDenied;

export type LeaseDenied = {
  acquired: false;
  kind: "concurrency";
  policy: ConcurrencyPolicyName;
  max: number;
  retryAfterSec: number;
};
export type LeaseDecision =
  | { acquired: true; release: () => Promise<void> }
  | LeaseDenied;

/** Seconds a denied concurrency caller should wait before retrying. */
const LEASE_RETRY_AFTER_SEC = 5;

export function rateKey(policy: string, subject: string): string {
  return `rate:${policy}:${subject}`;
}

export function leaseKey(policy: string, subject: string): string {
  return `lease:${policy}:${subject}`;
}

export function windowBounds(now: Date, windowSec: number) {
  const windowMs = windowSec * 1000;
  const startMs = Math.floor(now.getTime() / windowMs) * windowMs;
  return {
    windowStart: new Date(startMs),
    previousWindowStart: new Date(startMs - windowMs),
    elapsedFraction: (now.getTime() - startMs) / windowMs,
    remainingMs: startMs + windowMs - now.getTime(),
  };
}

/**
 * Sliding-window estimate: the previous window's count weighted by how much of
 * it still overlaps the trailing window, plus the current window's count.
 */
export function slidingEstimate(
  previous: number,
  current: number,
  elapsedFraction: number,
): number {
  return Math.floor(previous * (1 - elapsedFraction)) + current;
}

/**
 * Seconds until a hit of `cost` would fit under `limit`, given the counts
 * before that hit.
 */
export function retryAfterSeconds(input: {
  previous: number;
  current: number;
  cost: number;
  limit: number;
  windowSec: number;
  elapsedFraction: number;
}): number {
  const { previous, current, cost, limit, windowSec, elapsedFraction } = input;
  const windowMs = windowSec * 1000;
  const elapsedMs = elapsedFraction * windowMs;

  if (cost > limit) {
    return Math.ceil(2 * windowSec);
  }

  // Still inside this window: wait for the previous window to decay enough.
  const need = current + cost;
  if (need <= limit && previous > 0) {
    const fraction = 1 - (limit - need) / previous;
    const waitMs = fraction * windowMs - elapsedMs;
    return Math.max(1, Math.ceil(waitMs / 1000));
  }

  // The current window alone is full: the next window starts with this
  // window's count as its "previous", which then has to decay as well.
  const untilNextMs = windowMs - elapsedMs;
  const fraction = current > 0 ? Math.max(0, 1 - (limit - cost) / current) : 0;
  return Math.max(1, Math.ceil((untilNextMs + fraction * windowMs) / 1000));
}

/**
 * Consume one hit from every check, all or nothing. The first check that is
 * over its limit denies the call and every hit already taken is undone.
 *
 * Fails open: if the store errors, the call is allowed and the error logged.
 * The token budgets still cap spend when the limiter is unavailable, and the
 * same database outage would fail the request anyway.
 */
export async function consumeRateLimits(
  store: RateLimitStore,
  checks: RateCheck[],
  options: { now?: Date; cost?: number; overrides?: RateLimitOverrides } = {},
): Promise<RateDecision> {
  const now = options.now ?? new Date();
  const cost = options.cost ?? 1;
  const taken: Array<{ key: string; windowStart: Date }> = [];

  try {
    for (const check of checks) {
      const policy = resolveRatePolicy(check.policy, options.overrides);
      const key = rateKey(check.policy, check.subject);
      const bounds = windowBounds(now, policy.windowSec);

      const { current, previous } = await store.hit({
        key,
        windowStart: bounds.windowStart,
        previousWindowStart: bounds.previousWindowStart,
        cost,
        expiresAt: new Date(
          bounds.windowStart.getTime() + 2 * policy.windowSec * 1000,
        ),
      });
      taken.push({ key, windowStart: bounds.windowStart });

      const estimate = slidingEstimate(
        previous,
        current,
        bounds.elapsedFraction,
      );
      if (estimate > policy.limit) {
        await undoAll(store, taken, cost);
        return {
          allowed: false,
          kind: "rate",
          policy: check.policy,
          limit: policy.limit,
          windowSec: policy.windowSec,
          retryAfterSec: retryAfterSeconds({
            previous,
            current: current - cost,
            cost,
            limit: policy.limit,
            windowSec: policy.windowSec,
            elapsedFraction: bounds.elapsedFraction,
          }),
        };
      }
    }
    return { allowed: true };
  } catch (error) {
    console.error("[rate-limit] store failed; allowing request", error);
    return { allowed: true };
  }
}

async function undoAll(
  store: RateLimitStore,
  taken: Array<{ key: string; windowStart: Date }>,
  cost: number,
) {
  for (const entry of taken) {
    await store.undo({ ...entry, cost });
  }
}

/**
 * Acquire one lease per request, all or nothing. Hold the returned `release`
 * until the work finishes; call it exactly once (extra calls are no-ops).
 *
 * Fails open like `consumeRateLimits`.
 */
export async function acquireLeases(
  store: RateLimitStore,
  requests: LeaseRequest[],
  options: { overrides?: RateLimitOverrides } = {},
): Promise<LeaseDecision> {
  const held: string[] = [];
  const releaseHeld = async () => {
    const ids = held.splice(0);
    for (const id of ids) {
      try {
        await store.releaseLease(id);
      } catch (error) {
        // The lease expires on its own; a failed release only delays that.
        console.error("[rate-limit] lease release failed", error);
      }
    }
  };

  try {
    for (const request of requests) {
      const policy = resolveConcurrencyPolicy(request.policy, options.overrides);
      const id = await store.acquireLease({
        key: leaseKey(request.policy, request.subject),
        max: policy.max,
        ttlSec: policy.ttlSec,
      });
      if (!id) {
        await releaseHeld();
        return {
          acquired: false,
          kind: "concurrency",
          policy: request.policy,
          max: policy.max,
          retryAfterSec: LEASE_RETRY_AFTER_SEC,
        };
      }
      held.push(id);
    }
  } catch (error) {
    console.error("[rate-limit] lease store failed; allowing request", error);
  }

  return { acquired: true, release: releaseHeld };
}

export async function pruneRateLimits(
  store: RateLimitStore,
  now: Date = new Date(),
): Promise<void> {
  await store.prune(now);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPgDb = PostgresJsDatabase<any>;

type Row = Record<string, unknown>;

/** postgres-js returns the rows array itself; pg-style drivers wrap it. */
function rows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const wrapped = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(wrapped) ? (wrapped as Row[]) : [];
}

/** How long a process trusts a company's cached limits before re-reading. */
const COMPANY_OVERRIDES_TTL_MS = 30_000;
const companyOverridesCache = new Map<
  string,
  { value: RateLimitOverrides; expiresAt: number }
>();

/**
 * Drop a company's cached limits in this process, so a Settings save applies
 * immediately here. Other processes pick it up within the cache TTL.
 */
export function invalidateCompanyOverrides(companyId: string): void {
  companyOverridesCache.delete(companyId);
}

export function createPgRateLimitStore(db: AnyPgDb): RateLimitStore {
  return {
    async companyOverrides(companyId) {
      const cached = companyOverridesCache.get(companyId);
      if (cached && cached.expiresAt > Date.now()) return cached.value;
      const result = rows(
        await db.execute(sql`
          SELECT rate_limits FROM companies WHERE id = ${companyId}
        `),
      );
      const value = sanitizeCompanyOverrides(result[0]?.rate_limits);
      companyOverridesCache.set(companyId, {
        value,
        expiresAt: Date.now() + COMPANY_OVERRIDES_TTL_MS,
      });
      return value;
    },

    async hit({ key, windowStart, previousWindowStart, cost, expiresAt }) {
      const result = await db.execute(sql`
        WITH cur AS (
          INSERT INTO rate_limit_counters (key, window_start, count, expires_at)
          VALUES (${key}, ${windowStart.toISOString()}::timestamptz, ${cost}, ${expiresAt.toISOString()}::timestamptz)
          ON CONFLICT (key, window_start)
          DO UPDATE SET count = rate_limit_counters.count + EXCLUDED.count
          RETURNING count
        )
        SELECT
          (SELECT count FROM cur)::int AS current,
          COALESCE((
            SELECT count FROM rate_limit_counters
            WHERE key = ${key}
              AND window_start = ${previousWindowStart.toISOString()}::timestamptz
          ), 0)::int AS previous
      `);
      const row = rows(result)[0] ?? {};
      return {
        current: Number(row.current ?? cost),
        previous: Number(row.previous ?? 0),
      };
    },

    async undo({ key, windowStart, cost }) {
      await db.execute(sql`
        UPDATE rate_limit_counters
        SET count = GREATEST(count - ${cost}, 0)
        WHERE key = ${key}
          AND window_start = ${windowStart.toISOString()}::timestamptz
      `);
    },

    async acquireLease({ key, max, ttlSec }) {
      return db.transaction(async (tx) => {
        // Serialise acquirers of the same key so count-then-insert is atomic.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
        await tx.execute(sql`
          DELETE FROM rate_limit_leases
          WHERE key = ${key} AND expires_at <= now()
        `);
        const counted = rows(
          await tx.execute(sql`
            SELECT count(*)::int AS n FROM rate_limit_leases WHERE key = ${key}
          `),
        );
        if (Number(counted[0]?.n ?? 0) >= max) {
          return null;
        }
        const inserted = rows(
          await tx.execute(sql`
            INSERT INTO rate_limit_leases (key, expires_at)
            VALUES (${key}, now() + make_interval(secs => ${ttlSec}))
            RETURNING id
          `),
        );
        return (inserted[0]?.id as string | undefined) ?? null;
      });
    },

    async releaseLease(id) {
      await db.execute(sql`DELETE FROM rate_limit_leases WHERE id = ${id}`);
    },

    async prune(now) {
      const iso = now.toISOString();
      await db.execute(sql`
        DELETE FROM rate_limit_counters WHERE expires_at < ${iso}::timestamptz
      `);
      await db.execute(sql`
        DELETE FROM rate_limit_leases WHERE expires_at < ${iso}::timestamptz
      `);
    },
  };
}

/** In-process store for tests and local tooling. Not shared across processes. */
export function createMemoryRateLimitStore(
  clock: () => Date = () => new Date(),
  companies: Record<string, RateLimitOverrides> = {},
): RateLimitStore {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  const leases = new Map<string, { key: string; expiresAt: number }>();
  let nextId = 0;
  const counterKey = (key: string, windowStart: Date) =>
    `${key}@${windowStart.getTime()}`;

  return {
    async hit({ key, windowStart, previousWindowStart, cost, expiresAt }) {
      const k = counterKey(key, windowStart);
      const entry = counters.get(k) ?? { count: 0, expiresAt: expiresAt.getTime() };
      entry.count += cost;
      counters.set(k, entry);
      const previous = counters.get(counterKey(key, previousWindowStart))?.count ?? 0;
      return { current: entry.count, previous };
    },
    async undo({ key, windowStart, cost }) {
      const entry = counters.get(counterKey(key, windowStart));
      if (entry) entry.count = Math.max(0, entry.count - cost);
    },
    async acquireLease({ key, max, ttlSec }) {
      const now = clock().getTime();
      let live = 0;
      leases.forEach((lease, id) => {
        if (lease.key !== key) return;
        if (lease.expiresAt <= now) leases.delete(id);
        else live += 1;
      });
      if (live >= max) return null;
      const id = `lease-${++nextId}`;
      leases.set(id, { key, expiresAt: now + ttlSec * 1000 });
      return id;
    },
    async releaseLease(id) {
      leases.delete(id);
    },
    async companyOverrides(companyId) {
      return sanitizeCompanyOverrides(companies[companyId]);
    },
    async prune(now) {
      const t = now.getTime();
      counters.forEach((v, k) => {
        if (v.expiresAt < t) counters.delete(k);
      });
      leases.forEach((v, k) => {
        if (v.expiresAt < t) leases.delete(k);
      });
    },
  };
}
