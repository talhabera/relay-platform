import { describe, expect, it } from "vitest";
import { assertWorkerSecret } from "./internal-auth";

describe("assertWorkerSecret", () => {
  it("accepts Bearer token matching secret", () => {
    expect(assertWorkerSecret("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("rejects missing, wrong, or empty secret", () => {
    expect(assertWorkerSecret(null, "s3cret")).toBe(false);
    expect(assertWorkerSecret("Bearer other", "s3cret")).toBe(false);
    expect(assertWorkerSecret("Bearer s3cret", "")).toBe(false);
    expect(assertWorkerSecret("s3cret", "s3cret")).toBe(false);
  });
});
