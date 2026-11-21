import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipSubject } from "@relay/db";
import { db } from "@/db";
import { enforceSurface } from "@/lib/rate-limit";
import { POST } from "./route";

const SECRET = "click-hmac-secret";
const SALT = "click-ip-salt";
const COMPANY_ID = "00000000-0000-4000-8000-000000000001";
const VISITOR_IP = "203.0.113.7";
const DAY_MS = 24 * 60 * 60 * 1000;

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function clickBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    code: "G7KF3",
    channel: "google",
    ts: nowSeconds(),
    visitor_ip: VISITOR_IP,
    gclid: "Cj0KCQabc",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "site-arama",
    utm_term: "web sitesi yaptirma",
    utm_content: "rsa-1",
    landing_path: "/reklam/web-sitesi",
    ...overrides,
  });
}

function sign(raw: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function post(raw: string, signature: string | null = sign(raw), headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/webhooks/ad-click", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature ? { "x-koleva-signature": signature } : {}),
      ...headers,
    },
    body: raw,
  });
}

/** `db.insert(t).values(v).onConflictDoNothing(...).returning(...)`, capturing `v`. */
function mockInsert(returned: { id: string }[] = [{ id: "click-1" }]) {
  const values = vi.fn((_v: Record<string, unknown>) => ({
    onConflictDoNothing: vi.fn(() => ({
      returning: vi.fn(async () => returned),
    })),
  }));
  vi.mocked(db.insert).mockImplementation((() => ({ values })) as never);
  return values;
}

describe("POST /api/webhooks/ad-click", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AD_CLICK_HMAC_SECRET", SECRET);
    vi.stubEnv("AD_CLICK_IP_SALT", SALT);
    vi.stubEnv("AD_CLICK_COMPANY_ID", COMPANY_ID);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(["AD_CLICK_HMAC_SECRET", "AD_CLICK_IP_SALT", "AD_CLICK_COMPANY_ID"])(
    "returns 500 when %s is not configured",
    async (name) => {
      vi.stubEnv(name, "");
      const values = mockInsert();
      const raw = clickBody();

      const res = await POST(post(raw));

      expect(res.status).toBe(500);
      expect(values).not.toHaveBeenCalled();
    },
  );

  it("returns 413 on a declared body over 4 KB, before reading it", async () => {
    const values = mockInsert();
    const raw = clickBody();

    const res = await POST(post(raw, sign(raw), { "content-length": "4097" }));

    expect(res.status).toBe(413);
    expect(values).not.toHaveBeenCalled();
  });

  it("returns 413 on a body over 4 KB that declares no length", async () => {
    const values = mockInsert();
    const raw = clickBody({ utm_term: "x".repeat(5000) });

    const res = await POST(post(raw));

    expect(res.status).toBe(413);
    expect(values).not.toHaveBeenCalled();
  });

  it("returns 401 on a missing signature without inserting or rate limiting", async () => {
    const values = mockInsert();

    const res = await POST(post(clickBody(), null));

    expect(res.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
    expect(enforceSurface).not.toHaveBeenCalled();
  });

  it("returns 401 on a bad signature without inserting or rate limiting", async () => {
    const values = mockInsert();
    const raw = clickBody();

    const res = await POST(post(raw, sign(raw, "wrong-secret")));

    expect(res.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
    expect(enforceSurface).not.toHaveBeenCalled();
  });

  it("returns 401 on a signed timestamp outside the 300 s window", async () => {
    const values = mockInsert();
    const raw = clickBody({ ts: nowSeconds() - 301 });

    const res = await POST(post(raw));

    expect(res.status).toBe(401);
    expect(values).not.toHaveBeenCalled();
    expect(enforceSurface).not.toHaveBeenCalled();
  });

  it.each([
    ["signed non-JSON", "not json"],
    ["a bad code shape", clickBody({ code: "G7K" })],
    ["a confusable code character", clickBody({ code: "G70K3" })],
    ["an unknown channel", clickBody({ channel: "tiktok" })],
    ["a code prefix not matching the channel", clickBody({ code: "R7KF3" })],
    ["a meta channel with a non-M code", clickBody({ channel: "meta" })],
    ["an unknown key", clickBody({ referrer: "x" })],
    ["a null optional key", clickBody({ gclid: null })],
    ["an empty optional key", clickBody({ utm_source: "" })],
    ["a click id with whitespace", clickBody({ gclid: "Cj0 KCQ" })],
    ["a click id over 200 chars", clickBody({ fbclid: "a".repeat(201) })],
    ["a landing path with a query string", clickBody({ landing_path: "/reklam?x=1" })],
    ["a landing path without a leading slash", clickBody({ landing_path: "reklam" })],
    ["a missing visitor_ip", JSON.stringify({ ...JSON.parse(clickBody()), visitor_ip: undefined })],
    ["a non-integer ts", clickBody({ ts: nowSeconds() + 0.5 })],
  ])("returns 400 on a signed body with %s", async (_label, raw) => {
    const values = mockInsert();

    const res = await POST(post(raw));

    expect(res.status).toBe(400);
    expect(values).not.toHaveBeenCalled();
    expect(enforceSurface).not.toHaveBeenCalled();
  });

  it("records a valid click for the env company, expiring 7 days after creation", async () => {
    const values = mockInsert();
    const raw = clickBody();

    const res = await POST(post(raw));

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      companyId: COMPANY_ID,
      code: "G7KF3",
      channel: "google",
      gclid: "Cj0KCQabc",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "site-arama",
      utmTerm: "web sitesi yaptirma",
      utmContent: "rsa-1",
      landingPath: "/reklam/web-sitesi",
    });
    const createdAt = row.createdAt as Date;
    const expiresAt = row.expiresAt as Date;
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(7 * DAY_MS);
  });

  it("takes the tenant from the env, never from the body", async () => {
    const values = mockInsert();
    const raw = clickBody({ company_id: "00000000-0000-4000-8000-000000000002" });

    const res = await POST(post(raw));

    expect(res.status).toBe(400);
    expect(values).not.toHaveBeenCalled();
  });

  it("accepts an Instagram R code and a Meta M code", async () => {
    const values = mockInsert();
    const instagram = clickBody({ code: "R4BXZ", channel: "instagram" });
    const meta = clickBody({ code: "MWEB1", channel: "meta" });

    expect((await POST(post(instagram))).status).toBe(201);
    expect((await POST(post(meta))).status).toBe(201);
    expect(values).toHaveBeenCalledTimes(2);
  });

  it("never passes the visitor IP or any hash of it to the insert", async () => {
    const values = mockInsert();
    const raw = clickBody();
    const utcDay = new Date().toISOString().slice(0, 10);
    const subject = ipSubject(SALT, utcDay, VISITOR_IP);

    await POST(post(raw));

    const row = values.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(VISITOR_IP);
    expect(serialized).not.toContain(subject);
    expect(Object.keys(row).some((key) => /ip/i.test(key))).toBe(false);
  });

  it("rate-limits by the salted daily IP subject for the env company", async () => {
    mockInsert();
    const raw = clickBody();
    const utcDay = new Date().toISOString().slice(0, 10);

    await POST(post(raw));

    expect(enforceSurface).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      rate: [
        {
          policy: "adclick.ip.minute",
          subject: `${COMPANY_ID}:${ipSubject(SALT, utcDay, VISITOR_IP)}`,
        },
        { policy: "adclick.global.minute", subject: COMPANY_ID },
      ],
      leases: [],
    });
  });

  it("returns 409 on a duplicate code", async () => {
    mockInsert([]);
    const raw = clickBody();

    const res = await POST(post(raw));

    expect(res.status).toBe(409);
  });

  it("returns 429 when the limiter denies, with no insert", async () => {
    const values = mockInsert();
    vi.mocked(enforceSurface).mockResolvedValueOnce({
      ok: false,
      denial: { kind: "rate", policy: "adclick.ip.minute", limit: 10, retryAfterSec: 42 },
    } as never);
    const raw = clickBody();

    const res = await POST(post(raw));

    expect(res.status).toBe(429);
    expect(values).not.toHaveBeenCalled();
  });

  it("never echoes the secret, the body or the IP in a rejection or a log", async () => {
    mockInsert();
    const raw = clickBody({ channel: "tiktok" });

    const res = await POST(post(raw));
    const text = await res.text();

    expect(res.status).toBe(400);
    for (const leaked of [SECRET, SALT, VISITOR_IP, "tiktok"]) {
      expect(text).not.toContain(leaked);
    }
    const logged = JSON.stringify([
      ...vi.mocked(console.warn).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]);
    for (const leaked of [SECRET, SALT, VISITOR_IP, "tiktok"]) {
      expect(logged).not.toContain(leaked);
    }
  });
});
