import { describe, expect, it } from "vitest";
import { CHAT_OUTPUT_CARD_CLASS } from "./chat-output-card";

describe("CHAT_OUTPUT_CARD_CLASS", () => {
  it("is a bordered card on product tokens", () => {
    expect(CHAT_OUTPUT_CARD_CLASS).toContain("rounded-xl");
    expect(CHAT_OUTPUT_CARD_CLASS).toContain("border");
    expect(CHAT_OUTPUT_CARD_CLASS).toContain("bg-card");
    expect(CHAT_OUTPUT_CARD_CLASS).not.toContain("rounded-md");
  });
});
