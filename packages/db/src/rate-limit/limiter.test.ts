import { afterEach, describe, expect, it, vi } from "vitest";
import {
  POLICY_META,
  platformDefault,
  sanitizeCompanyOverrides,
  RATE_LIMIT_SURFACES,
  RATE_POLICIES,
  acquireLeases,
  consumeRateLimits,
  createMemoryRateLimitStore,
  enforceRateLimits,
  rateLimitHeaders,
  resolveRatePolicy,
  retryAfterSeconds,
  slidingEstimate,
  windowBounds,
  type RateLimitStore,
} from "./index";

const T0 = new Date("2026-09-26T10:00:00.000Z"); // aligned to minute and hour

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sliding window math", () => {
  it("weights the previous window by its remaining overlap", () => {
    expect(slidingEstimate(10, 2, 0.25)).toBe(Math.floor(10 * 0.75) + 2);
    expect(slidingEstimate(10, 2, 0)).toBe(12);
    expect(slidingEstimate(10, 2, 1)).toBe(2);
  });

  it("aligns windows to epoch multiples", () => {
    const b = windowBounds(new Date(T0.getTime() + 15_000), 60);
    expect(b.windowStart.toISOString()).toBe(T0.toISOString());
    expect(b.previousWindowStart.getTime()).toBe(T0.getTime() - 60_000);
    expect(b.elapsedFraction).toBeCloseTo(0.25);
  });

  it("retry-after waits for the current window to roll when it is full", () => {
    // 10/10 used in current window, halfway through a 60s window.
    const s = retryAfterSeconds({
      previous: 0,
      current: 10,
      cost: 1,
      limit: 10,
      windowSec: 60,
      elapsedFraction: 0.5,
    });
    // 30s to roll + time for 10 to decay to 9 in the next window (10% of 60s).
    expect(s).toBe(36);
  });

  it("retry-after waits for previous-window decay when current has room", () => {
    const s = retryAfterSeconds({
      previous: 10,
      current: 0,
      cost: 1,
      limit: 10,
      windowSec: 60,
      elapsedFraction: 0,
    });
    expect(s).toBe(6);
  });
});

describe("consumeRateLimits", () => {
  it("allows up to the limit then denies with retry-after", async () => {
    const store = createMemoryRateLimitStore();
    const check = [{ policy: "upload.user.minute" as const, subject: "u1" }];
    const { limit } = RATE_POLICIES["upload.user.minute"];

    for (let i = 0; i < limit; i++) {
      expect((await consumeRateLimits(store, check, { now: T0 })).allowed).toBe(true);
    }
    const denied = await consumeRateLimits(store, check, { now: T0 });
    expect(denied).toMatchObject({ allowed: false, policy: "upload.user.minute", limit });
    if (!denied.allowed) expect(denied.retryAfterSec).toBeGreaterThan(0);
  });

  it("does not count denied hits, so hammering does not extend the block", async () => {
    const store = createMemoryRateLimitStore();
    const check = [{ policy: "upload.user.minute" as const, subject: "u1" }];
    const { limit } = RATE_POLICIES["upload.user.minute"];
    for (let i = 0; i < limit + 50; i++) {
      await consumeRateLimits(store, check, { now: T0 });
    }
    // Two windows later everything has decayed.
    const later = new Date(T0.getTime() + 120_000);
    expect((await consumeRateLimits(store, check, { now: later })).allowed).toBe(true);
    // One window later the previous window counts limit (not limit + 50), so
    // halfway through it half the budget is back.
    const store2 = createMemoryRateLimitStore();
    for (let i = 0; i < limit + 50; i++) {
      await consumeRateLimits(store2, check, { now: T0 });
    }
    const halfway = new Date(T0.getTime() + 90_000);
    let allowed = 0;
    for (let i = 0; i < limit; i++) {
      if ((await consumeRateLimits(store2, check, { now: halfway })).allowed) allowed++;
    }
    expect(allowed).toBe(Math.ceil(limit / 2));
  });

  it("is all or nothing across checks", async () => {
    const store = createMemoryRateLimitStore();
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "widget.company.minute": 1 }));
    const limits = RATE_LIMIT_SURFACES.widgetChat({ companyId: "c1", visitor: "1.1.1.1" });

    expect((await consumeRateLimits(store, limits.rate, { now: T0 })).allowed).toBe(true);
    const denied = await consumeRateLimits(store, limits.rate, { now: T0 });
    expect(denied).toMatchObject({ allowed: false, policy: "widget.company.minute" });

    // The visitor buckets were refunded: only the first call counted.
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "widget.visitor.minute": 1 }));
    const second = await consumeRateLimits(
      store,
      RATE_LIMIT_SURFACES.widgetChat({ companyId: "c1", visitor: "1.1.1.1" }).rate,
      { now: T0 },
    );
    expect(second).toMatchObject({ allowed: false, policy: "widget.visitor.minute" });
  });

  it("keeps companies isolated for the same visitor IP", async () => {
    const store = createMemoryRateLimitStore();
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "widget.visitor.minute": 1 }));
    const a = RATE_LIMIT_SURFACES.widgetChat({ companyId: "a", visitor: "9.9.9.9" });
    const b = RATE_LIMIT_SURFACES.widgetChat({ companyId: "b", visitor: "9.9.9.9" });
    expect((await consumeRateLimits(store, a.rate, { now: T0 })).allowed).toBe(true);
    expect((await consumeRateLimits(store, b.rate, { now: T0 })).allowed).toBe(true);
    expect((await consumeRateLimits(store, a.rate, { now: T0 })).allowed).toBe(false);
  });

  it("fails open when the store throws", async () => {
    const broken = {
      hit: vi.fn().mockRejectedValue(new Error("db down")),
    } as unknown as RateLimitStore;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await consumeRateLimits(broken, [
      { policy: "upload.user.minute", subject: "u" },
    ]);
    expect(res.allowed).toBe(true);
    spy.mockRestore();
  });
});

describe("overrides", () => {
  it("applies valid numeric overrides and ignores junk", () => {
    vi.stubEnv(
      "RATE_LIMIT_OVERRIDES",
      JSON.stringify({ "upload.user.minute": 3, "master.chat.user.minute": "x" }),
    );
    expect(resolveRatePolicy("upload.user.minute").limit).toBe(3);
    expect(resolveRatePolicy("master.chat.user.minute").limit).toBe(
      RATE_POLICIES["master.chat.user.minute"].limit,
    );
  });

  it("ignores invalid JSON", () => {
    vi.stubEnv("RATE_LIMIT_OVERRIDES", "{nope");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveRatePolicy("upload.user.minute").limit).toBe(
      RATE_POLICIES["upload.user.minute"].limit,
    );
    spy.mockRestore();
  });
});

describe("leases", () => {
  it("allows one stream per chat and frees it on release", async () => {
    const store = createMemoryRateLimitStore();
    const req = [{ policy: "stream.chat" as const, subject: "chat-1" }];
    const first = await acquireLeases(store, req);
    expect(first.acquired).toBe(true);
    const second = await acquireLeases(store, req);
    expect(second).toMatchObject({ acquired: false, policy: "stream.chat" });
    if (first.acquired) {
      await first.release();
      await first.release(); // idempotent
    }
    expect((await acquireLeases(store, req)).acquired).toBe(true);
  });

  it("expires leases that are never released", async () => {
    let now = T0;
    const store = createMemoryRateLimitStore(() => now);
    const req = [{ policy: "stream.chat" as const, subject: "chat-1" }];
    expect((await acquireLeases(store, req)).acquired).toBe(true);
    expect((await acquireLeases(store, req)).acquired).toBe(false);
    now = new Date(T0.getTime() + 10 * 60_000);
    expect((await acquireLeases(store, req)).acquired).toBe(true);
  });

  it("releases already-held leases when a later one is denied", async () => {
    const store = createMemoryRateLimitStore();
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "stream.company": 0 }));
    const limits = RATE_LIMIT_SURFACES.operatorChat({
      userId: "u",
      companyId: "c",
      chatId: "chat",
    });
    const denied = await acquireLeases(store, limits.leases);
    expect(denied).toMatchObject({ acquired: false, policy: "stream.company" });
    vi.stubEnv("RATE_LIMIT_OVERRIDES", "");
    // stream.chat was released, so the same chat can stream now.
    expect((await acquireLeases(store, limits.leases)).acquired).toBe(true);
  });
});

describe("company settings", () => {
  it("company value beats env beats default, clamped to the ceiling", () => {
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "master.chat.user.minute": 7 }));
    expect(resolveRatePolicy("master.chat.user.minute").limit).toBe(7);
    expect(resolveRatePolicy("master.chat.user.minute", { "master.chat.user.minute": 50 }).limit).toBe(50);
    const ceiling = POLICY_META["master.chat.user.minute"]!.ceiling;
    expect(
      resolveRatePolicy("master.chat.user.minute", { "master.chat.user.minute": 1e9 }).limit,
    ).toBe(ceiling);
  });

  it("sanitizes stored settings", () => {
    expect(
      sanitizeCompanyOverrides({
        "operator.chat.user.minute": 25.9,
        "stream.chat": 5, // not settable
        "upload.user.minute": 100, // platform-only
        "nope": 3,
        "widget.visitor.minute": -1,
        "cron.run.job.hour": "12",
      }),
    ).toEqual({ "operator.chat.user.minute": 25 });
    expect(sanitizeCompanyOverrides(null)).toEqual({});
    expect(sanitizeCompanyOverrides([1])).toEqual({});
  });

  it("every settable policy has a ceiling at or above its default", () => {
    for (const [name, meta] of Object.entries(POLICY_META)) {
      expect(meta!.ceiling, name).toBeGreaterThanOrEqual(platformDefault(name as never));
    }
  });

  it("enforceRateLimits applies the surface company's settings", async () => {
    const store = createMemoryRateLimitStore(undefined, {
      c1: { "cron.run.job.hour": 1 },
    });
    const limits = RATE_LIMIT_SURFACES.cronRun({ companyId: "c1", jobId: "j" });
    expect((await enforceRateLimits(store, limits, { now: T0 })).ok).toBe(true);
    const second = await enforceRateLimits(store, limits, { now: T0 });
    expect(second).toMatchObject({ ok: false, denial: { policy: "cron.run.job.hour", limit: 1 } });

    // Another company keeps the default.
    const other = RATE_LIMIT_SURFACES.cronRun({ companyId: "c2", jobId: "k" });
    expect((await enforceRateLimits(store, other, { now: T0 })).ok).toBe(true);
    expect((await enforceRateLimits(store, other, { now: T0 })).ok).toBe(true);
  });

  it("falls back to defaults when the settings read fails", async () => {
    const store = createMemoryRateLimitStore();
    store.companyOverrides = vi.fn().mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await enforceRateLimits(
      store,
      RATE_LIMIT_SURFACES.cronRun({ companyId: "c1", jobId: "j" }),
      { now: T0 },
    );
    expect(res.ok).toBe(true);
    spy.mockRestore();
  });
});

describe("surface arrangement", () => {
  it("keeps widget streams out of the internal company pool", async () => {
    const store = createMemoryRateLimitStore();
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "stream.widget.company": 1 }));
    const widget = await acquireLeases(
      store,
      RATE_LIMIT_SURFACES.widgetChat({ companyId: "c", visitor: "1.1.1.1" }).leases,
    );
    expect(widget.acquired).toBe(true);
    // Widget pool is full, but an operator session in the same company streams.
    const operator = await acquireLeases(
      store,
      RATE_LIMIT_SURFACES.operatorChat({ userId: "u", companyId: "c", chatId: "x" }).leases,
    );
    expect(operator.acquired).toBe(true);
  });
});

describe("enforceRateLimits", () => {
  it("returns a denial with 429 headers", async () => {
    const store = createMemoryRateLimitStore();
    vi.stubEnv("RATE_LIMIT_OVERRIDES", JSON.stringify({ "cron.approval.user.minute": 0 }));
    const res = await enforceRateLimits(store, RATE_LIMIT_SURFACES.cronApproval({ userId: "u" }), {
      now: T0,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const headers = rateLimitHeaders(res.denial);
      expect(Number(headers["Retry-After"])).toBeGreaterThan(0);
      expect(headers["RateLimit-Policy"]).toBe("0;w=60");
    }
  });

  it("holds leases until release", async () => {
    const store = createMemoryRateLimitStore();
    const limits = RATE_LIMIT_SURFACES.masterChat({ userId: "u", companyId: "c", chatId: "x" });
    const first = await enforceRateLimits(store, limits, { now: T0 });
    expect(first.ok).toBe(true);
    const second = await enforceRateLimits(store, limits, { now: T0 });
    expect(second).toMatchObject({ ok: false, denial: { kind: "concurrency" } });
    if (first.ok) await first.release();
    expect((await enforceRateLimits(store, limits, { now: T0 })).ok).toBe(true);
  });
});
