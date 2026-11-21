import { describe, expect, it } from "vitest";
import {
  PIPELINE_EMPTY,
  REVENUE_EMPTY_BODY,
  REVENUE_INSTALL_TOAST,
} from "./revenue-copy";

describe("revenue copy", () => {
  it("exports the locked English strings", () => {
    expect(REVENUE_EMPTY_BODY).toBe(
      "Revenue researches named accounts into company memory and drafts outreach that must be approved before send.",
    );
    expect(REVENUE_INSTALL_TOAST).toBe(
      "Add your offer under Knowledge so Revenue does not invent pricing.",
    );
    expect(PIPELINE_EMPTY).toBe("Name a company in a Revenue session.");
  });
});
