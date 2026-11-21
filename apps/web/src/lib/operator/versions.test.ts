import { describe, expect, it } from "vitest";
import { nextLiveStatuses } from "./versions";

describe("nextLiveStatuses", () => {
  it("drafts the current live and lives the target", () => {
    expect(nextLiveStatuses("ver-old", "ver-new")).toEqual({
      demoteId: "ver-old",
      promoteId: "ver-new",
    });
  });

  it("is a no-op when promoting the already-live version", () => {
    expect(nextLiveStatuses("ver-1", "ver-1")).toBeNull();
  });
});
