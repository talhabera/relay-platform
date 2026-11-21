import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIp, holdUntilStreamEnds, rateLimitedResponse } from "./rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp", () => {
  it("takes the rightmost x-forwarded-for entry by default", () => {
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("honours TRUSTED_PROXY_HOPS", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    const h = new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" });
    expect(clientIp(h)).toBe("203.0.113.9");
  });

  it("prefers CLIENT_IP_HEADER when configured and present", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    const h = new Headers({
      "cf-connecting-ip": "198.51.100.1",
      "x-forwarded-for": "10.0.0.1",
    });
    expect(clientIp(h)).toBe("198.51.100.1");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(new Headers({ "x-real-ip": "192.0.2.4" }))).toBe("192.0.2.4");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("rateLimitedResponse", () => {
  it("returns 429 JSON with Retry-After and extra headers", async () => {
    const res = rateLimitedResponse(
      { acquired: false, kind: "concurrency", policy: "stream.chat", max: 1, retryAfterSec: 5 },
      { "Access-Control-Allow-Origin": "*" },
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(await res.json()).toMatchObject({ code: "too_many_concurrent", retryAfter: 5 });
  });
});

describe("holdUntilStreamEnds", () => {
  function streamOf(chunks: string[]) {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
  }

  it("releases once the body has been fully read", async () => {
    const release = vi.fn(async () => {});
    const res = holdUntilStreamEnds(
      new Response(streamOf(["a", "b"]), { headers: { "X-Chat-Id": "c1" } }),
      release,
    );
    expect(release).not.toHaveBeenCalled();
    expect(res.headers.get("X-Chat-Id")).toBe("c1");
    expect(await res.text()).toBe("ab");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases when the client cancels", async () => {
    const release = vi.fn(async () => {});
    const never = new ReadableStream<Uint8Array>({ pull() {} });
    const res = holdUntilStreamEnds(new Response(never), release);
    await res.body!.cancel();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases immediately for an error response", async () => {
    const release = vi.fn(async () => {});
    const res = holdUntilStreamEnds(new Response("nope", { status: 502 }), release);
    expect(res.status).toBe(502);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
