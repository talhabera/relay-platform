import { describe, expect, it } from "vitest";
import { websiteToDomain } from "./website-domain";

describe("websiteToDomain", () => {
  it("normalizes https URL with www and path", () => {
    expect(websiteToDomain("https://www.Acme.com/path")).toBe("acme.com");
  });

  it("returns null for null input", () => {
    expect(websiteToDomain(null)).toBeNull();
  });

  it("returns null for garbage input", () => {
    expect(websiteToDomain("not-a-url")).toBeNull();
  });
});
