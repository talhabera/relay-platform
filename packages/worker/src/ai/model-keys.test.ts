import { describe, expect, it } from "vitest";
import {
  DEFAULT_MASTER_MODEL_KEY,
  DEFAULT_MODEL_KEY,
  MODEL_IDS,
  isModelKey,
  resolveModelId,
} from "./model-keys";

describe("model keys", () => {
  it("maps haiku, sonnet, and opus to current Claude API IDs", () => {
    expect(MODEL_IDS.haiku).toBe("claude-haiku-4-5-20251001");
    expect(MODEL_IDS.sonnet).toBe("claude-sonnet-5");
    expect(MODEL_IDS.opus).toBe("claude-opus-5");
  });

  it("defaults customer/operator to haiku and master to sonnet", () => {
    expect(DEFAULT_MODEL_KEY).toBe("haiku");
    expect(DEFAULT_MASTER_MODEL_KEY).toBe("sonnet");
  });

  it("resolves known keys and falls back to haiku", () => {
    expect(isModelKey("sonnet")).toBe(true);
    expect(isModelKey("claude-sonnet-5")).toBe(false);
    expect(resolveModelId("opus")).toBe("claude-opus-5");
    expect(resolveModelId("nope")).toBe(MODEL_IDS.haiku);
    expect(resolveModelId(null)).toBe(MODEL_IDS.haiku);
    expect(resolveModelId(undefined)).toBe(MODEL_IDS.haiku);
  });
});
