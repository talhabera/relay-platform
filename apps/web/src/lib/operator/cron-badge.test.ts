import { describe, expect, it } from "vitest";
import {
  cronJobBadge,
  cronRunStatusTone,
  cronRunStatusLabel,
} from "./cron-badge";

describe("cronJobBadge", () => {
  it("maps active statuses to legacy badges", () => {
    expect(cronJobBadge({ latestStatus: "awaiting_input" })).toBe(
      "needs approval",
    );
    expect(cronJobBadge({ latestStatus: "running" })).toBe("running");
    expect(cronJobBadge({ latestStatus: "failed" })).toBe("idle");
    expect(cronJobBadge({ latestStatus: "succeeded" })).toBe("idle");
    expect(cronJobBadge({ latestStatus: null })).toBe("idle");
  });
});

describe("cronRunStatusLabel", () => {
  it("maps each run status to a display label", () => {
    expect(cronRunStatusLabel("awaiting_input")).toBe("Needs approval");
    expect(cronRunStatusLabel("running")).toBe("Running");
    expect(cronRunStatusLabel("succeeded")).toBe("Succeeded");
    expect(cronRunStatusLabel("failed")).toBe("Failed");
    expect(cronRunStatusLabel(null)).toBe("No runs");
  });
});

describe("cronRunStatusTone", () => {
  it("maps run states to Status chip tones", () => {
    expect(cronRunStatusTone("failed")).toBe("error");
    expect(cronRunStatusTone("awaiting_input")).toBe("needs-you");
    expect(cronRunStatusTone("running")).toBe("pending");
    expect(cronRunStatusTone("succeeded")).toBe("success");
    expect(cronRunStatusTone(null)).toBe("neutral");
  });
});
