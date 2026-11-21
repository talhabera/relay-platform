import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AD_CLICK_MAX_BODY_BYTES,
  clickBodyTooLarge,
  isFreshTimestamp,
  verifyClickSignature,
} from "./click-signature";

const SECRET = "click-secret";
const RAW = JSON.stringify({ code: "G7KF3", channel: "google", ts: 1793000000 });

function sign(raw: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

describe("verifyClickSignature", () => {
  it("accepts the HMAC-SHA256 of the exact raw body", () => {
    expect(verifyClickSignature(RAW, sign(RAW), SECRET)).toBe(true);
  });

  it("rejects a body with one byte flipped", () => {
    const flipped = RAW.replace("G7KF3", "G7KF4");
    expect(verifyClickSignature(flipped, sign(RAW), SECRET)).toBe(false);
  });

  it("rejects a signature made with another secret", () => {
    expect(verifyClickSignature(RAW, sign(RAW, "other"), SECRET)).toBe(false);
  });

  it("rejects a missing, unprefixed, wrong-length or non-hex header", () => {
    const digest = sign(RAW).slice("sha256=".length);
    expect(verifyClickSignature(RAW, null, SECRET)).toBe(false);
    expect(verifyClickSignature(RAW, digest, SECRET)).toBe(false);
    expect(verifyClickSignature(RAW, `sha256=${digest.slice(0, 62)}`, SECRET)).toBe(false);
    expect(verifyClickSignature(RAW, `sha256=${digest}00`, SECRET)).toBe(false);
    expect(verifyClickSignature(RAW, `sha256=${"z".repeat(64)}`, SECRET)).toBe(false);
  });

  it("throws when the secret is missing", () => {
    expect(() => verifyClickSignature(RAW, sign(RAW), undefined)).toThrow();
    expect(() => verifyClickSignature(RAW, sign(RAW), "")).toThrow();
  });
});

describe("isFreshTimestamp", () => {
  const now = 1793000000;

  it("accepts a timestamp within 300 s either way", () => {
    expect(isFreshTimestamp(now, now)).toBe(true);
    expect(isFreshTimestamp(now - 300, now)).toBe(true);
    expect(isFreshTimestamp(now + 300, now)).toBe(true);
  });

  it("rejects a timestamp older or newer than 300 s", () => {
    expect(isFreshTimestamp(now - 301, now)).toBe(false);
    expect(isFreshTimestamp(now + 301, now)).toBe(false);
  });

  it("rejects a non-integer timestamp", () => {
    expect(isFreshTimestamp(now + 0.5, now)).toBe(false);
    expect(isFreshTimestamp(Number.NaN, now)).toBe(false);
  });
});

describe("clickBodyTooLarge", () => {
  it("caps the declared body at 4 KB", () => {
    expect(AD_CLICK_MAX_BODY_BYTES).toBe(4096);
    expect(clickBodyTooLarge("4096")).toBe(false);
    expect(clickBodyTooLarge("4097")).toBe(true);
  });

  it("lets a missing or unparseable Content-Length through to the read", () => {
    expect(clickBodyTooLarge(null)).toBe(false);
    expect(clickBodyTooLarge("abc")).toBe(false);
  });
});
