import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { runRows, leadRows, questionFindFirst, questionFindMany, inserts } = vi.hoisted(() => ({
  runRows: { value: [] as unknown[] },
  leadRows: { value: [] as unknown[] },
  questionFindFirst: vi.fn(),
  questionFindMany: vi.fn(),
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        agentQuestions: { findFirst: questionFindFirst, findMany: questionFindMany },
      },
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: async () => runRows.value }),
        }),
      }),
      selectDistinct: () => ({
        from: () => ({
          innerJoin: () => ({ where: async () => leadRows.value }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          inserts.push({ table, values });
          const done = Promise.resolve(undefined);
          return Object.assign(done, {
            returning: async () => [{ id: "q-1" }],
          });
        },
      }),
    },
  };
});

import { agentQuestions, cronRunMessages } from "@relay/db";
import {
  borderlineAnswersForAgent,
  buildBorderlineAnswers,
  buildBorderlineQuestion,
  postBorderlineQuestion,
} from "./borderline-question";

const run = {
  id: "run-1",
  startedAt: new Date("2026-09-21T06:00:00Z"),
  createdAt: new Date("2026-09-21T06:00:00Z"),
  companyId: "co-1",
  agentId: "ag-q",
};

beforeEach(() => {
  vi.clearAllMocks();
  inserts.length = 0;
  runRows.value = [run];
  leadRows.value = [];
  questionFindFirst.mockResolvedValue(undefined);
});

describe("buildBorderlineQuestion", () => {
  it("lists every borderline lead of the run in one question", () => {
    const text = buildBorderlineQuestion([
      { id: "a", name: "AlphaLog", score: 58, fitReasons: ["Under 20 employees"] },
      { id: "b", name: "Beta", score: 61, fitReasons: [] },
    ]);
    expect(text).toContain("2 borderline leads");
    expect(text).toContain("- AlphaLog: 58 (Under 20 employees)");
    expect(text).toContain("- Beta: 61");
    expect(text).toContain("Borderline filter");
  });

  it("asks nothing when there is no borderline lead", () => {
    expect(buildBorderlineQuestion([])).toBeNull();
  });
});

describe("postBorderlineQuestion", () => {
  it("opens one question on the finished run with its outbound borderline leads", async () => {
    leadRows.value = [
      { id: "a", name: "AlphaLog", score: 58, fitReasons: ["Small"], source: "outbound" },
      { id: "b", name: "Inbound Ayse", score: 60, fitReasons: [], source: "whatsapp" },
      { id: "c", name: "Gamma", score: 66, fitReasons: [], source: null },
    ];

    await expect(postBorderlineQuestion("run-1")).resolves.toBe("q-1");

    const questions = inserts.filter((i) => i.table === agentQuestions);
    expect(questions).toHaveLength(1);
    expect(questions[0]!.values).toMatchObject({
      companyId: "co-1",
      agentId: "ag-q",
      cronRunId: "run-1",
      status: "open",
    });
    const text = questions[0]!.values.question as string;
    expect(text).toContain("2 borderline leads");
    expect(text.indexOf("Gamma")).toBeLessThan(text.indexOf("AlphaLog"));
    // Inbound borderline leads go to the filter only (decision 15).
    expect(text).not.toContain("Inbound Ayse");
    expect(inserts.some((i) => i.table === cronRunMessages)).toBe(true);
  });

  it("does nothing for a run with only inbound or no borderline leads", async () => {
    leadRows.value = [{ id: "b", name: "Ayse", score: 60, fitReasons: [], source: "widget" }];
    await expect(postBorderlineQuestion("run-1")).resolves.toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it("does not post the same question twice", async () => {
    leadRows.value = [{ id: "a", name: "AlphaLog", score: 58, fitReasons: [], source: "outbound" }];
    questionFindFirst.mockResolvedValue({ id: "q-0" });
    await expect(postBorderlineQuestion("run-1")).resolves.toBeNull();
    expect(inserts).toHaveLength(0);
  });

  it("ignores an unknown run", async () => {
    runRows.value = [];
    await expect(postBorderlineQuestion("run-x")).resolves.toBeNull();
  });
});

// W3GAP item 2: the question is posted after the run succeeded, so answering
// it resumes nothing. The next run of the same agent reads the answers in its
// instructions instead; an open question is simply left out.
describe("borderline answers in the next run", () => {
  const question = buildBorderlineQuestion([
    { id: "l1", name: "Acme", score: 64, fitReasons: ["budget unknown"] },
  ])!;

  it("builds nothing without an answer", () => {
    expect(buildBorderlineAnswers([])).toBeNull();
  });

  it("quotes each answered question with its answer", () => {
    const text = buildBorderlineAnswers([
      { question, answer: "Yes, budget unknown is fine for villas" },
    ])!;
    expect(text).toContain("Acme: 64");
    expect(text).toContain("Answer: Yes, budget unknown is fine for villas");
    expect(text).toMatch(/calibrate/i);
  });

  it("reads only this agent's answered borderline questions, newest first", async () => {
    questionFindMany.mockResolvedValue([
      { question, answer: "Reject these", answeredAt: new Date() },
    ]);
    await expect(borderlineAnswersForAgent("ag-q")).resolves.toContain("Reject these");
    const args = questionFindMany.mock.calls[0][0];
    expect(args.limit).toBeGreaterThan(0);
    const where = new PgDialect().sqlToQuery(args.where);
    expect(where.sql).toContain('"agent_questions"."status" = $');
    expect(where.params).toEqual(expect.arrayContaining(["ag-q", "answered"]));
  });

  it("is null when nothing was answered yet", async () => {
    questionFindMany.mockResolvedValue([]);
    await expect(borderlineAnswersForAgent("ag-q")).resolves.toBeNull();
  });
});
