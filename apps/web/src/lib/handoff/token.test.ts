import { describe, expect, it } from "vitest";
import {
  createHandoffToken,
  handoffTokenMatches,
  hashHandoffToken,
  isWellFormedHandoffToken,
} from "./token";

describe("handoff quick-link token", () => {
  it("returns a URL-safe 256-bit token and its SHA-256 hex hash", () => {
    const { token, tokenHash } = createHandoffToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).toBe(hashHandoffToken(token));
  });

  it("never stores the token itself", () => {
    const { token, tokenHash } = createHandoffToken();
    expect(tokenHash).not.toContain(token);
  });

  it("is unique per call", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => createHandoffToken().token),
    );
    expect(tokens.size).toBe(200);
  });

  it("hashes deterministically", () => {
    expect(hashHandoffToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches only the token that produced the hash", () => {
    const a = createHandoffToken();
    const b = createHandoffToken();
    expect(handoffTokenMatches(a.token, a.tokenHash)).toBe(true);
    expect(handoffTokenMatches(b.token, a.tokenHash)).toBe(false);
    expect(handoffTokenMatches(a.token, "not-hex")).toBe(false);
  });

  it("rejects malformed tokens before lookup", () => {
    expect(isWellFormedHandoffToken(createHandoffToken().token)).toBe(true);
    expect(isWellFormedHandoffToken("short")).toBe(false);
    expect(isWellFormedHandoffToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(isWellFormedHandoffToken(undefined)).toBe(false);
  });
});
