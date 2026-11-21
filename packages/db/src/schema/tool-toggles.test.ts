import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOOL_TOGGLES,
  normalizeToolToggles,
} from "./agent-versions";

describe("normalizeToolToggles", () => {
  it("defaults missing keys to false", () => {
    expect(normalizeToolToggles({ webSearch: true })).toEqual({
      webSearch: true,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    });
  });

  it("omits legacy httpApi from stored JSON", () => {
    expect(
      normalizeToolToggles({
        webSearch: false,
        httpApi: true,
        excel: false,
        companyMemory: false,
        proposeAction: false,
      }),
    ).toEqual({
      webSearch: false,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    });
    expect(
      normalizeToolToggles({
        webSearch: false,
        httpApi: true,
        excel: false,
        companyMemory: false,
        proposeAction: false,
      }),
    ).not.toHaveProperty("httpApi");
  });
});

describe("DEFAULT_TOOL_TOGGLES", () => {
  it("is all false including new flags", () => {
    expect(DEFAULT_TOOL_TOGGLES).toEqual({
      webSearch: false,
      excel: false,
      companyMemory: false,
      proposeAction: false,
    });
    expect(DEFAULT_TOOL_TOGGLES).not.toHaveProperty("httpApi");
  });
});
