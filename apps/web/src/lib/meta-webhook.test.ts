import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bodyTooLarge,
  challengeResponse,
  META_MAX_BODY_BYTES,
  verifyMetaSignature,
} from "./meta-webhook";

const SECRET = "app-secret-value";
const BODY = '{"object":"instagram"}';

function sign(raw: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  it("accepts a digest computed with the app secret", () => {
    expect(verifyMetaSignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rejects a digest computed with another secret", () => {
    expect(verifyMetaSignature(BODY, sign(BODY, "wrong"), SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaSignature(BODY, null, SECRET)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const bare = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(verifyMetaSignature(BODY, bare, SECRET)).toBe(false);
  });

  it("rejects a digest that is not 64 hex characters", () => {
    expect(verifyMetaSignature(BODY, "sha256=abc123", SECRET)).toBe(false);
  });

  it("rejects a body that differs by one byte", () => {
    expect(verifyMetaSignature(`${BODY} `, sign(BODY), SECRET)).toBe(false);
  });
});

describe("challengeResponse", () => {
  function request(query: string) {
    return new Request(`http://localhost:3000/api/webhooks/whatsapp?${query}`);
  }

  it("echoes the challenge for the configured verify token", async () => {
    const res = challengeResponse(
      request("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=1158201444"),
      "tok",
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });

  it("returns 403 for a wrong verify token", () => {
    const res = challengeResponse(
      request("hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1"),
      "tok",
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when the mode is not subscribe", () => {
    const res = challengeResponse(
      request("hub.mode=unsubscribe&hub.verify_token=tok&hub.challenge=1"),
      "tok",
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 when no verify token is configured", () => {
    const res = challengeResponse(
      request("hub.mode=subscribe&hub.verify_token=tok&hub.challenge=1"),
      undefined,
    );
    expect(res.status).toBe(403);
  });
});

describe("bodyTooLarge", () => {
  // Both webhook routes are public and must read the whole body before they
  // can check the signature, because the signature covers those exact bytes.
  // Without a limit, an unauthenticated request can make the web process
  // buffer an arbitrarily large string on every call.
  it("rejects a body larger than the cap", () => {
    expect(bodyTooLarge(String(META_MAX_BODY_BYTES + 1))).toBe(true);
  });

  it("allows a body at the cap", () => {
    expect(bodyTooLarge(String(META_MAX_BODY_BYTES))).toBe(false);
  });

  it("allows a request that declares no length", () => {
    expect(bodyTooLarge(null)).toBe(false);
  });

  it("allows a header that is not a number, leaving it to the read", () => {
    expect(bodyTooLarge("not-a-number")).toBe(false);
  });
});
