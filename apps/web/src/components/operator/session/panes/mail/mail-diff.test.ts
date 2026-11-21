import { describe, expect, it } from "vitest";

import { diffParagraphs, diffWords } from "./mail-diff";

const tally = (segments: { change?: string }[]) => ({
  inserted: segments.filter((s) => s.change === "insert").length,
  removed: segments.filter((s) => s.change === "delete").length,
});

describe("diffWords", () => {
  it("returns one plain run when nothing changed", () => {
    expect(diffWords("Hi Julia,", "Hi Julia,")).toEqual([{ text: "Hi Julia," }]);
  });

  it("marks a replaced phrase as one delete run, a space, then one insert run", () => {
    expect(diffWords("Would a short call next week help?", "Would a free on-site consultation next week help?")).toEqual([
      { text: "Would a " },
      { text: "short call", change: "delete" },
      { text: " " },
      { text: "free on-site consultation", change: "insert" },
      { text: " next week help?" },
    ]);
  });

  it("handles a pure insert and a pure delete", () => {
    expect(diffWords("a b", "a x b")).toEqual([{ text: "a " }, { text: "x", change: "insert" }, { text: " b" }]);
    expect(diffWords("a x b", "a b")).toEqual([{ text: "a " }, { text: "x", change: "delete" }, { text: " b" }]);
  });

  it("treats an empty side as a whole insert or delete", () => {
    expect(diffWords("", "New line")).toEqual([{ text: "New line", change: "insert" }]);
    expect(diffWords("Old line", "")).toEqual([{ text: "Old line", change: "delete" }]);
  });

  it("folds a stray shared word into the rewrite and keeps the sent text intact", () => {
    const after = "I saw that Brandt opened an office. Acme cleans offices of 20 to 300 employees.";
    const segments = diffWords("I saw that Brandt opened an office. Many companies want to cut costs.", after);
    const norm = (text: string) => text.replace(/\s+/g, " ").trim();
    expect(norm(segments.filter((s) => s.change !== "delete").map((s) => s.text).join(""))).toBe(after);
    expect(tally(segments)).toEqual({ inserted: 1, removed: 1 });
  });

  it("keeps {{variables}} whole", () => {
    expect(diffWords("Hi {{first_name}},", "Hello {{first_name}},")).toEqual([
      { text: "Hi", change: "delete" },
      { text: " " },
      { text: "Hello", change: "insert" },
      { text: " {{first_name}}," },
    ]);
  });
});

describe("diffParagraphs", () => {
  it("without a previous version shows the body unmarked", () => {
    expect(diffParagraphs(undefined, ["One", "Two"])).toEqual([[{ text: "One" }], [{ text: "Two" }]]);
  });

  it("pairs paragraphs by position and marks added and dropped ones whole", () => {
    expect(diffParagraphs(["Same", "Gone"], ["Same"])).toEqual([[{ text: "Same" }], [{ text: "Gone", change: "delete" }]]);
    expect(diffParagraphs(["Same"], ["Same", "Added"])).toEqual([[{ text: "Same" }], [{ text: "Added", change: "insert" }]]);
  });
});
