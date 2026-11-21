import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TOOL_TOGGLES } from "@relay/db";

const { writeReportNarrative } = vi.hoisted(() => ({ writeReportNarrative: vi.fn() }));

vi.mock("@relay/db/report-snapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db/report-snapshots")>();
  return { ...actual, writeReportNarrative };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return { ...actual, db: { insert: vi.fn() } };
});

import { ReportNarrativeError } from "@relay/db/report-snapshots";
import {
  executeWriteReportNarrative,
  selectCronOperatorTools,
  WRITE_REPORT_NARRATIVE_TOOL,
} from "./cron-tools";

const companyId = "550e8400-e29b-41d4-a716-446655440000";

describe("writeReportNarrative cron tool", () => {
  beforeEach(() => vi.clearAllMocks());

  const args = {
    companyId,
    agentId: "660e8400-e29b-41d4-a716-446655440001",
    cronRunId: "run-1",
    version: { toolToggles: DEFAULT_TOOL_TOGGLES },
  };

  it("is offered only to Insights package Schedules", () => {
    expect(
      selectCronOperatorTools({ ...args, packageSlug: "insights" })[WRITE_REPORT_NARRATIVE_TOOL],
    ).toBeDefined();
  });

  it.each([null, undefined, "lead-engine", "social-media", "revenue"])(
    "is not offered to a %s Schedule",
    (packageSlug) => {
      expect(
        selectCronOperatorTools({ ...args, packageSlug })[WRITE_REPORT_NARRATIVE_TOOL],
      ).toBeUndefined();
    },
  );

  it("writes only the narrative for the run's company", async () => {
    writeReportNarrative.mockResolvedValue({
      id: "snap-1",
      start: new Date("2026-09-13T22:00:00Z"),
      end: new Date("2026-09-20T22:00:00Z"),
    });
    const result = await executeWriteReportNarrative(companyId, {
      period: "weekly",
      summary: "Eight qualified leads delivered.",
      highlights: ["Best week since July"],
    });
    expect(writeReportNarrative).toHaveBeenCalledWith(expect.anything(), {
      companyId,
      period: "weekly",
      narrative: {
        summary: "Eight qualified leads delivered.",
        highlights: ["Best week since July"],
      },
    });
    expect(result).toEqual({
      ok: true,
      snapshotId: "snap-1",
      periodStart: "2026-09-13T22:00:00.000Z",
      periodEnd: "2026-09-20T22:00:00.000Z",
    });
  });

  it("tells the agent when no report exists or the text is refused", async () => {
    writeReportNarrative.mockResolvedValueOnce(null);
    await expect(
      executeWriteReportNarrative(companyId, { period: "monthly", summary: "x", highlights: [] }),
    ).resolves.toMatchObject({ ok: false });
    writeReportNarrative.mockRejectedValueOnce(new ReportNarrativeError("The summary is empty"));
    await expect(
      executeWriteReportNarrative(companyId, { period: "weekly", summary: " ", highlights: [] }),
    ).resolves.toEqual({ ok: false, error: "The summary is empty" });
  });
});
