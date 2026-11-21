import { describe, expect, it } from "vitest";
import { selectTools } from "./tools";

describe("customer tools isolation", () => {
  it("does not register operator research tools", () => {
    const keys = Object.keys(selectTools([], "agent-1", []));

    expect(keys).not.toContain("researchAccount");
    expect(keys).not.toContain("hunter_findEmails");
    expect(keys).not.toContain("snov_findEmails");
    expect(keys).not.toContain("googlePlaces_searchCompany");
  });
});
