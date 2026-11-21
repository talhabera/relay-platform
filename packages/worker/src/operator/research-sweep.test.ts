import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, runResearchPipeline } = vi.hoisted(() => ({
  findMany: vi.fn(),
  runResearchPipeline: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        companyRecords: { findMany },
      },
    },
  };
});

vi.mock("./research-pipeline", () => ({
  runResearchPipeline,
}));

import { sweepResearchQueue } from "./research-sweep";

const now = new Date("2026-09-03T12:00:00.000Z");
const companyId = "550e8400-e29b-41d4-a716-446655440000";

function queueRow(id: string, updatedAt: Date) {
  return { id, companyId, updatedAt };
}

describe("sweepResearchQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runResearchPipeline.mockResolvedValue({ ok: true, status: "researched" });
  });

  it("runs the pipeline sequentially for each pending row", async () => {
    const row1 = queueRow(
      "aa0e8400-e29b-41d4-a716-446655440010",
      new Date("2026-08-01T12:00:00.000Z"),
    );
    const row2 = queueRow(
      "aa0e8400-e29b-41d4-a716-446655440011",
      new Date("2026-08-02T12:00:00.000Z"),
    );
    findMany.mockResolvedValue([row1, row2]);

    const count = await sweepResearchQueue(now);

    expect(count).toBe(2);
    expect(runResearchPipeline).toHaveBeenCalledTimes(2);
    expect(runResearchPipeline).toHaveBeenNthCalledWith(1, {
      companyId,
      recordId: row1.id,
      mode: "all",
      now,
    });
    expect(runResearchPipeline).toHaveBeenNthCalledWith(2, {
      companyId,
      recordId: row2.id,
      mode: "all",
      now,
    });
  });

  it("fetches at most 10 rows so an eleventh candidate is not processed", async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      queueRow(
        `aa0e8400-e29b-41d4-a716-4466554400${index.toString().padStart(2, "0")}`,
        new Date(`2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`),
      ),
    );
    findMany.mockResolvedValue(rows);

    const count = await sweepResearchQueue(now);

    expect(count).toBe(10);
    expect(runResearchPipeline).toHaveBeenCalledTimes(10);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10 }),
    );
  });
});
