import { describe, it, expect } from "vitest";
import { updateAgentSchema } from "./agent";

describe("updateAgentSchema", () => {
  it("accepts model keys on update", () => {
    expect(updateAgentSchema.parse({ model: "opus" }).model).toBe("opus");
    expect(() => updateAgentSchema.parse({ model: "fable" })).toThrow();
  });
});
