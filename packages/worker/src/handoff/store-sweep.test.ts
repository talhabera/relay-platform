import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const m = vi.hoisted(() => ({ set: vi.fn(), where: vi.fn() }));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: () => ({
        set: (values: unknown) => {
          m.set(values);
          return {
            where: (where: SQL) => {
              m.where(where);
              return { returning: async () => [] };
            },
          };
        },
      }),
    },
  };
});

import { expireDueHandoffRequests, handBackIdleTakeovers } from "./store";

const dialect = new PgDialect();
const now = new Date("2026-10-03T12:00:00.000Z");

function renderedWhere() {
  return dialect.sqlToQuery(m.where.mock.calls[0][0] as SQL);
}

beforeEach(() => vi.clearAllMocks());

describe("expireDueHandoffRequests", () => {
  it("moves only open requests past expires_at to expired", async () => {
    await expireDueHandoffRequests(now);

    expect(m.set).toHaveBeenCalledWith({ status: "expired", expiredAt: now, updatedAt: now });
    const { sql, params } = renderedWhere();
    expect(sql).toContain('"handoff_requests"."status" = $1');
    expect(sql).toContain('"handoff_requests"."expires_at" <= $2');
    expect(params[0]).toBe("open");
    expect(params[1]).toBe(now.toISOString());
  });
});

describe("handBackIdleTakeovers", () => {
  it("hands back takeovers idle for 30 minutes, counting from the takeover when nobody wrote", async () => {
    await handBackIdleTakeovers(now);

    expect(m.set).toHaveBeenCalledWith({
      status: "handed_back",
      handedBackAt: now,
      handBackReason: "idle",
      updatedAt: now,
    });
    const { sql, params } = renderedWhere();
    expect(sql).toContain('"handoff_requests"."status" = $1');
    expect(sql).toContain('"handoff_requests"."last_human_message_at" <= $2');
    expect(sql).toContain('"handoff_requests"."last_human_message_at" is null');
    expect(sql).toContain('"handoff_requests"."taken_over_at" <= $3');
    const cutoff = new Date(now.getTime() - 30 * 60_000).toISOString();
    expect(params).toEqual(["taken_over", cutoff, cutoff]);
  });
});
