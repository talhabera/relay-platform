import { describe, expect, it } from "vitest";
import { toolTogglesSchema } from "./operator";

describe("toolTogglesSchema", () => {
  it("accepts the four live flags", () => {
    expect(
      toolTogglesSchema.parse({
        webSearch: true,
        excel: false,
        companyMemory: true,
        proposeAction: true,
      }),
    ).toEqual({
      webSearch: true,
      excel: false,
      companyMemory: true,
      proposeAction: true,
    });
  });

  it("rejects unknown keys", () => {
    expect(() =>
      toolTogglesSchema.parse({
        webSearch: false,
        excel: false,
        companyMemory: false,
        proposeAction: false,
        extra: true,
      }),
    ).toThrow();
  });
});
