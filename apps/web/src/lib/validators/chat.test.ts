import { describe, expect, it } from "vitest";
import { renameChatSchema } from "./chat";

describe("renameChatSchema", () => {
  it("trims and accepts a non-empty title", () => {
    expect(renameChatSchema.parse({ title: "  Ops planning  " })).toEqual({
      title: "Ops planning",
    });
  });

  it("rejects an empty title", () => {
    expect(() => renameChatSchema.parse({ title: "   " })).toThrow();
  });

  it("rejects titles longer than 60 characters", () => {
    expect(() =>
      renameChatSchema.parse({ title: "a".repeat(61) }),
    ).toThrow();
  });
});
