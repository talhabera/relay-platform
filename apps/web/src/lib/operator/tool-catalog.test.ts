import { describe, expect, it } from "vitest";
import { isLiveOperatorTool, OPERATOR_TOOL_CATALOG } from "./tool-catalog";

describe("OPERATOR_TOOL_CATALOG", () => {
  it("marks companyMemory and proposeAction live", () => {
    expect(isLiveOperatorTool("companyMemory")).toBe(true);
    expect(isLiveOperatorTool("proposeAction")).toBe(true);
    expect(isLiveOperatorTool("whatsappNotification")).toBe(false);
  });

  it("keeps labels from the spec", () => {
    expect(
      OPERATOR_TOOL_CATALOG.find((t) => t.id === "companyMemory")?.label,
    ).toBe("Company memory");
    expect(
      OPERATOR_TOOL_CATALOG.find((t) => t.id === "proposeAction")?.label,
    ).toBe("Propose action");
  });

  it("does not include legacy httpApi", () => {
    expect(OPERATOR_TOOL_CATALOG.map((tool) => tool.id)).not.toContain("httpApi");
  });
});
