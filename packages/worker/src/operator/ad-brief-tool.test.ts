import { describe, expect, it } from "vitest";
import { DAILY_BRIEF_MAX_ITEMS, type DailyBriefItem } from "@relay/db";
import type { ReportExecutor } from "@relay/db/report-snapshots";
import { executePostAdBrief } from "./ad-brief-tool";

const run = {
  companyId: "550e8400-e29b-41d4-a716-446655440000",
  agentId: "660e8400-e29b-41d4-a716-446655440001",
  cronRunId: "770e8400-e29b-41d4-a716-446655440002",
};
const MORNING = new Date("2026-11-05T05:00:00Z");

const item = (rank: number, overrides: Record<string, unknown> = {}) => ({
  rank,
  kind: "do",
  title: `Reklam ${rank}`,
  why: "Harcama girilmedi.",
  href: "/analytics/spend",
  ...overrides,
});

type Insert = { items: DailyBriefItem[]; localDate: string; agentId: string; cronRunId: string };

/** Answers each select with the next queued rows (company timezone, then today's brief) and records inserts. */
function stubExecutor(selects: unknown[][]) {
  const inserts: Insert[] = [];
  const query = (rows: unknown[]) => {
    const q: Record<string, unknown> = {};
    for (const step of ["from", "where", "leftJoin", "orderBy", "limit"]) q[step] = () => q;
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject);
    return q;
  };
  const executor = {
    select: () => query(selects.shift() ?? []),
    insert: () => ({
      values: (values: Insert) => {
        inserts.push(values);
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: "brief-1", localDate: values.localDate }],
          }),
        };
      },
    }),
  };
  return { executor: executor as unknown as ReportExecutor, inserts };
}

const proposals = (...keys: string[]) => async () => ({ proposals: keys.map((key) => ({ key })) });

describe("postAdBrief", () => {
  it("refuses when an open proposal has no item carrying it", async () => {
    const { executor, inserts } = stubExecutor([]);
    const result = await executePostAdBrief(
      run,
      { summary: "Reklam.", items: [item(1)] },
      MORNING,
      executor,
      proposals("pause_channel:google"),
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("pause_channel:google") });
    expect(inserts).toHaveLength(0);
  });

  it("refuses an unknown proposalKey", async () => {
    const { executor, inserts } = stubExecutor([]);
    const result = await executePostAdBrief(
      run,
      { summary: "Reklam.", items: [item(1, { kind: "decide", proposalKey: "pause_channel:meta" })] },
      MORNING,
      executor,
      proposals(),
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining("pause_channel:meta") });
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ["more than 5 items", Array.from({ length: DAILY_BRIEF_MAX_ITEMS + 1 }, (_, i) => item(i + 1))],
    ["a rank gap", [item(1), item(3)]],
    ["a duplicate rank", [item(1), item(1)]],
    ["an external href", [item(1, { href: "https://evil.example" })]],
    ["a protocol-relative href", [item(1, { href: "//evil.example" })]],
  ])("refuses %s without writing", async (_label, items) => {
    const { executor, inserts } = stubExecutor([]);
    const result = await executePostAdBrief(run, { summary: "Reklam.", items }, MORNING, executor, proposals());
    expect(result.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("stores every item with source ads and keeps agentId and cronRunId", async () => {
    const { executor, inserts } = stubExecutor([[{ timezone: "Europe/Istanbul" }], []]);
    const result = await executePostAdBrief(
      run,
      {
        summary: "Google durdurma onerisi.",
        items: [item(2, { kind: "decide", proposalKey: "pause_channel:google", href: null }), item(1)],
      },
      MORNING,
      executor,
      proposals("pause_channel:google"),
    );
    expect(result).toEqual({ ok: true, briefId: "brief-1", localDate: "2026-11-05" });
    expect(inserts[0]).toMatchObject({ agentId: run.agentId, cronRunId: run.cronRunId });
    expect(inserts[0].items).toEqual([
      { ...item(1), proposalKey: null, source: "ads", status: "open" },
      { ...item(2, { kind: "decide", href: null }), proposalKey: "pause_channel:google", source: "ads", status: "open" },
    ]);
  });

  it("replaces only earlier ads items on a second post the same day and keeps a reader status", async () => {
    const earlier = [
      { ...item(1, { kind: "decide" }), proposalKey: "pause_channel:google", source: "ads", status: "dismissed" },
      { ...item(2), proposalKey: null, source: "ads", status: "open" },
      { ...item(3, { title: "Manager task" }), taskId: null, status: "done" },
    ];
    const { executor, inserts } = stubExecutor([[{ timezone: "Europe/Istanbul" }], [{ items: earlier }]]);
    await executePostAdBrief(
      run,
      { summary: "Yeni.", items: [item(1, { kind: "decide", proposalKey: "pause_channel:google" })] },
      MORNING,
      executor,
      proposals("pause_channel:google"),
    );
    expect(inserts[0].items).toEqual([
      { ...item(1, { kind: "decide" }), proposalKey: "pause_channel:google", source: "ads", status: "dismissed" },
      { ...item(2, { title: "Manager task" }), taskId: null, status: "done" },
    ]);
  });
});
