import { describe, expect, it } from "vitest";
import {
  FIT_SCORE_BORDERLINE,
  FIT_SCORE_QUALIFIED,
  fitScoreBand,
  isValidFitScore,
} from "./lead-scoring";

describe("fit score bands", () => {
  it("are the fixed phase 1 bands", () => {
    expect(FIT_SCORE_QUALIFIED).toBe(70);
    expect(FIT_SCORE_BORDERLINE).toBe(50);
  });

  it.each([
    [100, "qualified"],
    [70, "qualified"],
    [69, "borderline"],
    [50, "borderline"],
    [49, "rejected"],
    [0, "rejected"],
  ] as const)("puts %i in %s", (score, band) => {
    expect(fitScoreBand(score)).toBe(band);
  });

  it("has no band before the lead is scored", () => {
    expect(fitScoreBand(null)).toBeNull();
  });
});

describe("isValidFitScore", () => {
  it("accepts integers 0-100 only", () => {
    expect(isValidFitScore(0)).toBe(true);
    expect(isValidFitScore(100)).toBe(true);
    expect(isValidFitScore(101)).toBe(false);
    expect(isValidFitScore(-1)).toBe(false);
    expect(isValidFitScore(7.5)).toBe(false);
    expect(isValidFitScore("80")).toBe(false);
  });
});
