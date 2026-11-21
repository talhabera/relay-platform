// Runs the Analytics loaders through the real drizzle postgres-js driver over a
// fake `postgres` client. drizzle turns off postgres.js's own Date serializer
// (it expects column encoders to send ISO strings), so a Date bound without a
// column encoder reaches the wire as a Date and postgres.js throws
// ERR_INVALID_ARG_TYPE: the /analytics error boundary in production.
import { drizzle } from "drizzle-orm/postgres-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@/db/schema";

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

const h = vi.hoisted(() => ({ db: null as unknown, queries: [] as { query: string; params: unknown[] }[] }));
vi.mock("@/db", () => ({
  get db() {
    return h.db;
  },
}));

/** A post-wipe database: the company row exists, every other table is empty. */
function rowsFor(query: string): unknown[] {
  if (/from "companies"/.test(query)) {
    return [{ id: COMPANY_ID, timezone: "Europe/Istanbul", owner_id: "owner-1", ownerId: "owner-1" }];
  }
  return [];
}

function fakePostgres() {
  const run = (query: string, params: unknown[] = []) => {
    h.queries.push({ query, params });
    // What postgres.js does with a Date once drizzle has disabled its serializer.
    const bad = params.some((p) => p instanceof Date);
    const settle = <T,>(value: () => T) =>
      bad
        ? Promise.reject(
            new TypeError(
              'The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date',
            ),
          )
        : Promise.resolve(value());
    const rows = rowsFor(query);
    return {
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => settle(() => rows).then(ok, fail),
      values: () => settle(() => rows.map((r) => Object.values(r as object))),
    };
  };
  return { unsafe: run, options: { parsers: {}, serializers: {} } };
}

describe("analytics loaders on a post-wipe company", () => {
  beforeEach(() => {
    h.queries = [];
    h.db = drizzle(fakePostgres() as never, { schema });
  });

  it("loads the Overview without binding a raw Date", async () => {
    const { loadOverview } = await import("./load-overview");
    const data = await loadOverview(COMPANY_ID, "this", new Date("2026-10-08T12:00:00Z"));
    expect(data?.empty).toBe(true);
    expect(data?.weekOptions.map((o) => o.value)).toEqual(["this", "last"]);
    expect(h.queries.some((q) => /first_qualified/.test(q.query))).toBe(true);
  });

  it("loads Lead quality for last week without binding a raw Date", async () => {
    const { loadLeadQuality } = await import("./load-overview");
    const data = await loadLeadQuality(COMPANY_ID, "last", new Date("2026-10-08T12:00:00Z"));
    expect(data?.empty).toBe(true);
    expect(data?.model.rows).toEqual([]);
  });
});
