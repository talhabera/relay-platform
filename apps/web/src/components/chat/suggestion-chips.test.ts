import { describe, expect, it } from "vitest";
import { suggestionChips } from "./suggestion-chips";

describe("suggestionChips", () => {
  it("returns Revenue chips", () => {
    expect(suggestionChips({ packageSlug: "revenue" })).toEqual([
      "Research an account",
      "Draft outreach for an account",
      "Who needs a follow-up?",
    ]);
  });

  it("returns a single chip for a blank operator", () => {
    expect(suggestionChips({ packageSlug: null })).toEqual(["What can you do?"]);
  });

  it("never includes Install Revenue", () => {
    const chips = suggestionChips({ packageSlug: "revenue" });
    expect(chips.join(" ")).not.toMatch(/install revenue/i);
  });
});
