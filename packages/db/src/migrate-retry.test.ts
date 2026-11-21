import { describe, expect, it } from "vitest";
import { isRetryableMigrateError } from "./migrate-retry";

describe("isRetryableMigrateError", () => {
  it("retries nested EAI_AGAIN from DrizzleQueryError", () => {
    const cause = Object.assign(new Error("getaddrinfo EAI_AGAIN dbhost"), {
      code: "EAI_AGAIN",
    });
    const err = Object.assign(new Error("Failed query: CREATE SCHEMA"), {
      cause,
    });
    expect(isRetryableMigrateError(err)).toBe(true);
  });

  it("does not retry SQL errors", () => {
    const cause = Object.assign(new Error('relation "cron_jobs" already exists'), {
      code: "42P07",
    });
    const err = Object.assign(new Error("Failed query: CREATE TABLE"), {
      cause,
    });
    expect(isRetryableMigrateError(err)).toBe(false);
  });
});
