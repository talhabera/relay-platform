import { describe, expect, it } from "vitest";
import { composerCopy } from "./composer-copy";

describe("composerCopy", () => {
  it("uses agent name for a blank operator and shows paperclip", () => {
    expect(composerCopy({ agentName: "Ops", packageSlug: null })).toEqual({
      heading: "Ops",
      placeholder: "Message Ops…",
      showPaperclip: true,
    });
  });

  it("uses research placeholder for Revenue", () => {
    expect(composerCopy({ agentName: "Revenue", packageSlug: "revenue" })).toEqual({
      heading: "Revenue",
      placeholder: "Name an account to research…",
      showPaperclip: true,
    });
  });
});
