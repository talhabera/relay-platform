import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  AD_CHANNELS,
  AD_CODE_PREFIX,
  AD_CURRENCY,
  CLICK_TTL_DAYS,
  bindClickToRecord,
  ipSubject,
  isValidAdCode,
  type AdClickExecutor,
} from "./ad-click";

describe("ad constants", () => {
  it("pins currency, channels, prefixes and TTL", () => {
    expect(AD_CURRENCY).toBe("TRY");
    expect(AD_CHANNELS).toEqual(["google", "instagram", "meta"]);
    expect(AD_CODE_PREFIX).toEqual({ google: "G", instagram: "R", meta: "M" });
    expect(CLICK_TTL_DAYS).toBe(7);
  });
});

describe("isValidAdCode", () => {
  it.each(["G7KF3", "MWEB1", "MSOS3", "R7KF3", "M7KF3", "GAB23"])(
    "accepts %s",
    (code) => {
      expect(isValidAdCode(code)).toBe(true);
    },
  );

  it.each([
    "g7kf3",
    "G7KF",
    "G7KF33",
    "X7KF3",
    "organik",
    "",
    "G7KF0", // 0 is confusable
    "GOKF3", // O is confusable
    "G1KF3", // 1 is confusable
    "GIKF3", // I is confusable outside the prefix
    "I7KF3", // I is never a channel letter: Instagram is R
    "MAB12", // not a Meta fixed code, contains 1
  ])("rejects %s", (code) => {
    expect(isValidAdCode(code)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidAdCode(undefined)).toBe(false);
    expect(isValidAdCode(null)).toBe(false);
    expect(isValidAdCode(12345)).toBe(false);
  });
});

describe("ipSubject", () => {
  const salt = "test-salt";
  const day = "2026-11-06";
  const ip = "203.0.113.7";

  it("is stable within a day and 16 hex chars", () => {
    const a = ipSubject(salt, day, ip);
    expect(a).toBe(ipSubject(salt, day, ip));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("differs across days, salts and IPs", () => {
    const base = ipSubject(salt, day, ip);
    expect(ipSubject(salt, "2026-11-07", ip)).not.toBe(base);
    expect(ipSubject("other-salt", day, ip)).not.toBe(base);
    expect(ipSubject(salt, day, "198.51.100.9")).not.toBe(base);
  });

  it("never contains the IP", () => {
    expect(ipSubject(salt, day, ip)).not.toContain(ip);
    expect(ipSubject(salt, day, ip)).not.toContain("203");
  });
});

describe("bindClickToRecord", () => {
  const now = new Date("2026-11-06T10:00:00.000Z");
  const input = {
    companyId: "550e8400-e29b-41d4-a716-446655440000",
    code: "G7KF3",
    recordId: "550e8400-e29b-41d4-a716-446655440001",
    now,
  };

  function fakeExecutor(rows: unknown[]) {
    const statements: string[] = [];
    const params: unknown[][] = [];
    const execute = vi.fn(async (query: SQL) => {
      const { sql, params: p } = new PgDialect().sqlToQuery(query);
      statements.push(sql.replace(/\s+/g, " ").trim());
      params.push(p);
      return rows;
    });
    return {
      executor: { execute } as unknown as AdClickExecutor,
      execute,
      statements,
      params,
    };
  }

  it("issues one conditional UPDATE with every guard and returns true on a row", async () => {
    const fake = fakeExecutor([{ id: "click-1" }]);
    await expect(bindClickToRecord(fake.executor, input)).resolves.toBe(true);
    expect(fake.execute).toHaveBeenCalledTimes(1);
    const statement = fake.statements[0]!;
    expect(statement).toContain("UPDATE ad_clicks");
    expect(statement).toContain("linked_record_id IS NULL");
    expect(statement).toContain("expires_at >");
    expect(statement).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM ad_clicks/);
    expect(statement).toContain("linked_record_id =");
    expect(fake.params[0]).toContain(input.companyId);
    expect(fake.params[0]).toContain(input.code);
    expect(fake.params[0]).toContain(input.recordId);
  });

  it("returns false when no row changed (already linked, expired, or lead bound)", async () => {
    const fake = fakeExecutor([]);
    await expect(bindClickToRecord(fake.executor, input)).resolves.toBe(false);
    expect(fake.execute).toHaveBeenCalledTimes(1);
  });
});
