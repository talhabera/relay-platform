import { describe, expect, it } from "vitest";
import { isChatBusy } from "./chat-status";

describe("isChatBusy", () => {
  it("treats submitted and streaming as busy", () => {
    expect(isChatBusy("submitted")).toBe(true);
    expect(isChatBusy("streaming")).toBe(true);
    expect(isChatBusy("ready")).toBe(false);
    expect(isChatBusy("error")).toBe(false);
  });
});
