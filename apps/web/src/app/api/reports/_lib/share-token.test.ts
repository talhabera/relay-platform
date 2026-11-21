import { describe, expect, it } from "vitest";

import { shareLinkExpiry, signReportShareToken, verifyReportShareToken } from "./share-token";

const SECRET = "test-secret";
const now = new Date("2026-09-25T08:00:00Z");
const claims = {
  snapshotId: "8f8b0a52-6a35-4bb4-9a0c-1c1d4a1f2e10",
  companyId: "0b7d2f0e-5a4c-4c1e-9f5e-2d1c3b4a5f60",
  expiresAt: new Date("2026-10-02T08:00:00Z"),
};

describe("report share token", () => {
  it("round-trips the snapshot, company and expiry", () => {
    const token = signReportShareToken(claims, SECRET)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyReportShareToken(token, now, SECRET)).toEqual(claims);
  });

  it("refuses an expired link", () => {
    const token = signReportShareToken(claims, SECRET)!;
    expect(verifyReportShareToken(token, new Date("2026-10-02T08:00:00Z"), SECRET)).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = signReportShareToken(claims, "other")!;
    expect(verifyReportShareToken(token, now, SECRET)).toBeNull();
  });

  it("refuses a tampered payload (another snapshot)", () => {
    const token = signReportShareToken(claims, SECRET)!;
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ v: 1, s: "another", c: claims.companyId, e: 1_900_000_000 }),
    ).toString("base64url");
    expect(verifyReportShareToken(`${forged}.${signature}`, now, SECRET)).toBeNull();
  });

  it("refuses non-canonical spellings of a valid token (S94)", () => {
    const token = signReportShareToken(claims, SECRET)!;
    const [payload, signature] = token.split(".");
    // Node's base64url decoder skips these, so they would decode to the same bytes.
    for (const variant of [`${token}!`, `${payload}.${signature}=`, `${payload}.%${signature}`, `${payload}!.${signature}`, ` ${token}`]) {
      expect(verifyReportShareToken(variant, now, SECRET)).toBeNull();
    }
  });

  it.each(["", "abc", "a.b.c", ".x", "x.", "x".repeat(600)])("refuses malformed %#", (token) => {
    expect(verifyReportShareToken(token, now, SECRET)).toBeNull();
  });

  it("is unavailable without a secret", () => {
    const saved = { share: process.env.REPORT_SHARE_SECRET, auth: process.env.AUTH_SECRET };
    delete process.env.REPORT_SHARE_SECRET;
    delete process.env.AUTH_SECRET;
    try {
      expect(signReportShareToken(claims)).toBeNull();
    } finally {
      if (saved.share !== undefined) process.env.REPORT_SHARE_SECRET = saved.share;
      if (saved.auth !== undefined) process.env.AUTH_SECRET = saved.auth;
    }
  });
});

describe("shareLinkExpiry", () => {
  it("defaults to 7 days and clamps to 1..30", () => {
    expect(shareLinkExpiry(now).toISOString()).toBe("2026-10-02T08:00:00.000Z");
    expect(shareLinkExpiry(now, 0).toISOString()).toBe("2026-09-26T08:00:00.000Z");
    expect(shareLinkExpiry(now, 90).toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
});
