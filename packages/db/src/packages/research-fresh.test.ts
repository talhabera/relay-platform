import { describe, expect, it } from "vitest";
import { isResearchFresh } from "./research-fresh";

describe("isResearchFresh", () => {
  const now = new Date("2026-08-31T12:00:00.000Z");

  it("is false when researchedAt is null", () => {
    expect(isResearchFresh(null, 14, now)).toBe(false);
  });

  it("is true when researchedAt is within the window", () => {
    expect(
      isResearchFresh(new Date("2026-08-20T12:00:00.000Z"), 14, now),
    ).toBe(true);
  });

  it("is false when researchedAt is older than the window", () => {
    expect(
      isResearchFresh(new Date("2026-08-10T12:00:00.000Z"), 14, now),
    ).toBe(false);
  });
});
