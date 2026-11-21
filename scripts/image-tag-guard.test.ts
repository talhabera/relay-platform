import { describe, expect, it } from "vitest";
import { missingImageTag, shouldRefuseLatest } from "./image-tag-guard";

describe("IMAGE_TAG guards", () => {
  it("requires IMAGE_TAG", () => {
    expect(missingImageTag(undefined)).toBe(true);
    expect(missingImageTag("")).toBe(true);
    expect(missingImageTag("preprod")).toBe(false);
  });

  it("refuses :latest off main", () => {
    expect(shouldRefuseLatest("publish", "latest", "feat/x")).toBe(true);
    expect(shouldRefuseLatest("publish", "latest", "main")).toBe(false);
    expect(shouldRefuseLatest("build", "latest", "feat/x")).toBe(false);
    expect(shouldRefuseLatest("publish", "preprod", "feat/x")).toBe(false);
  });
});
