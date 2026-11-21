import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { listLeadEvents } from ".";

const findMany = vi.fn();

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([{ id: "ev-1" }]);
  (db.query as unknown as Record<string, unknown>).leadEvents = { findMany };
});

describe("listLeadEvents", () => {
  const from = new Date("2026-10-04T22:00:00Z");
  const to = new Date("2026-10-11T22:00:00Z");

  it("reads one company's half-open range, oldest first", async () => {
    await expect(listLeadEvents("co-1", { from, to })).resolves.toEqual([
      { id: "ev-1" },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    const args = findMany.mock.calls[0][0];
    expect(args.where).toBeDefined();
    expect(args.orderBy).toHaveLength(2);
  });

  it("returns nothing for an empty range without querying", async () => {
    await expect(listLeadEvents("co-1", { from, to: from })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
